import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Library, Rocket, History, Cpu } from "lucide-react";
import { apiClient } from "./api/client.js";
import {
  getClientRunToken,
  getActiveProjectId,
  saveActiveProjectId,
  clearLegacyStorageCaches,
  genId,
  exportJSON,
  haveSameSerializedState,
} from "./utils/formatters.js";
import { LibraryTab } from "./components/tabs/LibraryTab.jsx";
import { RunnerTab } from "./components/tabs/RunnerTab.jsx";
import { HistoryTab } from "./components/tabs/HistoryTab.jsx";
import { HelpModal } from "./components/modals/HelpModal.jsx";
import { ModelSettingsModal } from "./components/modals/ModelSettingsModal.jsx";

const TAB_STORAGE_KEY = "autotest_active_tab";
const SELECTED_BATCH_STORAGE_KEY = "autotest_selected_batch_id";
const VALID_TABS = new Set(["library", "runner", "history"]);

const readStoredTab = () => {
  try {
    const val = sessionStorage.getItem(TAB_STORAGE_KEY);
    return VALID_TABS.has(val) ? val : "library";
  } catch {
    return "library";
  }
};

const readStoredSelectedBatchId = () => {
  try {
    return sessionStorage.getItem(SELECTED_BATCH_STORAGE_KEY) || null;
  } catch {
    return null;
  }
};

const mergeBatchIntoHistory = (prevList, nextBatch) => {
  if (!nextBatch?.id) return prevList;
  let found = false;
  let changed = false;
  const mapped = prevList.map((item) => {
    if (item.id !== nextBatch.id) return item;
    found = true;
    if (haveSameSerializedState(item, nextBatch)) return item;
    changed = true;
    return nextBatch;
  });
  if (found) return changed ? mapped : prevList;
  return [nextBatch, ...prevList];
};

// ═══════════════════════════════════════════════════════════════════
// GỐC ỨNG DỤNG - AUTOTEST STUDIO
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const clientRunToken = useMemo(() => getClientRunToken(), []);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectIdState] = useState(() => getActiveProjectId());
  const [history, setHistory] = useState([]);
  const [historyMeta, setHistoryMeta] = useState({ total: 0, hasMore: false, loadingMore: false });
  const [historyLimit, setHistoryLimit] = useState(50);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historySearchDebounced, setHistorySearchDebounced] = useState("");
  const [activeTab, setActiveTab] = useState(() => readStoredTab()); // "library" | "runner" | "history"
  const [runningBatchId, setRunningBatchId] = useState(null);
  const [abortingBatchId, setAbortingBatchId] = useState(null);
  const [selectedBatchId, setSelectedBatchId] = useState(() => readStoredSelectedBatchId());
  const [serverStatus, setServerStatus] = useState("checking"); // "online" | "busy" | "llm_offline" | "offline"
  const [runnerStatus, setRunnerStatus] = useState(null);
  const [liveRun, setLiveRun] = useState(null);
  const [cacheEntries, setCacheEntries] = useState([]);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [currentModel, setCurrentModel] = useState("qwen3.8-27b");

  const isInitialSyncDone = useRef(false);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const runningBatchIdRef = useRef(runningBatchId);
  runningBatchIdRef.current = runningBatchId;
  const fetchBackendHistoryRef = useRef(null);
  const fetchCacheEntriesRef = useRef(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, activeTab);
    } catch {
      // Bỏ qua lỗi sessionStorage nếu trình duyệt chặn
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      if (selectedBatchId) {
        sessionStorage.setItem(SELECTED_BATCH_STORAGE_KEY, selectedBatchId);
      } else {
        sessionStorage.removeItem(SELECTED_BATCH_STORAGE_KEY);
      }
    } catch {
      // Bỏ qua lỗi sessionStorage nếu trình duyệt chặn
    }
  }, [selectedBatchId]);

  const setActiveProjectId = useCallback((id) => {
    const cleanId = id || "";
    setActiveProjectIdState(cleanId);
    saveActiveProjectId(cleanId);
  }, []);

  const isRunnerBusyByOther = Boolean(
    runnerStatus?.isBusy && runnerStatus?.ownerToken && runnerStatus.ownerToken !== clientRunToken
  );

  const fetchCacheEntries = useCallback(async () => {
    try {
      const data = await apiClient.getStepCache();
      if (data?.success && Array.isArray(data.entries)) {
        setCacheEntries((prev) => (haveSameSerializedState(prev, data.entries) ? prev : data.entries));
      }
    } catch {
      // Bỏ qua lỗi khi server chưa khởi động
    }
  }, []);
  fetchCacheEntriesRef.current = fetchCacheEntries;

  const handleClearCache = useCallback(
    async (options = {}) => {
      try {
        await apiClient.clearStepCache(options);
        await fetchCacheEntries();
      } catch (err) {
        console.warn("Lỗi khi xóa Step Cache:", err.message);
      }
    },
    [fetchCacheEntries]
  );

  useEffect(() => {
    fetchCacheEntries();
  }, [fetchCacheEntries]);

  useEffect(() => {
    let mounted = true;
    const checkHealth = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const data = await apiClient.getHealth();
        if (!mounted) return;
        const nextRunner = data.runner || null;
        const activeBeBatchId =
          data.activeBatchId || data.runner?.batchId || data.liveRun?.batchId || null;
        setRunnerStatus((prev) => (haveSameSerializedState(prev, nextRunner) ? prev : nextRunner));

        if (data.runner?.isBusy) {
          setServerStatus("busy");
          if (activeBeBatchId) {
            setRunningBatchId((prev) => (prev === activeBeBatchId ? prev : activeBeBatchId));
            setSelectedBatchId((prev) => prev || activeBeBatchId);
          }
          if (data.liveRun) {
            setLiveRun((prev) => (haveSameSerializedState(prev, data.liveRun) ? prev : data.liveRun));
          }
        } else {
          const wasRunningBatch = Boolean(runningBatchIdRef.current);
          setLiveRun((prev) => (prev === null ? prev : null));
          if (data.llm?.status === "offline") {
            setServerStatus("llm_offline");
          } else {
            setServerStatus("online");
          }
          if (wasRunningBatch) {
            setRunningBatchId(null);
            fetchBackendHistoryRef.current?.();
            fetchCacheEntriesRef.current?.();
          }
        }
        if (data.llm?.model) {
          setCurrentModel((prev) => (prev === data.llm.model ? prev : data.llm.model));
        }
      } catch {
        if (mounted) setServerStatus("offline");
      }
    };

    // Đọc model ban đầu từ config
    apiClient.getModelConfig()
      .then((data) => {
        if (mounted && data.success && data.model) {
          setCurrentModel((prev) => (prev === data.model ? prev : data.model));
        }
      })
      .catch(() => {});

    checkHealth();
    const interval = setInterval(checkHealth, 6000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkHealth();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Polling tiến độ đợt chạy & suy luận AI theo thời gian thực khi BE đang thực thi
  useEffect(() => {
    const targetBatchId = runningBatchId || runnerStatus?.batchId || null;
    const shouldPollLive = Boolean(runningBatchId || runnerStatus?.isBusy);
    if (!shouldPollLive) {
      setLiveRun((prev) => (prev === null ? prev : null));
      return;
    }

    let cancelled = false;
    const pollLive = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const data = targetBatchId
          ? await apiClient.getBatchLiveStatus(targetBatchId)
          : await apiClient.getLiveRunStatus();
        if (cancelled || !data) return;

        if (data.runner) {
          setRunnerStatus((prev) => (haveSameSerializedState(prev, data.runner) ? prev : data.runner));
        }

        if (data.batch) {
          setHistory((prev) => mergeBatchIntoHistory(prev, data.batch));
        }

        const nextLive = data.liveRun || null;
        setLiveRun((prev) => (haveSameSerializedState(prev, nextLive) ? prev : nextLive));

        const beActiveBatchId = data.activeBatchId || data.runner?.batchId || nextLive?.batchId || null;
        if (!targetBatchId && beActiveBatchId) {
          setRunningBatchId((prev) => (prev === beActiveBatchId ? prev : beActiveBatchId));
          setSelectedBatchId((prev) => prev || beActiveBatchId);
        }

        const isBatchDone =
          data.notFound ||
          data.batch?.status === "Kết thúc" ||
          data.runner?.isBusy === false;

        if (isBatchDone) {
          setRunningBatchId(null);
          setLiveRun(null);
          setServerStatus((prev) => (prev === "busy" ? "online" : prev));
          fetchBackendHistoryRef.current?.();
          fetchCacheEntriesRef.current?.();
        }
      } catch {
        // Bỏ qua lỗi mạng thoáng qua
      }
    };

    pollLive();
    const timer = setInterval(pollLive, 800);
    const onVisibility = () => {
      if (document.visibilityState === "visible") pollLive();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [runningBatchId, runnerStatus?.isBusy, runnerStatus?.batchId]);

  // Debounce từ khóa tìm kiếm lịch sử trước khi truy vấn SQL backend
  useEffect(() => {
    const timer = setTimeout(() => {
      setHistorySearchDebounced(historySearchQuery.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [historySearchQuery]);

  // Reset limit về trang đầu khi đổi dự án hoặc đổi từ khóa lọc
  useEffect(() => {
    setHistoryLimit(50);
  }, [activeProjectId, historySearchDebounced]);

  // Tải danh sách dự án trực tiếp từ SQLite backend (nguồn chân lý duy nhất)
  const fetchBackendProjects = useCallback(async () => {
    try {
      const data = await apiClient.getProjects();
      if (Array.isArray(data?.projects)) {
        setProjects((prev) => (haveSameSerializedState(prev, data.projects) ? prev : data.projects));
        clearLegacyStorageCaches();
      }
    } catch (err) {
      console.warn("Không thể tải danh sách dự án từ máy chủ:", err.message);
    } finally {
      isInitialSyncDone.current = true;
    }
  }, []);

  useEffect(() => {
    clearLegacyStorageCaches();
    fetchBackendProjects();
  }, [fetchBackendProjects]);

  // Định kỳ thăm dò cập nhật dự án từ máy chủ (khi không chạy test)
  useEffect(() => {
    const syncProjectsFromBackend = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (!runningBatchId && isInitialSyncDone.current) {
        apiClient.getProjects()
          .then((data) => {
            if (data && Array.isArray(data.projects)) {
              setProjects((prev) => (haveSameSerializedState(prev, data.projects) ? prev : data.projects));
            }
          })
          .catch(() => {});
      }
    };

    const syncInterval = setInterval(syncProjectsFromBackend, 10000);
    return () => clearInterval(syncInterval);
  }, [runningBatchId]);

  // Tải lịch sử phân trang & tìm kiếm trực tiếp từ SQLite backend
  const fetchBackendHistory = useCallback(async () => {
    try {
      const data = await apiClient.getHistory({
        projectId: activeProjectId || undefined,
        search: historySearchDebounced || undefined,
        limit: historyLimit,
        offset: 0,
      });
      if (!Array.isArray(data?.runs)) return;

      const serverRuns = data.runs;
      setHistory((prev) => (haveSameSerializedState(prev, serverRuns) ? prev : serverRuns));

      setHistoryMeta({
        total: Number(data.total ?? serverRuns.length),
        hasMore: Boolean(data.hasMore),
        loadingMore: false,
      });
    } catch (err) {
      console.warn("Không thể tải lịch sử từ máy chủ backend:", err.message);
      setHistoryMeta((prev) => ({ ...prev, loadingMore: false }));
    }
  }, [activeProjectId, historySearchDebounced, historyLimit]);
  fetchBackendHistoryRef.current = fetchBackendHistory;

  const loadMoreHistory = useCallback(() => {
    setHistoryMeta((prev) => ({ ...prev, loadingMore: true }));
    setHistoryLimit((prev) => prev + 50);
  }, []);

  useEffect(() => {
    fetchBackendHistory();
  }, [fetchBackendHistory]);

  useEffect(() => {
    if (activeTab === "history" && !runningBatchId) {
      fetchBackendHistory();
      const pollHistoryIfVisible = () => {
        if (typeof document !== "undefined" && document.hidden) return;
        fetchBackendHistory();
      };
      const interval = setInterval(pollHistoryIfVisible, 3000);
      const onVisibility = () => {
        if (document.visibilityState === "visible") fetchBackendHistory();
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        clearInterval(interval);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }
  }, [activeTab, runningBatchId, fetchBackendHistory]);

  useEffect(() => {
    if (projects.length > 0 && !projects.some((p) => p.id === activeProjectId)) {
      setActiveProjectId(projects[0].id);
    }
  }, [projects, activeProjectId, setActiveProjectId]);

  const upsertProject = async (project) => {
    const existing = projectsRef.current.find((p) => p.id === project.id);
    const isNew = !existing;
    const normalizedSessionMode = project.sessionMode === "persist" ? "persist" : "fresh";

    setProjects((prev) => {
      const idx = prev.findIndex((p) => p.id === project.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...project, sessionMode: normalizedSessionMode };
        return next;
      }
      return [{ ...project, sessionMode: normalizedSessionMode }, ...prev];
    });
    setActiveProjectId(project.id);

    try {
      const payload = isNew
        ? { ...project, sessionMode: normalizedSessionMode }
        : {
            id: project.id,
            name: project.name,
            description: project.description,
            sessionMode: normalizedSessionMode,
            updatedAt: existing.updatedAt,
          };
      const res = await apiClient.saveProject(payload, { isNew });
      if (res?.project) {
        setProjects((prev) => {
          const existsInState = prev.some((p) => p.id === res.project.id);
          return existsInState
            ? prev.map((p) => (p.id === res.project.id ? res.project : p))
            : [res.project, ...prev];
        });
        return res.project;
      }
      return project;
    } catch (err) {
      if (err?.status === 409) {
        alert(`⚠️ Xung đột dữ liệu:\n${err.data?.error || err.message}\nHệ thống sẽ tải lại dữ liệu mới nhất.`);
      } else {
        console.warn("Lỗi khi lưu dự án lên backend:", err.message);
      }
      fetchBackendProjects();
      throw err;
    }
  };

  const deleteProject = async (projectId) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setHistory((prev) => prev.filter((r) => r.projectId !== projectId));
    try {
      await apiClient.deleteProject(projectId);
    } catch (err) {
      console.warn("Lỗi khi xóa dự án trên máy chủ:", err.message);
      fetchBackendProjects();
    }
  };

  const upsertFeature = async (projectId, feat) => {
    const proj = projectsRef.current.find((p) => p.id === projectId);
    const existingFeat = proj?.features?.find((f) => f.id === feat.id);
    const isNew = !existingFeat;

    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        const features = p.features || [];
        const fIdx = features.findIndex((f) => f.id === feat.id);
        const nextFeats = [...features];
        if (fIdx >= 0) {
          nextFeats[fIdx] = feat;
        } else {
          nextFeats.push(feat);
        }
        return { ...p, features: nextFeats };
      })
    );

    try {
      const payload = existingFeat?.updatedAt && !feat.updatedAt
        ? { ...feat, updatedAt: existingFeat.updatedAt }
        : feat;
      const res = await apiClient.saveFeature(projectId, payload, { isNew });
      if (res?.project) {
        setProjects((prev) => prev.map((p) => (p.id === projectId ? res.project : p)));
      }
    } catch (err) {
      if (err?.status === 409) {
        alert(`⚠️ Xung đột dữ liệu:\n${err.data?.error || err.message}\nHệ thống sẽ tải lại dữ liệu mới nhất.`);
      } else {
        console.warn("Lỗi khi lưu tính năng lên backend:", err.message);
      }
      fetchBackendProjects();
    }
  };

  const reorderFeature = async (projectId, featId, targetOrder1Based) => {
    const proj = projectsRef.current.find((p) => p.id === projectId);
    if (!proj) return;
    const features = [...(proj.features || [])];
    const oldIndex = features.findIndex((f) => f.id === featId);
    const targetIndex = targetOrder1Based - 1;
    if (
      oldIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= features.length ||
      oldIndex === targetIndex
    ) {
      return;
    }

    const [moved] = features.splice(oldIndex, 1);
    features.splice(targetIndex, 0, moved);
    const orderedIds = features.map((f) => f.id);

    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, features } : p))
    );

    try {
      const res = await apiClient.reorderFeatures(projectId, orderedIds);
      if (res?.project) {
        setProjects((prev) => prev.map((p) => (p.id === projectId ? res.project : p)));
      }
    } catch (err) {
      console.warn("Lỗi khi sắp xếp thứ tự tính năng:", err.message);
      fetchBackendProjects();
    }
  };

  const duplicateFeature = (projectId, feat) => {
    const copy = {
      ...feat,
      id: genId("feat"),
      name: `${feat.name} (Bản sao)`,
      updatedAt: new Date().toISOString(),
    };
    upsertFeature(projectId, copy);
  };

  const importFeatures = async (projectId, newFeats) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return { ...p, features: [...(p.features || []), ...newFeats] };
      })
    );

    try {
      const res = await apiClient.importFeatures(projectId, newFeats);
      if (res?.project) {
        setProjects((prev) => prev.map((p) => (p.id === projectId ? res.project : p)));
      }
    } catch (err) {
      console.warn("Lỗi khi import tính năng lên backend:", err.message);
      fetchBackendProjects();
    }
  };

  const deleteFeature = async (projectId, featureId) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return { ...p, features: (p.features || []).filter((f) => f.id !== featureId) };
      })
    );

    try {
      const res = await apiClient.deleteFeature(projectId, featureId);
      if (res?.project) {
        setProjects((prev) => prev.map((p) => (p.id === projectId ? res.project : p)));
      }
    } catch (err) {
      console.warn("Lỗi khi xóa tính năng trên backend:", err.message);
      fetchBackendProjects();
    }
  };

  const startBatchRun = async ({ name, notes, features, projectId, projectName }) => {
    const resolvedProjectId = projectId || activeProjectId;
    const resolvedProjectName =
      projectName || projects.find((p) => p.id === resolvedProjectId)?.name || "Dự án";

    const payload = {
      projectId: resolvedProjectId,
      projectName: resolvedProjectName,
      name,
      notes: notes || "",
      features: (features || []).map((f) => ({
        id: f.id,
        name: f.name,
        steps: [...(f.steps || [])],
      })),
      ownerToken: clientRunToken,
    };

    try {
      const data = await apiClient.startBatch(payload, clientRunToken);
      const createdBatch = data?.batch || null;
      const batchId = data?.batchId || createdBatch?.id || null;

      if (createdBatch) {
        let inserted = false;
        setHistory((prev) => {
          inserted = !prev.some((item) => item.id === createdBatch.id);
          return mergeBatchIntoHistory(prev, createdBatch);
        });
        if (inserted) {
          setHistoryMeta((prev) => ({
            ...prev,
            total: prev.total + 1,
          }));
        }
      }

      if (batchId) {
        setSelectedBatchId(batchId);
        setRunningBatchId(batchId);
      }

      setRunnerStatus((prev) => ({
        ...prev,
        isBusy: true,
        batchId: batchId || prev?.batchId || null,
        ownerToken: clientRunToken,
      }));
      setServerStatus("busy");
      setActiveTab("history");
      return createdBatch;
    } catch (err) {
      console.warn("Không thể khởi chạy đợt kiểm thử:", err.message);
      try {
        const health = await apiClient.getHealth();
        const activeId = health?.activeBatchId || health?.runner?.batchId || null;
        if (health?.runner) setRunnerStatus(health.runner);
        if (health?.runner?.isBusy && activeId) {
          setRunningBatchId(activeId);
          setSelectedBatchId(activeId);
          setActiveTab("history");
        }
        await fetchBackendHistory();
      } catch {
        // Bỏ qua lỗi phụ khi đồng bộ lại health
      }
      window.alert(err.message || "Không thể khởi chạy đợt kiểm thử");
      return null;
    }
  };

  const quickRunFeature = (feat) => {
    if (!feat) return;
    if (runningBatchId) {
      setSelectedBatchId(runningBatchId);
      setActiveTab("history");
      return;
    }
    if (isRunnerBusyByOther) {
      setActiveTab("history");
      return;
    }
    const proj = projects.find((p) => p.id === activeProjectId);
    const pad = (n) => String(n).padStart(2, "0");
    const d = new Date();
    const runTitle = `Chạy nhanh: ${feat.name} (${pad(d.getHours())}:${pad(d.getMinutes())})`;
    startBatchRun({
      name: runTitle,
      notes: "Khởi chạy trực tiếp từ trình soạn thảo tính năng",
      features: [feat],
      projectId: proj?.id || activeProjectId,
      projectName: proj?.name || "Dự án",
    });
  };

  const abortBatchRun = async (batchOrId) => {
    const targetId =
      (typeof batchOrId === "string" ? batchOrId : batchOrId?.id) ||
      runningBatchId ||
      runnerStatus?.batchId ||
      null;

    setAbortingBatchId(targetId || "__aborting__");
    try {
      const data = targetId
        ? await apiClient.abortBatch(targetId, clientRunToken)
        : await apiClient.abortRun(clientRunToken);

      if (data?.batch) {
        setHistory((prev) => mergeBatchIntoHistory(prev, data.batch));
      }
      setRunningBatchId(null);
      setLiveRun(null);
      setRunnerStatus((prev) =>
        prev ? { ...prev, isBusy: false, ownerToken: null, activeSince: null, batchId: null } : prev
      );
      setServerStatus((prev) => (prev === "busy" ? "online" : prev));
      await Promise.all([fetchBackendHistory(), fetchCacheEntries()]);
    } catch (err) {
      console.warn("Lỗi gửi tín hiệu hủy:", err.message);
      window.alert(err.message || "Không thể hủy đợt chạy");
    } finally {
      setAbortingBatchId(null);
    }
  };

  const deleteBatch = async (batchId) => {
    setHistory((prev) => prev.filter((b) => b.id !== batchId));
    setHistoryMeta((prev) => ({
      ...prev,
      total: Math.max(0, prev.total - 1),
    }));
    if (selectedBatchId === batchId) {
      setSelectedBatchId(null);
    }
    try {
      await apiClient.deleteBatch(batchId);
    } catch (err) {
      console.warn("Không thể xóa đợt chạy trên server:", err.message);
      fetchBackendHistory();
    }
  };

  const TABS = [
    {
      id: "library",
      label: "Quản lý tính năng",
      icon: <Library size={15} />,
    },
    {
      id: "runner",
      label: "Trình chạy test",
      icon: <Rocket size={15} />,
    },
    {
      id: "history",
      label: "Lịch sử kiểm thử",
      icon: <History size={15} />,
    },
  ];

  return (
    <div className="h-screen overflow-hidden bg-slate-950 flex flex-col text-slate-100 font-sans selection:bg-indigo-500/30 selection:text-indigo-200 w-full">
      {/* ── HEADER GỌN (border-slate-700) ── */}
      <header className="shrink-0 border-b border-slate-700 bg-slate-950 sticky top-0 z-40">
        <div className="w-full px-6 flex items-center justify-between h-13">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-lg">🧪</span>
            <span className="text-sm font-bold text-white tracking-tight">AutoTest Studio</span>
          </div>

          <div className="flex items-center gap-3">
            <nav className="flex items-center gap-1.5" aria-label="Điều hướng chính">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeTab === tab.id
                    ? "bg-indigo-600/25 text-indigo-200 border border-indigo-500/50 shadow-xs"
                    : "text-slate-300 hover:text-white hover:bg-slate-900 border border-transparent"
                    }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </nav>

            <span className="w-px h-4 bg-slate-700 mx-0.5" />

            <div
              className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-700/80 text-[11px] font-medium select-none"
              title={
                serverStatus === "online"
                  ? "Backend & AI LLM hoạt động bình thường"
                  : serverStatus === "busy"
                    ? "Hệ thống đang bận thực thi kiểm thử"
                    : serverStatus === "llm_offline"
                      ? "Cảnh báo: Không kết nối được dịch vụ AI LLM"
                      : "Cảnh báo: Không kết nối được máy chủ Backend"
              }
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${serverStatus === "online"
                  ? "bg-emerald-400"
                  : serverStatus === "busy"
                    ? "bg-amber-400 animate-pulse"
                    : serverStatus === "llm_offline"
                      ? "bg-amber-500"
                      : "bg-rose-500"
                  }`}
              />
              <span className="text-slate-300 font-mono text-[10px] tabular-nums min-w-[64px] text-center">
                {serverStatus === "online"
                  ? "Sẵn sàng"
                  : serverStatus === "busy"
                    ? (liveRun?.currentStepIndex
                        ? `Bước ${liveRun.currentStepIndex}/${liveRun.totalSteps}`
                        : "Đang chạy")
                    : serverStatus === "llm_offline"
                      ? "Mất LLM"
                      : serverStatus === "checking"
                        ? "Đang kết nối…"
                        : "Ngoại tuyến"}
              </span>
            </div>

            {/* Nút Cài đặt (.env) */}
            <button
              type="button"
              onClick={() => setModelModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-indigo-500/40 hover:border-indigo-400 text-[11px] font-medium transition-colors cursor-pointer select-none group shadow-xs"
              title={`Cài đặt (.env) - Model: ${currentModel}`}
            >
              <Cpu size={13} className="text-indigo-400 group-hover:scale-110 transition-transform" />
              <span className="font-mono text-[11px] text-indigo-300 truncate max-w-[130px]">
                {currentModel.split("/").pop()}
              </span>
            </button>

            <a
              href="/manual.html"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 text-[11px] font-medium transition-colors cursor-pointer select-none no-underline"
              title="Mở tài liệu hướng dẫn sử dụng chi tiết (Tab mới)"
            >
              <span className="text-amber-400">💡</span>
              <span>Hướng dẫn</span>
              <span className="text-[10px] text-slate-400">↗</span>
            </a>
          </div>
        </div>
      </header>

      {/* ── NỘI DUNG CHÍNH ── */}
      <div className="flex-1 min-h-0 overflow-hidden w-full">
        {activeTab === "library" && (
          <div className="h-full w-full">
            <LibraryTab
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={setActiveProjectId}
              onUpsertProject={upsertProject}
              onDeleteProject={deleteProject}
              onUpsertFeature={upsertFeature}
              onReorderFeature={reorderFeature}
              onDuplicateFeature={duplicateFeature}
              onImportFeatures={importFeatures}
              onDeleteFeature={deleteFeature}
              onExportProject={(p) => exportJSON(p, `${p.name.replace(/\s+/g, "_")}.json`)}
              onExportAll={() => exportJSON({ projects, history }, "autotest_all_projects.json")}
              history={history}
              cacheEntries={cacheEntries}
              onClearCache={handleClearCache}
              onQuickRunFeature={quickRunFeature}
              runningBatchId={runningBatchId}
              isRunnerBusyByOther={isRunnerBusyByOther}
            />
          </div>
        )}
        {activeTab === "runner" && (
          <div className="h-full w-full">
            <RunnerTab
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={setActiveProjectId}
              onUpsertProject={upsertProject}
              onDeleteProject={deleteProject}
              onExportProject={(p) => exportJSON(p, `${p.name.replace(/\s+/g, "_")}.json`)}
              onExportAll={() => exportJSON({ projects, history }, "autotest_all_projects.json")}
              history={history}
              cacheEntries={cacheEntries}
              onStartBatchRun={startBatchRun}
              runningBatchId={runningBatchId}
              isRunnerBusyByOther={isRunnerBusyByOther}
              onNavigateToHistory={() => setActiveTab("history")}
            />
          </div>
        )}
        {activeTab === "history" && (
          <div className="h-full w-full">
            <HistoryTab
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={setActiveProjectId}
              onUpsertProject={upsertProject}
              onDeleteProject={deleteProject}
              onExportProject={(p) => exportJSON(p, `${p.name.replace(/\s+/g, "_")}.json`)}
              onExportAll={() => exportJSON({ projects, history }, "autotest_all_projects.json")}
              history={history}
              historyTotal={historyMeta.total}
              historyHasMore={historyMeta.hasMore}
              historyLoadingMore={historyMeta.loadingMore}
              onLoadMoreHistory={loadMoreHistory}
              onHistorySearchChange={setHistorySearchQuery}
              selectedBatchId={selectedBatchId}
              onSelectBatchId={setSelectedBatchId}
              onDeleteBatch={deleteBatch}
              onAbortBatchRun={abortBatchRun}
              runningBatchId={runningBatchId}
              abortingBatchId={abortingBatchId}
              liveRun={liveRun}
              clientRunToken={clientRunToken}
            />
          </div>
        )}
      </div>

      {/* Modal Hướng dẫn sử dụng */}
      <HelpModal isOpen={helpModalOpen} onClose={() => setHelpModalOpen(false)} />

      {/* Modal Cài đặt Model AI (.env) */}
      <ModelSettingsModal
        isOpen={modelModalOpen}
        onClose={() => setModelModalOpen(false)}
        currentModel={currentModel}
        onModelUpdated={(newModel) => {
          setCurrentModel(newModel);
        }}
      />
    </div>
  );
}

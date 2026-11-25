import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Rocket,
  Search,
  ChevronRight,
  ChevronDown,
  Pencil,
  Loader2,
  PlayCircle,
  Zap,
} from "lucide-react";
import { DarkCheckbox } from "../common/Modals.jsx";
import { ProjectModal, NewBatchModal } from "../modals/ProjectModal.jsx";
import { ProjectSelectorDropdown } from "./LibraryTab.jsx";
import { generateBatchRunName } from "../../utils/formatters.js";

const normStep = (s) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// ═══════════════════════════════════════════════════════════════════
// TAB 2  ─  TRÌNH CHẠY KIỂM THỬ (RunnerTab)
// ═══════════════════════════════════════════════════════════════════
export function RunnerTab({
  projects,
  activeProjectId,
  onSelectProject,
  onUpsertProject,
  onDeleteProject,
  onExportProject,
  onExportAll,
  _history = [],
  cacheEntries = [],
  onStartBatchRun,
  runningBatchId,
  isRunnerBusyByOther,
  onNavigateToHistory,
}) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [orderedIds, setOrderedIds] = useState([]);
  const [featureSearch, setFeatureSearch] = useState("");
  const [collapsedFeatures, setCollapsedFeatures] = useState({});
  const [editingOrderFeatId, setEditingOrderFeatId] = useState(null);
  const [editOrderInput, setEditOrderInput] = useState("");
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectToEdit, setProjectToEdit] = useState(null);

  const startEditingOrder = (e, feat, featIdx) => {
    e.stopPropagation();
    setEditingOrderFeatId(feat.id);
    setEditOrderInput(String(featIdx + 1));
  };

  const handleOrderInputChange = (e) => {
    const cleaned = e.target.value.replace(/\D/g, "");
    setEditOrderInput(cleaned);
  };

  const commitOrderChange = (featId) => {
    const target1Based = parseInt(editOrderInput, 10);
    if (!isNaN(target1Based) && target1Based >= 1 && target1Based <= orderedFeatures.length) {
      const targetIdx = target1Based - 1;
      setOrderedIds((prev) => {
        const currentIdx = prev.indexOf(featId);
        if (currentIdx === -1 || targetIdx < 0 || targetIdx >= prev.length || currentIdx === targetIdx) {
          return prev;
        }
        const next = [...prev];
        const [removed] = next.splice(currentIdx, 1);
        next.splice(targetIdx, 0, removed);
        return next;
      });
    }
    setEditingOrderFeatId(null);
  };

  const handleOrderKeyDown = (e, featId) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commitOrderChange(featId);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setEditingOrderFeatId(null);
    }
  };

  const currentProject = useMemo(() =>
    projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  const features = currentProject?.features || [];

  useEffect(() => {
    setSelectedIds(new Set());
    setOrderedIds([]);
  }, [activeProjectId]);

  useEffect(() => {
    setOrderedIds((prev) => {
      const kept = prev.filter((id) => selectedIds.has(id));
      const newIds = [...selectedIds].filter((id) => !kept.includes(id));
      return [...kept, ...newIds];
    });
  }, [selectedIds]);

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }, []);

  const filteredFeatures = useMemo(() =>
    features.filter((f) => f.name.toLowerCase().includes(featureSearch.toLowerCase())),
    [features, featureSearch]
  );

  const orderedFeatures = orderedIds.map((id) => features.find((f) => f.id === id)).filter(Boolean);
  const mergedSteps = orderedFeatures.flatMap((f) =>
    (f.steps || []).map((s) => ({ featureId: f.id, featureName: f.name, step: s }))
  );

  // Kiểm tra bước nào đã được ghi nhớ vào Step Cache
  const cachedStepsLookup = useMemo(() => {
    const map = new Map();
    if (!currentProject?.id) return map;
    for (const entry of cacheEntries || []) {
      if (entry.projectId === currentProject.id && entry.featureId && entry.featureId !== "*") {
        const key = `${entry.featureId}::${entry.normalizedText}`;
        const existing = map.get(key);
        const route = entry.routePath || "";
        if (!existing) {
          map.set(key, {
            ...entry,
            routes: route ? [route] : [],
          });
        } else {
          if (route && !existing.routes.includes(route)) {
            existing.routes.push(route);
          }
        }
      }
    }
    return map;
  }, [cacheEntries, currentProject?.id]);

  const getStepCacheMeta = useCallback(
    (featureId, stepText) => {
      if (!featureId) return null;
      const n = normStep(stepText);
      return cachedStepsLookup.get(`${featureId}::${n}`) || null;
    },
    [cachedStepsLookup]
  );

  const isStepCached = useCallback(
    (featureId, stepText) => Boolean(getStepCacheMeta(featureId, stepText)),
    [getStepCacheMeta]
  );

  const cachedMergedCount = useMemo(() => {
    return mergedSteps.filter((item) => isStepCached(item.featureId, item.step)).length;
  }, [mergedSteps, isStepCached]);

  const toggleFeatureCollapse = (featId) => {
    setCollapsedFeatures((prev) => ({ ...prev, [featId]: !prev[featId] }));
  };
  const expandAllFeatures = () => setCollapsedFeatures({});
  const collapseAllFeatures = () => {
    const next = {};
    orderedFeatures.forEach((f) => { next[f.id] = true; });
    setCollapsedFeatures(next);
  };

  const allSelected = features.length > 0 && features.every((f) => selectedIds.has(f.id));
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(features.map((f) => f.id)));
  };

  const handleOpenBatchModal = () => {
    if (orderedFeatures.length === 0) return;
    setBatchModalOpen(true);
  };

  const handleConfirmBatch = ({ name, notes }) => {
    if (onStartBatchRun) {
      onStartBatchRun({
        name,
        notes,
        features: orderedFeatures,
        projectId: currentProject?.id,
        projectName: currentProject?.name,
      });
    }
  };

  if (!currentProject) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 overflow-y-auto">
        <div className="max-w-md w-full text-center space-y-2 mb-6">
          <Rocket size={28} className="text-indigo-400 mx-auto" />
          <h2 className="text-base font-semibold text-white">
            Chọn dự án cần kiểm thử
          </h2>
          <p className="text-xs text-slate-300 font-medium">
            Chọn dự án bên dưới để hiển thị các tính năng cần test.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl w-full">
          {projects.map((proj) => {
            const featCount = proj.features?.length || 0;
            return (
              <div
                key={proj.id}
                onClick={() => onSelectProject(proj.id)}
                className="p-4 rounded-xl bg-slate-900 border border-slate-700 hover:border-slate-500 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-white">{proj.name}</h3>
                  <span className="text-xs text-slate-300 font-mono">{featCount} tính năng</span>
                </div>
                <p className="text-xs text-slate-300 line-clamp-1">{proj.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content flex h-full">
      {/* ── LEFT: Selector Tính năng của Dự án hiện tại ── */}
      <aside className="w-80 shrink-0 min-w-0 border-r border-slate-700 bg-slate-950 flex flex-col">
        {/* Dropdown chọn dự án */}
        <div className="px-4 py-3 border-b border-slate-700">
          <ProjectSelectorDropdown
            projects={projects}
            activeProject={currentProject}
            onSelectProject={onSelectProject}
            onCreateProject={() => { setProjectToEdit(null); setProjectModalOpen(true); }}
            onEditProject={(p) => { setProjectToEdit(p); setProjectModalOpen(true); }}
            onDeleteProject={(p) => onDeleteProject(p.id)}
            _onExportCurrentProject={() => onExportProject(currentProject)}
            _onExportAllProjects={onExportAll}
          />
        </div>

        {/* Tiêu đề & Chọn hết */}
        <div className="px-4 pt-3 pb-2.5 border-b border-slate-700 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-white font-semibold">Tính năng cần test</span>
            <div
              className="flex items-center gap-1.5 cursor-pointer"
              onClick={toggleAll}
            >
              <DarkCheckbox checked={allSelected} onChange={toggleAll} ariaLabel="Chọn hết" />
              <span className="text-slate-300 hover:text-white select-none font-medium">
                {allSelected ? "Bỏ chọn" : "Chọn hết"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700">
            <Search size={12} className="text-slate-400 shrink-0" />
            <input
              value={featureSearch}
              onChange={(e) => setFeatureSearch(e.target.value)}
              placeholder="Lọc tính năng…"
              className="flex-1 min-w-0 bg-transparent text-xs text-white placeholder:text-slate-400 outline-none"
            />
          </div>
        </div>

        {/* Danh sách tính năng */}
        <div className="flex-1 overflow-y-auto px-3.5 py-2 space-y-0.5">
          {filteredFeatures.map((feat) => {
            const checked = selectedIds.has(feat.id);
            const stepsArr = feat.steps || [];
            const featCachedCount = stepsArr.filter((st) => isStepCached(feat.id, st)).length;
            return (
              <label
                key={feat.id}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded border transition-colors text-xs cursor-pointer ${checked
                  ? "bg-indigo-600/30 text-white font-medium border-indigo-500/40"
                  : "border-transparent text-slate-200 hover:text-white hover:bg-slate-900"
                  }`}
              >
                <DarkCheckbox
                  checked={checked}
                  onChange={() => toggleSelect(feat.id)}
                  ariaLabel={feat.name}
                />
                <span className="flex-1 truncate">{feat.name}</span>
                {stepsArr.length > 0 && featCachedCount > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 text-[10px] font-mono text-emerald-400 shrink-0"
                    title={`${featCachedCount}/${stepsArr.length} bước đã có Step Cache ⚡`}
                  >
                    <Zap size={10} />
                    {featCachedCount}/{stepsArr.length}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {/* Footer sidebar */}
        <div className="h-12 shrink-0 px-4 border-t border-slate-700 text-xs text-slate-300 font-medium flex items-center justify-between">
          <span>Đã chọn {selectedIds.size}/{features.length}</span>
        </div>
      </aside>

      {/* ── RIGHT: Thứ tự chạy ── */}
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-950">
        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="max-w-[850px] mx-auto w-full space-y-6">
            {orderedFeatures.length === 0 ? (
              <div className="py-20 text-center text-xs text-slate-300 font-medium">
                Tick chọn tính năng ở thanh bên trái để kiểm thử
              </div>
            ) : (
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-200 font-semibold">
                    Thứ tự chạy
                  </div>
                  {orderedFeatures.length > 1 && (
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <button
                        type="button"
                        onClick={expandAllFeatures}
                        className="hover:text-indigo-400 transition-colors cursor-pointer"
                      >
                        Mở rộng tất cả
                      </button>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={collapseAllFeatures}
                        className="hover:text-indigo-400 transition-colors cursor-pointer"
                      >
                        Thu gọn tất cả
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {orderedFeatures.map((feat, featIdx) => {
                    const isCollapsed = !!collapsedFeatures[feat.id];
                    const steps = feat.steps || [];

                    return (
                      <div
                        key={feat.id}
                        className="border border-slate-700/80 rounded-lg overflow-hidden bg-slate-900/60 shadow-sm transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => toggleFeatureCollapse(feat.id)}
                          className="w-full flex items-center justify-between px-3.5 py-2.5 bg-slate-800/60 hover:bg-slate-800/90 transition-colors text-left cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <span className="text-indigo-400 shrink-0 flex items-center">
                              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            </span>

                            {/* Số thứ tự và nút sửa */}
                            {editingOrderFeatId === feat.id ? (
                              <div
                                className="flex items-center shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="text"
                                  autoFocus
                                  value={editOrderInput}
                                  onChange={handleOrderInputChange}
                                  onKeyDown={(e) => handleOrderKeyDown(e, feat.id)}
                                  onBlur={() => setEditingOrderFeatId(null)}
                                  className="w-10 px-1 py-0.5 text-center text-sm font-mono font-bold bg-slate-950 border border-indigo-500 rounded text-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                  title={`Nhập vị trí mới (1 - ${orderedFeatures.length}) rồi nhấn Enter`}
                                />
                              </div>
                            ) : (
                              <div
                                className="flex items-center gap-1 shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <span className="text-indigo-400 font-mono text-sm font-bold min-w-4 text-center">
                                  {featIdx + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => startEditingOrder(e, feat, featIdx)}
                                  className="p-1 rounded text-indigo-400 hover:text-indigo-300 hover:bg-slate-700/60 transition-colors cursor-pointer flex items-center justify-center"
                                  title="Đổi thứ tự chạy"
                                  aria-label={`Đổi thứ tự chạy của ${feat.name}`}
                                >
                                  <Pencil size={13} />
                                </button>
                              </div>
                            )}

                            {/* Tên tính năng */}
                            <span className="text-sm font-bold text-indigo-400 truncate">
                              {feat.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0 ml-2">
                            {(() => {
                              const cCount = steps.filter((st) => isStepCached(feat.id, st)).length;
                              return cCount > 0 ? (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[10px]"
                                  title="Các bước đã được lưu trong Step Cache sẽ chạy tức thì (~0.05s/bước)"
                                >
                                  <Zap size={10} /> {cCount}/{steps.length} Cache
                                </span>
                              ) : null;
                            })()}
                            <span className="text-indigo-400 font-mono text-sm flex items-center">
                              {steps.length} bước
                            </span>
                          </div>
                        </button>

                        {!isCollapsed && (
                          <div className="border-t border-slate-800 divide-y divide-slate-800/80 bg-slate-950/40">
                            {steps.length === 0 ? (
                              <div className="px-3.5 py-2 text-xs text-slate-500 italic">
                                Chưa có bước thực hiện nào được thiết lập cho tính năng này
                              </div>
                            ) : (
                              steps.map((stepText, stepIdx) => {
                                const cacheMeta = getStepCacheMeta(feat.id, stepText);
                                return (
                                  <div
                                    key={stepIdx}
                                    className="flex items-start gap-3 px-3.5 py-2 text-xs hover:bg-slate-900/60 transition-colors"
                                  >
                                    <span className="text-slate-400 font-mono w-5 shrink-0 text-right font-medium pt-0.5">
                                      {stepIdx + 1}
                                    </span>
                                    <span className="text-slate-200 font-mono flex-1 leading-relaxed break-words">
                                      {stepText}
                                    </span>
                                    {cacheMeta && (
                                      <span
                                        className="inline-flex items-center gap-0.5 text-[10px] font-mono text-emerald-400 shrink-0 pt-0.5"
                                        title={`Bước này sẽ phát lại từ Step Cache${
                                          cacheMeta.routes?.length
                                            ? ` (Route: ${cacheMeta.routes.join(", ")})`
                                            : ""
                                        } (0 gọi AI)`}
                                      >
                                        <Zap size={10} /> Cache
                                      </span>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>

        {/* Thanh chạy test */}
        <footer className="h-12 shrink-0 px-6 border-t border-slate-700 bg-slate-950 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-slate-300 font-medium">
            <span>{orderedFeatures.length} tính năng • {mergedSteps.length} bước</span>
            {mergedSteps.length > 0 && cachedMergedCount > 0 && (
              <>
                <span className="text-slate-600">•</span>
                <span className="inline-flex items-center gap-1 text-emerald-400 font-mono text-[11px]">
                  <Zap size={12} /> {cachedMergedCount}/{mergedSteps.length} bước Cache
                </span>
              </>
            )}
          </div>

          {runningBatchId ? (
            <button
              type="button"
              onClick={onNavigateToHistory}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700 text-indigo-300 hover:text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
            >
              <Loader2 size={14} className="animate-spin text-indigo-400" /> Xem đợt chạy đang diễn ra
            </button>
          ) : isRunnerBusyByOther ? (
            <div
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-amber-950/60 border border-amber-800 text-amber-300 text-xs font-medium cursor-not-allowed select-none shadow-sm"
              title="Máy chủ đang bận xử lý đợt kiểm thử từ máy khác trên mạng LAN. Vui lòng đợi hoàn tất trước khi bắt đầu."
            >
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              Máy khác đang chạy kiểm thử...
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleConfirmBatch({ name: generateBatchRunName(), notes: "" })}
                disabled={orderedFeatures.length === 0}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 disabled:opacity-40 disabled:cursor-not-allowed border border-emerald-500/40 text-emerald-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
                title="Chạy ngay với tên tự động theo ngày giờ"
              >
                <Zap size={14} /> Chạy nhanh
              </button>
              <button
                type="button"
                onClick={handleOpenBatchModal}
                disabled={orderedFeatures.length === 0}
                className="flex items-center gap-1.5 px-5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
              >
                <PlayCircle size={15} /> Đặt tên & Chạy
              </button>
            </div>
          )}
        </footer>
      </main>

      <NewBatchModal
        isOpen={batchModalOpen}
        onClose={() => setBatchModalOpen(false)}
        onStart={handleConfirmBatch}
      />

      <ProjectModal
        isOpen={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
        onSave={onUpsertProject}
        project={projectToEdit}
      />
    </div>
  );
}

export default RunnerTab;


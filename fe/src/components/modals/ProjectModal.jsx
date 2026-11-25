import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Wand2,
  AlertCircle,
  Rocket,
  PlayCircle,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  KeyRound,
  ShieldCheck,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { apiClient } from "../../api/client.js";
import { genId, generateBatchRunName } from "../../utils/formatters.js";

const createEmptyVarRow = () => ({
  localId: genId("vrow"),
  id: genId("var"),
  key: "",
  value: "",
  isSecret: false,
  description: "",
});

export function ProjectModal({ isOpen, onClose, onSave, project = null }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sessionMode, setSessionMode] = useState("fresh");
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [variables, setVariables] = useState([]);
  const [varsLoading, setVarsLoading] = useState(false);
  const [varsLoadFailed, setVarsLoadFailed] = useState(false);
  const [revealedIds, setRevealedIds] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [clearingSession, setClearingSession] = useState(false);
  const [sessionNotice, setSessionNotice] = useState("");
  const [error, setError] = useState("");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    if (project) {
      setName(project.name || "");
      setDescription(project.description || "");
      setSessionMode(project.sessionMode === "persist" ? "persist" : "fresh");
      setHasSavedSession(Boolean(project.hasSavedSession));
    } else {
      setName("");
      setDescription("");
      setSessionMode("fresh");
      setHasSavedSession(false);
    }

    setVariables([]);
    setVarsLoadFailed(false);
    setRevealedIds(new Set());
    setSessionNotice("");
    setError("");
    setSaving(false);

    if (!project?.id) {
      setVarsLoading(false);
      return;
    }

    const controller = new AbortController();
    setVarsLoading(true);
    apiClient
      .getProjectVariables(project.id, controller.signal)
      .then((res) => {
        const loaded = Array.isArray(res?.variables) ? res.variables : [];
        setVariables(
          loaded.map((v) => ({
            localId: genId("vrow"),
            id: v.id || genId("var"),
            key: v.key || "",
            value: v.value ?? "",
            isSecret: Boolean(v.isSecret),
            description: v.description || "",
          }))
        );
        if (typeof res?.hasSavedSession === "boolean") {
          setHasSavedSession(res.hasSavedSession);
        }
      })
      .catch((err) => {
        if (err?.name !== "AbortError") {
          setVarsLoadFailed(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setVarsLoading(false);
        }
      });

    return () => controller.abort();
  }, [project, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onCloseRef.current?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const addVarRow = () => {
    setVariables((prev) => [...prev, createEmptyVarRow()]);
  };

  const updateVarRow = (localId, patch) => {
    setVariables((prev) => prev.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));
    if (error) setError("");
  };

  const removeVarRow = (localId) => {
    setVariables((prev) => prev.filter((r) => r.localId !== localId));
  };

  const toggleReveal = (localId) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(localId)) next.delete(localId);
      else next.add(localId);
      return next;
    });
  };

  const handleClearSavedSession = async () => {
    if (!project?.id || clearingSession) return;
    setClearingSession(true);
    setSessionNotice("");
    try {
      await apiClient.clearProjectSession(project.id);
      setHasSavedSession(false);
      setSessionNotice("Đã xóa cookie & storageState đã lưu cho dự án này.");
    } catch (err) {
      setError(err.message || "Không thể xóa phiên đăng nhập đã lưu");
    } finally {
      setClearingSession(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Vui lòng nhập tên dự án");
      return;
    }

    const cleanedVars = [];
    const seenKeys = new Set();
    for (const row of variables) {
      const key = String(row.key || "").trim();
      const val = String(row.value ?? "");
      if (!key && !val && !String(row.description || "").trim()) {
        continue;
      }
      if (!key) {
        setError("Tên biến không được để trống khi đã nhập giá trị.");
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(key)) {
        setError(`Tên biến "${key}" chỉ được chứa chữ cái, số và dấu gạch dưới (_).`);
        return;
      }
      if (seenKeys.has(key)) {
        setError(`Tên biến "{{${key}}}" bị trùng lặp.`);
        return;
      }
      seenKeys.add(key);
      cleanedVars.push({
        id: row.id || genId("var"),
        key,
        value: val,
        isSecret: Boolean(row.isSecret),
        description: String(row.description || "").trim(),
      });
    }

    setSaving(true);
    setError("");
    const targetProjectId = project?.id || genId("proj");
    try {
      const savedProj = await onSave({
        id: targetProjectId,
        name: trimmed,
        description: description.trim(),
        sessionMode,
        createdAt: project?.createdAt || new Date().toISOString(),
        features: project?.features || [],
      });
      const finalProjectId = savedProj?.id || targetProjectId;
      if (!varsLoadFailed && !varsLoading) {
        await apiClient.saveProjectVariables(finalProjectId, cleanedVars);
      }
      onClose();
    } catch (err) {
      setError(err?.message || "Không thể lưu thông tin dự án");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between shrink-0">
          <h3 className="text-sm font-semibold text-white">
            {project ? "Cấu hình dự án & Biến kịch bản" : "Tạo dự án mới"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="text-slate-400 hover:text-white p-1 cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Tên dự án</label>
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (error) setError("");
                  }}
                  placeholder="VD: Cổng dịch vụ trực tuyến"
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-400 outline-none focus:border-indigo-400 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Mô tả (tùy chọn)</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Mô tả phạm vi hoặc mục tiêu kiểm thử"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-400 outline-none focus:border-indigo-400 transition-colors"
                />
              </div>
            </div>

            {/* ── CHẾ ĐỘ PHIÊN TRÌNH DUYỆT (SESSION PERSISTENCE) ── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-indigo-400" />
                  Phiên đăng nhập trình duyệt mặc định
                </label>
                {project?.id && hasSavedSession && (
                  <button
                    type="button"
                    onClick={handleClearSavedSession}
                    disabled={clearingSession}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-rose-950/70 border border-slate-700 hover:border-rose-500/40 text-[11px] text-rose-300 transition-colors cursor-pointer disabled:opacity-50"
                    title="Xóa Cookie và localStorage đã lưu cho dự án này"
                  >
                    {clearingSession ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                    Xóa phiên đã lưu
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setSessionMode("fresh")}
                  className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                    sessionMode === "fresh"
                      ? "bg-indigo-600/15 border-indigo-500 text-white"
                      : "bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  <div className="text-xs font-semibold">Tạo phiên trắng mỗi lần chạy</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Xóa sạch Cookie & Storage để các test chạy hoàn toàn độc lập (Khuyên dùng).
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSessionMode("persist")}
                  className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                    sessionMode === "persist"
                      ? "bg-emerald-600/15 border-emerald-500 text-white"
                      : "bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">Dùng lại trạng thái đăng nhập</span>
                    {hasSavedSession && (
                      <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
                        storageState
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Lưu Cookie & localStorage (storageState) để các kịch bản sau tái sử dụng phiên đăng nhập.
                  </div>
                </button>
              </div>

              {sessionNotice && (
                <p className="text-[11px] text-emerald-300">{sessionNotice}</p>
              )}
            </div>

            {/* ── KHO BIẾN KỊCH BẢN ({{variable}}) ── */}
            <div className="space-y-2 border-t border-slate-800 pt-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                    <KeyRound size={13} className="text-amber-400" />
                    Biến môi trường kịch bản (<code className="font-mono text-amber-300">{"{{ten_bien}}"}</code>)
                  </label>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Tự động thay thế vào các bước khi chạy (ví dụ: <code className="font-mono text-slate-300">{"{{username}}"}</code>,{" "}
                    <code className="font-mono text-slate-300">{"{{password}}"}</code>).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addVarRow}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-indigo-300 hover:text-white border border-slate-700 transition-colors shrink-0 cursor-pointer"
                >
                  <Plus size={12} /> Thêm biến
                </button>
              </div>

              {varsLoading ? (
                <div className="flex items-center gap-2 py-4 justify-center text-xs text-slate-400">
                  <Loader2 size={14} className="animate-spin" /> Đang tải biến môi trường…
                </div>
              ) : varsLoadFailed ? (
                <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-200">
                  Không tải được danh sách biến từ máy chủ. Bạn vẫn có thể cập nhật tên và chế độ phiên của dự án.
                </div>
              ) : variables.length === 0 ? (
                <div className="p-3 rounded-lg bg-slate-950/60 border border-dashed border-slate-800 text-center text-[11px] text-slate-400">
                  Chưa có biến nào. Nhấn &ldquo;Thêm biến&rdquo; để khai báo tài khoản test hoặc tham số dùng chung cho dự án.
                </div>
              ) : (
                <div className="space-y-2">
                  {variables.map((row) => {
                    const isMasked = row.isSecret && !revealedIds.has(row.localId);
                    return (
                      <div
                        key={row.localId}
                        className="grid grid-cols-12 gap-2 items-center bg-slate-950/80 border border-slate-800 rounded-lg p-2"
                      >
                        <div className="col-span-4">
                          <input
                            value={row.key}
                            onChange={(e) => updateVarRow(row.localId, { key: e.target.value })}
                            placeholder="username"
                            aria-label="Tên biến"
                            className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs font-mono text-amber-300 placeholder:text-slate-500 outline-none focus:border-indigo-400"
                          />
                        </div>

                        <div className="col-span-5 flex items-center gap-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 focus-within:border-indigo-400">
                          <input
                            type={isMasked ? "password" : "text"}
                            value={row.value}
                            onChange={(e) => updateVarRow(row.localId, { value: e.target.value })}
                            placeholder="Giá trị biến"
                            aria-label="Giá trị biến"
                            autoComplete="new-password"
                            className="flex-1 min-w-0 bg-transparent text-xs text-white placeholder:text-slate-500 outline-none"
                          />
                          {row.isSecret && (
                            <button
                              type="button"
                              onClick={() => toggleReveal(row.localId)}
                              aria-label={isMasked ? "Hiện giá trị" : "Ẩn giá trị"}
                              title={isMasked ? "Hiện giá trị" : "Ẩn giá trị"}
                              className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
                            >
                              {isMasked ? <Eye size={13} /> : <EyeOff size={13} />}
                            </button>
                          )}
                        </div>

                        <div className="col-span-3 flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => updateVarRow(row.localId, { isSecret: !row.isSecret })}
                            title={
                              row.isSecret
                                ? "Đang đánh dấu Bí mật (che khi log & hiện mật khẩu)"
                                : "Đánh dấu là biến nhạy cảm (Mật khẩu/Token)"
                            }
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                              row.isSecret
                                ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                                : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <Lock size={11} />
                            <span>Bí mật</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeVarRow(row.localId)}
                            aria-label="Xóa biến"
                            title="Xóa biến"
                            className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {error && (
              <p className="text-xs text-rose-400 flex items-center gap-1.5 font-medium bg-rose-950/30 border border-rose-500/30 rounded-lg px-3 py-2">
                <AlertCircle size={13} className="shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving || varsLoading}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              {project ? "Cập nhật" : "Tạo dự án"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function JsonImportModal({ isOpen, onClose, onImport, projectName }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) {
      setText("");
      setError("");
      return;
    }
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onCloseRef.current?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const readFile = (file) => {
    if (!file?.name.endsWith(".json")) return setError("Chỉ chấp nhận file .json");
    const r = new FileReader();
    r.onload = (e) => { setText(e.target.result); setError(""); };
    r.readAsText(file);
  };

  const formatJson = () => {
    try {
      setText(JSON.stringify(JSON.parse(text), null, 2));
      setError("");
    } catch {
      setError("JSON không hợp lệ");
    }
  };

  const handleImport = () => {
    try {
      const raw = JSON.parse(text);
      const arr = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw.features)
          ? raw.features
          : (Array.isArray(raw.projects)
            ? raw.projects.flatMap((p) => p.features || [])
            : [raw]));
      const feats = arr.map((f) => ({
        id: f.id || genId("feat"),
        name: String(f.name || f.title || "Tính năng không tên"),
        steps: Array.isArray(f.steps) ? f.steps.map(String) : [],
      }));
      if (!feats.length) throw new Error("Không có tính năng nào");
      onImport(feats);
      onClose();
    } catch (err) {
      setError("Lỗi định dạng: " + err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl p-5 space-y-3"
      >
        <div className="flex items-center justify-between pb-2 border-b border-slate-700">
          <div>
            <h3 className="text-sm font-semibold text-white">Nhập tính năng từ JSON</h3>
            <p className="text-xs text-slate-300 mt-0.5">{projectName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="text-slate-400 hover:text-white p-1">
            <X size={14} />
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-300 font-medium">
            <label>Nội dung JSON hoặc chọn file</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-indigo-400 hover:text-indigo-300 hover:underline"
              >
                Chọn file
              </button>
              <button
                type="button"
                onClick={formatJson}
                className="text-slate-300 hover:text-white transition-colors flex items-center gap-1"
              >
                <Wand2 size={11} /> Format
              </button>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden"
            onChange={(e) => { readFile(e.target.files[0]); e.target.value = ""; }} />

          <textarea
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 placeholder:text-slate-400 font-mono outline-none focus:border-indigo-400 transition-colors resize-y"
            rows={7}
            placeholder={'[\n  {\n    "name": "Đăng nhập",\n    "steps": ["Mở trang web", "Bấm Đăng nhập"]\n  }\n]'}
            value={text}
            onChange={(e) => { setText(e.target.value); setError(""); }}
          />
          {error && <p className="text-xs text-rose-400 flex items-center gap-1 font-medium"><AlertCircle size={12} />{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!text.trim()}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-400 text-white text-xs font-semibold transition-colors"
          >
            Nhập vào dự án
          </button>
        </div>
      </div>
    </div>
  );
}

export function NewBatchModal({ isOpen, onClose, onStart }) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const inputRef = useRef(null);
  const focusTimerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    setName(generateBatchRunName());
    setNotes("");
    focusTimerRef.current = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 50);

    const handleKeyDown = (e) => {
      if (e.key === "Escape") onCloseRef.current?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (!name.trim()) return;
    onStart({ name: name.trim(), notes: notes.trim() });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-none"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="px-5 py-3.5 border-b border-slate-700 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-2">
            <Rocket size={16} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Đợt chạy mới</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md transition-colors cursor-pointer"
            title="Đóng"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white flex items-center justify-between">
              <span>Tên đợt chạy <span className="text-rose-400">*</span></span>
            </label>
            <input
              ref={inputRef}
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nhập tên đợt chạy..."
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white">
              Ghi chú <span className="text-slate-400 font-normal">(tùy chọn)</span>
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Thêm ghi chú cho đợt chạy này..."
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <PlayCircle size={14} /> Bắt đầu chạy
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


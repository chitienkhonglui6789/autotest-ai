import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  GripVertical,
  X,
  Folder,
  ChevronDown,
  Plus,
  Search,
  Pencil,
  Trash2,
  PanelLeft,
  FileJson,
  Copy,
  AlertCircle,
  Download,
  PanelLeftClose,
  Sparkles,
  Zap,
  PlayCircle,
  RotateCcw,
  Loader2,
  Check,
  KeyRound,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  useSensors,
  useSensor,
  PointerSensor,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { genId, saveShortcutText, splitParagraphSentencesLocally } from "../../utils/formatters.js";
import { apiClient } from "../../api/client.js";
import { ConfirmModal } from "../common/Modals.jsx";
import { ProjectModal, JsonImportModal } from "../modals/ProjectModal.jsx";

const normalizeStepKey = (text) =>
  String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const hasSoftFlag = (text) => /\[soft\]|\[tùy chọn\]|\[optional\]/i.test(String(text || ""));

const toggleSoftText = (text) => {
  const s = String(text || "");
  if (hasSoftFlag(s)) {
    return s.replace(/\s*(?:\[soft\]|\[tùy chọn\]|\[optional\])\s*/gi, " ").trim();
  }
  return s.trim() ? `${s.trim()} [soft]` : "[soft]";
};

// ═══════════════════════════════════════════════════════════════════
// MODAL TÁCH ĐOẠN VĂN THÀNH CÁC BƯỚC KIỂM THỬ (SMART SPLIT)
// ═══════════════════════════════════════════════════════════════════
function SmartSplitModal({ isOpen, initialText = "", onClose, onApply }) {
  const [rawText, setRawText] = useState(initialText);
  const [previewSteps, setPreviewSteps] = useState([]);
  const [note, setNote] = useState("");
  const [isSplitting, setIsSplitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onCloseRef.current?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setRawText(initialText || "");
    setPreviewSteps([]);
    setNote("");
    setErrorMsg("");

    if (initialText && initialText.trim()) {
      runSplit(initialText, "fast");
    }
  }, [isOpen, initialText]);

  const runSplit = async (textToSplit, mode = "smart") => {
    const clean = String(textToSplit || "").trim();
    if (!clean) {
      setErrorMsg("Vui lòng dán mô tả kịch bản vào ô bên trên trước.");
      return;
    }
    setIsSplitting(true);
    setErrorMsg("");
    try {
      const res = await apiClient.splitSteps(clean, mode);
      setPreviewSteps(Array.isArray(res.steps) ? res.steps : []);
      setNote(res.note || "");
    } catch (err) {
      setErrorMsg(err.message || "Không thể tách bước.");
    } finally {
      setIsSplitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-none"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
      >
        <div className="px-5 py-3.5 border-b border-slate-700 flex items-center justify-between bg-slate-950/80 shrink-0">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
              <Sparkles size={16} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">Dán & Tách đoạn văn thành các bước chuẩn</h3>
              <p className="text-[11px] text-slate-400">
                Dán mô tả tự nhiên từ tài liệu/chat để tự động tách thành từng bước nhỏ, dễ bảo trì & tái sử dụng Cache ⚡
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-200 block">
              Đoạn mô tả kịch bản cần tách:
            </label>
            <textarea
              rows={5}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="Ví dụ: Mở trang http://127.0.0.1:5050, nhập admin vào ô Tên đăng nhập và 123456 vào ô Mật khẩu, nhấn nút Đăng nhập ngay. Sau đó vào mục Quản lý Đơn hàng và kiểm tra hiển thị nút Thêm vào giỏ."
              className="w-full px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed"
            />
          </div>

          <div className="flex items-center flex-wrap gap-2">
            <button
              type="button"
              disabled={isSplitting}
              onClick={() => runSplit(rawText, "fast")}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSplitting ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} className="text-amber-400" />}
              <span>Tách nhanh theo câu (0ms)</span>
            </button>

            <button
              type="button"
              disabled={isSplitting}
              onClick={() => runSplit(rawText, "ai")}
              className="px-3 py-1.5 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSplitting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} className="text-indigo-400" />}
              <span>AI Phân tích & Tách bước tiếng Việt</span>
            </button>

            {note && (
              <span className="text-[11px] text-emerald-400 ml-auto font-mono">{note}</span>
            )}
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
              {errorMsg}
            </div>
          )}

          {previewSteps.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                Xem trước kết quả ({previewSteps.length} bước) — có thể chỉnh sửa trực tiếp:
              </div>
              <div className="space-y-1.5">
                {previewSteps.map((st, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="w-5 text-right font-mono text-slate-400 text-[11px] shrink-0">
                      {idx + 1}.
                    </span>
                    <input
                      value={st}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPreviewSteps((prev) => prev.map((item, i) => (i === idx ? val : item)));
                      }}
                      className="flex-1 px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 focus:border-indigo-500 text-slate-100 text-xs outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setPreviewSteps((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                      title="Xóa dòng này"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={previewSteps.filter((s) => s.trim()).length === 0}
            onClick={() => {
              onApply(previewSteps.map((s) => s.trim()).filter(Boolean), "append");
              onClose();
            }}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
          >
            Chèn thêm vào cuối
          </button>
          <button
            type="button"
            disabled={previewSteps.filter((s) => s.trim()).length === 0}
            onClick={() => {
              onApply(previewSteps.map((s) => s.trim()).filter(Boolean), "replace");
              onClose();
            }}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Check size={13} /> Thay thế danh sách bước
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HÀNG BƯỚC TEST (Gạch chân rõ ràng, Cache badge ⚡, nút [Soft])
// ═══════════════════════════════════════════════════════════════════
export function SortableStepRow({
  id,
  index,
  step,
  onUpdate,
  onRemove,
  onKeyDown,
  onBlur,
  onMultiLinePaste,
  onClearStepCache,
  cacheEntry = null,
  hasError,
  inputRef,
  disabled = false,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });

  const isSoft = hasSoftFlag(step);

  const handlePaste = (e) => {
    if (!onMultiLinePaste) return;
    const pasted = e.clipboardData?.getData("text/plain") || "";
    const lines = pasted
      .split(/\r?\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length > 1) {
      e.preventDefault();
      onMultiLinePaste(lines, { fromParagraph: false });
      return;
    }
    const sentenceParts = splitParagraphSentencesLocally(pasted);
    if (sentenceParts.length > 1) {
      e.preventDefault();
      onMultiLinePaste(sentenceParts, { fromParagraph: true });
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`group relative flex items-center py-1 transition-colors ${isDragging ? "bg-slate-900" : ""}`}
    >
      {/* Handle kéo thả */}
      <button
        type="button"
        disabled={disabled}
        aria-label={`Kéo để sắp xếp lại bước ${index + 1}`}
        className={`drag-handle absolute -left-5 p-0.5 text-slate-400 transition-opacity ${
          disabled ? "opacity-0 cursor-not-allowed" : "hover:text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={13} />
      </button>

      {/* Số thứ tự */}
      <span className="w-6 shrink-0 text-xs text-slate-300 font-medium tabular-nums select-none text-left font-mono">
        {index + 1}.
      </span>

      {/* Ô nhập */}
      <div className="flex-1 min-w-0">
        <input
          ref={inputRef}
          value={step}
          disabled={disabled}
          onChange={(e) => onUpdate(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => onKeyDown(e, index)}
          onBlur={onBlur}
          placeholder="Mô tả bước tiếng Việt, vd: Bấm nút Đăng nhập (dán nhiều dòng để tự tách)"
          className={`w-full bg-transparent border-0 border-b ${
            hasError
              ? "border-rose-500 focus:border-rose-400"
              : "border-slate-700 focus:border-indigo-400"
          } px-0 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed`}
          aria-label={`Nội dung bước ${index + 1}`}
        />
      </div>

      {/* Công cụ nhỏ bên phải bước: Badge Cache ⚡ & Toggle [soft] */}
      <div className="flex items-center gap-1 ml-2 shrink-0">
        {cacheEntry && (
          <button
            type="button"
            onClick={() => onClearStepCache && onClearStepCache(step)}
            title={`Bước này đã ghi nhớ trong Step Cache${
              cacheEntry.routes?.length
                ? ` (Route: ${cacheEntry.routes.join(", ")})`
                : cacheEntry.routePath
                  ? ` (Route: ${cacheEntry.routePath})`
                  : ""
            } (${cacheEntry.actionsSummary?.join(" → ") || "ready"}). Bấm để xóa cache bước này và cho AI học lại.`}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-500/15 hover:bg-rose-500/20 border border-emerald-500/30 hover:border-rose-500/40 text-emerald-300 hover:text-rose-300 text-[10px] font-mono transition-colors cursor-pointer"
          >
            <Zap size={10} />
            <span className="hidden sm:inline">Cache</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => onUpdate(toggleSoftText(step))}
          disabled={disabled}
          title={
            isSoft
              ? "Đang bật [Soft Assertion]: nếu kiểm tra sai chỉ cảnh báo, vẫn chạy tiếp các bước sau"
              : "Bật [Soft Assertion] cho bước này (sai vẫn chạy tiếp)"
          }
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
            isSoft
              ? "bg-amber-500/20 border-amber-500/40 text-amber-300 font-semibold"
              : "bg-slate-900 border-slate-800 text-slate-500 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-amber-300 hover:border-amber-500/30"
          }`}
        >
          soft
        </button>

        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Xóa bước ${index + 1}`}
          title="Xóa bước này"
          className={`p-1 rounded text-slate-400 transition-opacity ${
            disabled ? "opacity-0 cursor-not-allowed" : "hover:text-rose-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DROPDOWN CHỌN DỰ ÁN
// ═══════════════════════════════════════════════════════════════════
export function ProjectSelectorDropdown({
  projects,
  activeProject,
  onSelectProject,
  onCreateProject,
  onEditProject,
  onDeleteProject,
  _onExportCurrentProject,
  _onExportAllProjects,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen]);

  const filteredProjects = useMemo(
    () => projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())),
    [projects, search]
  );

  return (
    <div className="relative min-w-0 w-full" ref={dropdownRef}>
      <div className="flex items-center justify-between gap-1 p-1 rounded-lg bg-slate-950 border border-slate-700 min-w-0">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex-1 min-w-0 overflow-hidden flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-left rounded hover:bg-slate-900 transition-colors cursor-pointer"
          aria-expanded={isOpen}
          aria-label="Chọn dự án"
        >
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <Folder size={14} className="text-indigo-400 shrink-0" />
            <span className="text-xs font-semibold text-white truncate">
              {activeProject ? activeProject.name : "Chưa chọn dự án"}
            </span>
          </div>
          <ChevronDown size={14} className={`text-slate-300 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </button>

        <button
          type="button"
          onClick={onCreateProject}
          aria-label="Tạo dự án mới"
          title="Tạo dự án mới"
          className="shrink-0 p-1.5 rounded text-slate-300 hover:text-indigo-400 hover:bg-slate-900 transition-colors cursor-pointer"
        >
          <Plus size={14} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-40 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-2 space-y-1.5 w-full min-w-0">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-950 border border-slate-700">
            <Search size={12} className="text-slate-400 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm dự án…"
              className="flex-1 min-w-0 bg-transparent text-xs text-white placeholder:text-slate-400 outline-none"
              autoFocus
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-slate-400 hover:text-white shrink-0">
                <X size={11} />
              </button>
            )}
          </div>

          <div className="max-h-48 overflow-y-auto space-y-0.5 py-1">
            {filteredProjects.length === 0 ? (
              <p className="text-xs text-slate-300 text-center py-2">Không tìm thấy dự án</p>
            ) : (
              filteredProjects.map((p) => {
                const isActive = activeProject?.id === p.id;
                const featCount = p.features?.length || 0;
                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      onSelectProject(p.id);
                      setIsOpen(false);
                    }}
                    className={`group flex items-center justify-between gap-1 px-2 py-1.5 rounded border cursor-pointer transition-colors text-xs ${
                      isActive
                        ? "bg-indigo-600/25 text-white font-medium border-indigo-500/40"
                        : "border-transparent hover:bg-slate-800 text-slate-200"
                    }`}
                  >
                    <span className="truncate flex-1 min-w-0">
                      {p.name} ({featCount})
                    </span>
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditProject(p);
                          setIsOpen(false);
                        }}
                        title="Đổi tên"
                        className="p-1 text-slate-300 hover:text-white"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteProject(p);
                          setIsOpen(false);
                        }}
                        title="Xóa"
                        className="p-1 text-slate-300 hover:text-rose-400"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FORM SOẠN THẢO TÍNH NĂNG
// ═══════════════════════════════════════════════════════════════════
export function FeatureEditorPanel({
  activeProject,
  editTarget,
  onSave,
  _onCancelEdit,
  onDeleteCurrent,
  onOpenJsonModal,
  onOpenProjectSettings,
  onDuplicate,
  onOpenSidebar,
  sidebarOpen,
  onReorderFeature,
  cacheEntries = [],
  onClearCache,
  onQuickRunFeature,
  runningBatchId,
  isRunnerBusyByOther,
}) {
  const isEditing = !!editTarget;
  const [name, setName] = useState("");
  const [steps, setSteps] = useState([{ id: genId("step"), text: "" }]);
  const [sessionMode, setSessionMode] = useState("inherit");
  const [touched, setTouched] = useState(new Set());
  const [submitted, setSubmitted] = useState(false);

  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [orderInput, setOrderInput] = useState("");
  const orderInputRef = useRef(null);

  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [splitInitialText, setSplitInitialText] = useState("");

  const totalFeatures = activeProject?.features?.length || 0;
  const currentFeatIdx = isEditing
    ? (activeProject?.features || []).findIndex((f) => f.id === editTarget.id)
    : -1;
  const currentOrder = isEditing && currentFeatIdx >= 0 ? currentFeatIdx + 1 : totalFeatures + 1;

  const commitOrderChange = () => {
    const target = parseInt(orderInput, 10);
    if (!isNaN(target) && target >= 1 && target <= totalFeatures) {
      if (target !== currentOrder && onReorderFeature) {
        onReorderFeature(editTarget.id, target);
      }
    }
    setIsEditingOrder(false);
  };

  const [editorNotice, setEditorNotice] = useState("");
  const nameInputRef = useRef(null);
  const lastInputRef = useRef(null);
  const shouldFocusLastStepRef = useRef(false);
  const saveHandlerRef = useRef(null);

  useEffect(() => {
    let focusTimer = null;
    if (editTarget) {
      setName(editTarget.name || "");
      setSessionMode(editTarget.sessionMode || "inherit");
      const loadedSteps =
        Array.isArray(editTarget.steps) && editTarget.steps.length > 0
          ? editTarget.steps.map((s) => ({ id: genId("step"), text: s }))
          : [{ id: genId("step"), text: "" }];
      setSteps(loadedSteps);
    } else {
      setName("");
      setSessionMode("inherit");
      setSteps([{ id: genId("step"), text: "" }]);
      focusTimer = setTimeout(() => nameInputRef.current?.focus(), 50);
    }
    shouldFocusLastStepRef.current = false;
    setTouched(new Set());
    setSubmitted(false);
    setIsEditingOrder(false);
    setEditorNotice("");
    return () => {
      if (focusTimer) clearTimeout(focusTimer);
    };
  }, [editTarget?.id]);

  // Bản đồ tra cứu nhanh xem bước nào đã có trong Step Trace Cache (chỉ khớp chặt projectId + featureId)
  const featureCacheMap = useMemo(() => {
    const map = new Map();
    if (!activeProject?.id || !editTarget?.id) return map;
    for (const entry of cacheEntries || []) {
      const matchProject = entry.projectId === activeProject.id;
      const matchFeat = entry.featureId === editTarget.id;
      if (matchProject && matchFeat) {
        const key = entry.normalizedText || normalizeStepKey(entry.stepText);
        const existing = map.get(key);
        const route = entry.routePath || "";
        if (!existing) {
          map.set(key, { ...entry, routes: route ? [route] : [] });
        } else if (route && !existing.routes.includes(route)) {
          existing.routes.push(route);
        }
      }
    }
    return map;
  }, [cacheEntries, activeProject?.id, editTarget?.id]);

  const isDirty = useMemo(() => {
    if (!editTarget) {
      return name.trim().length > 0 || steps.some((s) => s.text.trim().length > 0) || sessionMode !== "inherit";
    }
    if (name.trim() !== editTarget.name.trim()) return true;
    if (sessionMode !== (editTarget.sessionMode || "inherit")) return true;
    const origSteps = editTarget.steps || [];
    const currentSteps = steps.map((s) => s.text.trim());
    if (origSteps.length !== currentSteps.length) return true;
    return origSteps.some((s, idx) => s !== currentSteps[idx]);
  }, [name, steps, sessionMode, editTarget]);

  const validSteps = useMemo(() => steps.filter((s) => s.text.trim().length > 0), [steps]);

  const cachedValidStepsCount = useMemo(() => {
    return validSteps.filter((s) => featureCacheMap.has(normalizeStepKey(s.text))).length;
  }, [validSteps, featureCacheMap]);

  // Phát hiện nếu người dùng đang viết 1 đoạn văn rất dài gộp nhiều câu vào 1 bước
  const longCompoundStep = useMemo(() => {
    return steps.find(
      (s) =>
        s.text.trim().length > 130 &&
        /(\.\s+|\n|,\s*(?:rồi|sau đó|tiếp theo|nhấn|bấm|kiểm tra))/i.test(s.text)
    );
  }, [steps]);

  const addStep = (initialVal = "") => {
    const newStep = { id: genId("step"), text: initialVal };
    shouldFocusLastStepRef.current = true;
    setSteps((prev) => [...prev, newStep]);
  };

  const insertSnippet = (snippet) => {
    setSteps((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.text.trim() === "") {
        return prev.map((s, idx) => (idx === prev.length - 1 ? { ...s, text: snippet } : s));
      }
      return [...prev, { id: genId("step"), text: snippet }];
    });
  };

  const removeStep = (id) => {
    setSteps((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      return filtered.length > 0 ? filtered : [{ id: genId("step"), text: "" }];
    });
  };

  const updateStep = (id, text) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, text } : s)));
  };

  const handleMultiLinePasteAt = (stepId, lines, opts = {}) => {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === stepId);
      if (idx < 0) return prev;
      const inserted = lines.map((line) => ({ id: genId("step"), text: line }));
      const next = [...prev];
      next.splice(idx, 1, ...inserted);
      return next;
    });
    setEditorNotice(
      opts.fromParagraph
        ? `Đã tự động tách đoạn văn vừa dán thành ${lines.length} bước theo câu. Bạn có thể chạy ngay hoặc bấm "Dán & Tách bước" → AI để tách chi tiết hơn.`
        : `Đã tự động tách ${lines.length} dòng vừa dán thành từng bước riêng.`
    );
  };

  const handleApplySplitSteps = (newLines, mode) => {
    const newItems = newLines.map((line) => ({ id: genId("step"), text: line }));
    if (mode === "replace") {
      setSteps(newItems);
    } else {
      setSteps((prev) => {
        const cleanedPrev = prev.filter((s) => s.text.trim().length > 0);
        return [...cleanedPrev, ...newItems];
      });
    }
    setEditorNotice(`Đã áp dụng ${newLines.length} bước vào kịch bản. Nhớ bấm "Lưu" hoặc "Chạy ngay"!`);
  };

  const handleKeyDown = (e, index) => {
    if (e.key === "Enter" && index === steps.length - 1) {
      e.preventDefault();
      addStep();
    }
  };

  useEffect(() => {
    if (!shouldFocusLastStepRef.current) return;
    shouldFocusLastStepRef.current = false;
    lastInputRef.current?.focus();
  }, [steps.length]);

  const buildValidatedFeature = () => {
    setSubmitted(true);
    const trimmedName = name.trim();
    const finalSteps = steps.map((s) => s.text.trim()).filter(Boolean);
    if (!trimmedName) {
      nameInputRef.current?.focus();
      setEditorNotice("Vui lòng nhập tên tính năng trước khi lưu.");
      return null;
    }
    if (finalSteps.length === 0) {
      setEditorNotice("Vui lòng thêm ít nhất 1 bước kiểm thử.");
      return null;
    }
    setEditorNotice("");
    return {
      id: isEditing ? editTarget.id : genId("feat"),
      name: trimmedName,
      steps: finalSteps,
      sessionMode,
    };
  };

  const handleSave = () => {
    const feat = buildValidatedFeature();
    if (!feat) return;
    onSave(feat);
  };

  const handleSaveAndRun = () => {
    const feat = buildValidatedFeature();
    if (!feat) return;
    onSave(feat);
    if (onQuickRunFeature) onQuickRunFeature(feat);
  };

  // Phím tắt Ctrl+S / Cmd+S để lưu nhanh (gắn listener 1 lần duy nhất)
  saveHandlerRef.current = handleSave;
  useEffect(() => {
    const onGlobalKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveHandlerRef.current?.();
      }
    };
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSteps((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  if (!activeProject) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-300">
        <Folder size={24} className="text-slate-400 mb-2" />
        <p className="text-xs font-medium">Chưa chọn dự án</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950">
      {/* ── HEADER FORM ── */}
      <header className="px-6 py-3 border-b border-slate-700 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0 text-xs">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={onOpenSidebar}
              className="p-1 rounded text-slate-300 hover:text-white mr-1"
              title="Mở danh sách tính năng"
            >
              <PanelLeft size={15} />
            </button>
          )}
          <span className="text-slate-300 font-medium truncate max-w-[160px]">{activeProject.name}</span>
          <span className="text-slate-500 font-bold">/</span>
          <span className="text-white font-semibold truncate max-w-[240px]">
            {isEditing ? editTarget.name : "Tạo tính năng mới"}
          </span>
          {isDirty && <span className="text-amber-300 font-medium ml-1">(Chưa lưu)</span>}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onOpenProjectSettings && (
            <button
              type="button"
              onClick={onOpenProjectSettings}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 border border-amber-500/35 transition-colors font-medium cursor-pointer"
              title="Cấu hình biến {{username}}/{{password}} và chế độ lưu phiên đăng nhập (storageState) cho dự án"
            >
              <KeyRound size={12} className="text-amber-400" /> Biến & Phiên
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              const seed = validSteps.map((s) => s.text).join("\n");
              setSplitInitialText(seed);
              setSplitModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 border border-indigo-500/40 transition-colors font-medium cursor-pointer"
            title="Dán một đoạn văn bản dài hoặc kịch bản thô và tách tự động thành các bước chuẩn"
          >
            <Sparkles size={13} className="text-indigo-400" /> Dán & Tách bước
          </button>

          <button
            type="button"
            onClick={onOpenJsonModal}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs text-slate-200 hover:text-white hover:bg-slate-800 transition-colors font-medium border border-slate-700 cursor-pointer"
            title="Nhập tính năng từ file JSON"
          >
            <FileJson size={13} className="text-indigo-400" /> Nhập JSON
          </button>

          {isEditing && (
            <>
              <button
                type="button"
                onClick={() => onDuplicate(editTarget)}
                className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                title="Nhân bản tính năng"
              >
                <Copy size={13} />
              </button>
              <button
                type="button"
                onClick={onDeleteCurrent}
                className="p-1.5 rounded text-slate-300 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                title="Xóa tính năng"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── THÂN FORM ── */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-[850px] mx-auto w-full space-y-6">
          {editorNotice && (
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0 text-amber-400" />
                <span>{editorNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setEditorNotice("")}
                className="text-amber-400 hover:text-white p-0.5 cursor-pointer"
                title="Đóng thông báo"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Gợi ý tách bước tự động nếu phát hiện bước dạng đoạn văn quá dài */}
          {longCompoundStep && (
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-indigo-500/15 border border-indigo-500/40 text-indigo-200 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles size={15} className="shrink-0 text-indigo-400" />
                <span>
                  Phát hiện bước đang gộp nhiều câu thành đoạn văn dài ({longCompoundStep.text.length} ký tự). Nên tách thành các bước nhỏ để chạy ổn định và lưu Cache tái sử dụng từng bước!
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSplitInitialText(longCompoundStep.text);
                  setSplitModalOpen(true);
                }}
                className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
              >
                Tách ngay
              </button>
            </div>
          )}

          {/* Tên tính năng và Số thứ tự */}
          <div className="flex items-center gap-3">
            {isEditing ? (
              isEditingOrder ? (
                <div className="flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={orderInputRef}
                    type="text"
                    autoFocus
                    value={orderInput}
                    onChange={(e) => setOrderInput(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitOrderChange();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setIsEditingOrder(false);
                      }
                    }}
                    onBlur={() => setIsEditingOrder(false)}
                    className="w-12 px-2 py-0.5 text-center text-sm font-mono font-bold bg-slate-900 border border-indigo-500 rounded-lg text-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    title={`Nhập vị trí mới (1 - ${totalFeatures}) rồi nhấn Enter`}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setOrderInput(String(currentOrder));
                    setIsEditingOrder(true);
                    setTimeout(() => {
                      if (orderInputRef.current) {
                        orderInputRef.current.focus();
                        orderInputRef.current.select();
                      }
                    }, 50);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-indigo-500/50 transition-colors cursor-pointer text-xs font-mono text-indigo-300 group shrink-0"
                  title={`Số thứ tự: ${currentOrder}/${totalFeatures}. Bấm để đổi (1 - ${totalFeatures})`}
                  aria-label="Đổi số thứ tự tính năng"
                >
                  <span className="font-bold text-sm text-indigo-400 font-mono">{currentOrder}</span>
                  <Pencil size={12} className="text-slate-400 group-hover:text-indigo-300 transition-colors" />
                </button>
              )
            ) : (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/40 border border-slate-800 text-xs font-mono text-slate-400 shrink-0 select-none"
                title={`Tính năng mới sẽ nhận số thứ tự ${currentOrder}`}
              >
                <span className="font-bold text-sm text-slate-400 font-mono">{currentOrder}</span>
              </div>
            )}

            <input
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tên tính năng"
              className="flex-1 min-w-0 bg-transparent border-0 border-b border-transparent focus:border-indigo-400 text-xl font-semibold text-white placeholder:text-slate-400 outline-none py-1 transition-colors"
            />
          </div>

          {/* Danh sách bước */}
          <div className="space-y-1">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1">
                  {steps.map((s, idx) => (
                    <SortableStepRow
                      key={s.id}
                      id={s.id}
                      index={idx}
                      step={s.text}
                      cacheEntry={featureCacheMap.get(normalizeStepKey(s.text)) || null}
                      onClearStepCache={(stepText) => {
                        if (onClearCache) {
                          onClearCache({
                            projectId: activeProject.id,
                            featureId: editTarget?.id || "default",
                            stepText,
                          });
                        }
                      }}
                      onUpdate={(val) => updateStep(s.id, val)}
                      onMultiLinePaste={(lines, opts) => handleMultiLinePasteAt(s.id, lines, opts)}
                      onRemove={() => removeStep(s.id)}
                      onKeyDown={handleKeyDown}
                      onBlur={() => setTouched((prev) => new Set(prev).add(s.id))}
                      hasError={(submitted || touched.has(s.id)) && s.text.trim() === ""}
                      inputRef={idx === steps.length - 1 ? lastInputRef : null}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <button
              type="button"
              onClick={() => addStep("")}
              className="w-full flex items-center py-2 text-xs text-slate-300 hover:text-white transition-colors text-left group font-medium cursor-pointer"
            >
              <span className="w-6 shrink-0 flex items-center text-slate-400 group-hover:text-white">
                <Plus size={13} />
              </span>
              <span>Thêm bước…</span>
            </button>

            {/* Thanh chèn nhanh cú pháp No-Code Micro-ReAct */}
            <div className="pt-2 flex items-center flex-wrap gap-1.5 pl-6">
              <span className="text-[11px] text-slate-500 mr-1">Chèn nhanh:</span>
              <button
                type="button"
                onClick={() => insertSnippet("Mở trang http://127.0.0.1:5050")}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 hover:text-white font-mono cursor-pointer"
              >
                + Mở URL
              </button>
              <button
                type="button"
                onClick={() => insertSnippet("Kiểm tra xuất hiện thông báo '...'")}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 hover:text-white font-mono cursor-pointer"
              >
                + Kiểm tra chữ
              </button>
              <button
                type="button"
                onClick={() => insertSnippet("Đọc mã hiển thị và lưu vào biến {{ma_moi}}")}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-sky-300 hover:text-white font-mono cursor-pointer"
              >
                + Trích xuất biến
              </button>
              <button
                type="button"
                onClick={() => insertSnippet("Nhập {{LAST_EXTRACTED}} vào ô ...")}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-indigo-300 hover:text-white font-mono cursor-pointer"
              >
                + Dùng {"{{LAST_EXTRACTED}}"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── THANH ĐÁY ── */}
      <footer className="min-h-12 py-1.5 shrink-0 px-6 border-t border-slate-700 bg-slate-950 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-300 font-medium">
          <span>{saveShortcutText}</span>
          <span className="text-slate-600">•</span>
          <span>{validSteps.length} bước</span>
          <span className="text-slate-600">•</span>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
            <span className="text-slate-400">Phiên:</span>
            <select
              value={sessionMode}
              onChange={(e) => setSessionMode(e.target.value)}
              aria-label="Chế độ phiên trình duyệt của tính năng"
              className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-slate-200 outline-none focus:border-indigo-400 cursor-pointer"
            >
              <option value="inherit">
                Theo dự án ({activeProject.sessionMode === "persist" ? "Giữ đăng nhập" : "Phiên trắng"})
              </option>
              <option value="fresh">Phiên trắng (Fresh)</option>
              <option value="persist">Giữ đăng nhập (storageState)</option>
            </select>
          </label>
          {cachedValidStepsCount > 0 && (
            <>
              <span className="text-slate-600">•</span>
              <span
                className="inline-flex items-center gap-1 text-emerald-400 font-mono text-[11px]"
                title="Số bước đã được ghi nhớ vào Step Trace Cache (lần sau chạy ~0.05s, 0 gọi AI)"
              >
                <Zap size={12} /> {cachedValidStepsCount}/{validSteps.length} đã Cache
              </span>
              {isEditing && onClearCache && (
                <button
                  type="button"
                  onClick={() => onClearCache({ projectId: activeProject.id, featureId: editTarget.id })}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 text-[11px] transition-colors cursor-pointer"
                  title="Xóa băng ghi Cache của tính năng này để AI học lại từ đầu"
                >
                  <RotateCcw size={10} /> Quên Cache
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onQuickRunFeature && (
            <button
              type="button"
              onClick={handleSaveAndRun}
              disabled={Boolean(runningBatchId || isRunnerBusyByOther)}
              title={
                runningBatchId || isRunnerBusyByOther
                  ? "Hệ thống đang chạy đợt kiểm thử khác"
                  : "Lưu thay đổi (nếu có) và chạy ngay tính năng này"
              }
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 disabled:opacity-40 disabled:cursor-not-allowed border border-emerald-500/40 text-emerald-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <PlayCircle size={14} /> Chạy ngay
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
          >
            {isEditing ? "Lưu" : "Tạo tính năng"}
          </button>
        </div>
      </footer>

      <SmartSplitModal
        isOpen={splitModalOpen}
        initialText={splitInitialText}
        onClose={() => setSplitModalOpen(false)}
        onApply={handleApplySplitSteps}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 1  ─  QUẢN LÝ TÍNH NĂNG
// ═══════════════════════════════════════════════════════════════════
export function LibraryTab({
  projects,
  activeProjectId,
  onSelectProject,
  onUpsertProject,
  onDeleteProject,
  onUpsertFeature,
  onReorderFeature,
  onImportFeatures,
  onDeleteFeature,
  onDuplicateFeature,
  onExportProject,
  onExportAll,
  _history = [],
  cacheEntries = [],
  onClearCache,
  onQuickRunFeature,
  runningBatchId,
  isRunnerBusyByOther,
}) {
  const [featureSearch, setFeatureSearch] = useState("");
  const [editTargetFeature, setEditTargetFeature] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const isCreatingNewRef = useRef(false);
  const prevProjectIdRef = useRef(activeProjectId);

  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectToEdit, setProjectToEdit] = useState(null);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);

  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    itemName: "",
    onConfirm: () => {},
  });

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  const features = activeProject?.features || [];

  const { cachedFeatureIds, projectCacheCount } = useMemo(() => {
    const set = new Set();
    let count = 0;
    if (!activeProject?.id) return { cachedFeatureIds: set, projectCacheCount: 0 };
    for (const c of cacheEntries || []) {
      if (c.projectId === activeProject.id && c.featureId && c.featureId !== "*") {
        set.add(c.featureId);
        count++;
      }
    }
    return { cachedFeatureIds: set, projectCacheCount: count };
  }, [cacheEntries, activeProject?.id]);

  useEffect(() => {
    if (prevProjectIdRef.current !== activeProjectId) {
      prevProjectIdRef.current = activeProjectId;
      isCreatingNewRef.current = false;
    }

    if (features.length > 0 && !editTargetFeature && !isCreatingNewRef.current) {
      setEditTargetFeature(features[0]);
    } else if (editTargetFeature && !features.some((f) => f.id === editTargetFeature.id)) {
      isCreatingNewRef.current = false;
      setEditTargetFeature(features[0] || null);
    } else if (editTargetFeature) {
      const updated = features.find((f) => f.id === editTargetFeature.id);
      if (updated && updated !== editTargetFeature) {
        setEditTargetFeature(updated);
      }
    }
  }, [activeProjectId, features, editTargetFeature]);

  const filteredFeatures = useMemo(
    () => features.filter((f) => f.name.toLowerCase().includes(featureSearch.toLowerCase())),
    [features, featureSearch]
  );

  const handleDeleteProj = (p) => {
    setConfirmModal({
      isOpen: true,
      title: "Xóa dự án",
      message: "Toàn bộ tính năng và lịch sử chạy của dự án này sẽ bị xóa vĩnh viễn.",
      itemName: p.name,
      onConfirm: () => onDeleteProject(p.id),
    });
  };

  const handleDeleteFeat = (feat) => {
    setConfirmModal({
      isOpen: true,
      title: "Xóa tính năng",
      message: "Bạn có chắc muốn xóa tính năng này khỏi dự án?",
      itemName: feat.name,
      onConfirm: () => {
        onDeleteFeature(activeProject.id, feat.id);
        if (editTargetFeature?.id === feat.id) setEditTargetFeature(null);
      },
    });
  };

  return (
    <div className="tab-content flex h-full">
      {/* ── CỘT TRÁI ── */}
      <aside
        className={`${sidebarOpen ? "w-80 min-w-0" : "w-0 overflow-hidden border-r-0"} shrink-0 border-r border-slate-700 bg-slate-950 flex flex-col transition-[width] duration-150`}
      >
        <div className="px-4 py-3 border-b border-slate-700">
          <ProjectSelectorDropdown
            projects={projects}
            activeProject={activeProject}
            onSelectProject={(id) => {
              isCreatingNewRef.current = false;
              onSelectProject(id);
              setEditTargetFeature(null);
            }}
            onCreateProject={() => {
              setProjectToEdit(null);
              setProjectModalOpen(true);
            }}
            onEditProject={(p) => {
              setProjectToEdit(p);
              setProjectModalOpen(true);
            }}
            onDeleteProject={handleDeleteProj}
            _onExportCurrentProject={() => activeProject && onExportProject(activeProject)}
            _onExportAllProjects={onExportAll}
          />
        </div>

        <div className="px-4 py-3 border-b border-slate-700 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300">Danh sách tính năng ({features.length})</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  isCreatingNewRef.current = true;
                  setEditTargetFeature(null);
                }}
                className="p-1 rounded text-slate-300 hover:text-indigo-400 hover:bg-slate-900 transition-colors cursor-pointer"
                title="Thêm tính năng mới"
                aria-label="Thêm tính năng mới"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Thu gọn danh sách"
                aria-label="Thu gọn danh sách"
              >
                <PanelLeftClose size={13} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700">
            <Search size={12} className="text-slate-400 shrink-0" />
            <input
              value={featureSearch}
              onChange={(e) => setFeatureSearch(e.target.value)}
              placeholder="Tìm tính năng…"
              className="flex-1 min-w-0 bg-transparent text-xs text-white placeholder:text-slate-400 outline-none"
            />
            {featureSearch && (
              <button
                type="button"
                onClick={() => setFeatureSearch("")}
                aria-label="Xóa tìm kiếm"
                className="text-slate-400 hover:text-white shrink-0 cursor-pointer"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3.5 py-2 space-y-0.5">
          {filteredFeatures.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-300 font-medium">
              {featureSearch ? "Không tìm thấy" : "Chưa có tính năng"}
            </div>
          ) : (
            filteredFeatures.map((feat) => {
              const isActive = editTargetFeature?.id === feat.id;
              const featIndex = features.findIndex((f) => f.id === feat.id);
              const featNumber = featIndex >= 0 ? featIndex + 1 : 1;
              const hasCachedSteps = cachedFeatureIds.has(feat.id);

              return (
                <div
                  key={feat.id}
                  onClick={() => {
                    isCreatingNewRef.current = false;
                    setEditTargetFeature(feat);
                  }}
                  className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors text-xs ${
                    isActive
                      ? "bg-indigo-600/30 text-white font-medium border-indigo-500/40"
                      : "border-transparent text-slate-200 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className={`font-mono text-xs w-4 text-center shrink-0 ${
                        isActive ? "text-indigo-300 font-bold" : "text-slate-400 font-medium"
                      }`}
                    >
                      {featNumber}
                    </span>
                    <span className="truncate">{feat.name}</span>
                    {hasCachedSteps && (
                      <Zap
                        size={11}
                        className="text-emerald-400 shrink-0"
                        title="Đã có bước lưu trong Step Cache ⚡"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicateFeature(activeProject.id, feat);
                      }}
                      title="Nhân bản"
                      className="p-1 text-slate-300 hover:text-white cursor-pointer"
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFeat(feat);
                      }}
                      title="Xóa"
                      className="p-1 text-slate-300 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="h-12 shrink-0 px-4 border-t border-slate-700 flex items-center justify-between text-xs text-slate-300 font-medium">
          <span
            className="text-[11px] font-mono text-slate-400"
            title={`Số bước Cache thuộc dự án hiện tại (${projectCacheCount}) / Tổng hệ thống (${cacheEntries.length})`}
          >
            ⚡ {projectCacheCount} bước Cache
          </span>
          {features.length > 0 && (
            <button
              type="button"
              onClick={() => onExportProject(activeProject)}
              className="text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Xuất file JSON dự án này"
            >
              <Download size={12} /> Xuất JSON
            </button>
          )}
        </div>
      </aside>

      {/* ── CỘT CHÍNH ── */}
      <FeatureEditorPanel
        activeProject={activeProject}
        editTarget={editTargetFeature}
        onSave={(feat) => {
          isCreatingNewRef.current = false;
          onUpsertFeature(activeProject.id, feat);
          setEditTargetFeature(feat);
        }}
        _onCancelEdit={() => setEditTargetFeature(null)}
        onDeleteCurrent={() => {
          if (editTargetFeature) handleDeleteFeat(editTargetFeature);
        }}
        onOpenJsonModal={() => setJsonModalOpen(true)}
        onOpenProjectSettings={() => {
          if (activeProject) {
            setProjectToEdit(activeProject);
            setProjectModalOpen(true);
          }
        }}
        onDuplicate={(feat) => onDuplicateFeature(activeProject.id, feat)}
        onOpenSidebar={() => setSidebarOpen(true)}
        sidebarOpen={sidebarOpen}
        onReorderFeature={(featId, newOrder) => {
          if (onReorderFeature) onReorderFeature(activeProject.id, featId, newOrder);
        }}
        cacheEntries={cacheEntries}
        onClearCache={onClearCache}
        onQuickRunFeature={onQuickRunFeature}
        runningBatchId={runningBatchId}
        isRunnerBusyByOther={isRunnerBusyByOther}
      />

      <ProjectModal
        isOpen={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
        onSave={onUpsertProject}
        project={projectToEdit}
      />

      <JsonImportModal
        isOpen={jsonModalOpen}
        onClose={() => setJsonModalOpen(false)}
        onImport={(newFeats) => onImportFeatures(activeProject.id, newFeats)}
        projectName={activeProject?.name || ""}
      />

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        itemName={confirmModal.itemName}
      />
    </div>
  );
}

export default LibraryTab;

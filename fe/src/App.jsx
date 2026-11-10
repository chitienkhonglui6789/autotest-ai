import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  DndContext, closestCenter, PointerSensor,
  useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Pencil, Trash2, Download, Plus, X, FileJson,
  PlayCircle, CheckCircle2, GripVertical, Search,
  Wand2, Check, Library, Rocket, History,
  ChevronDown, Folder,
  AlertCircle, Copy,
  PanelLeftClose, PanelLeft,
  Loader2,
  ChevronLeft, ChevronRight, Maximize2,
  Camera,
  Clock, Calendar, AlertTriangle, MinusCircle,
  Cpu, Bot, Settings, Save, RefreshCw, HelpCircle, BookOpen, Layers, CheckCircle, FileText,
  Eye, EyeOff,
} from "lucide-react";
import "./index.css";

// ═══════════════════════════════════════════════════════════════════
// DỮ LIỆU & TIỆN ÍCH
// ═══════════════════════════════════════════════════════════════════
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (
  import.meta.env.DEV ? "http://127.0.0.1:3000" : ""
);
const genId = (prefix = "item") => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const saveShortcutText = isMac ? "⌘S để lưu" : "Ctrl+S để lưu";

const SAMPLE_PROJECTS = [
  {
    id: "proj_ecommerce",
    name: "Website Thương mại điện tử",
    description: "Kiểm thử luồng khách hàng mua sắm và thanh toán trực tuyến",
    createdAt: new Date().toISOString(),
    features: [
      {
        id: "feat_login",
        name: "Đăng nhập tài khoản",
        steps: [
          "Mở trang chủ shop.vn",
          "Click vào nút 'Đăng nhập' ở góc trên bên phải",
          "Nhập email: user@example.com",
          "Nhập mật khẩu: %password%",
          "Click nút 'Xác nhận Đăng nhập'",
          "Kiểm tra hiển thị tên người dùng và avatar"
        ]
      },
      {
        id: "feat_search_cart",
        name: "Tìm kiếm & Giỏ hàng",
        steps: [
          "Gõ từ khóa 'Tai nghe Bluetooth' vào ô tìm kiếm",
          "Nhấn Enter và đợi danh sách sản phẩm xuất hiện",
          "Chọn sản phẩm đầu tiên trong danh sách",
          "Click nút 'Thêm vào giỏ hàng'",
          "Kiểm tra badge thông báo giỏ hàng nhảy số 1"
        ]
      },
      {
        id: "feat_checkout",
        name: "Đặt hàng & Thanh toán",
        steps: [
          "Click vào biểu tượng Giỏ hàng",
          "Bấm nút 'Tiến hành đặt hàng'",
          "Điền thông tin địa chỉ giao hàng",
          "Chọn phương thức thanh toán khi nhận hàng (COD)",
          "Bấm 'Xác nhận Đặt hàng'",
          "Kiểm tra màn hình thông báo 'Đặt hàng thành công'"
        ]
      }
    ]
  },
  {
    id: "proj_crm",
    name: "Cổng Quản Trị Khách Hàng (CRM)",
    description: "Kiểm thử các tính năng phân quyền, quản lý Lead và xuất báo cáo",
    createdAt: new Date().toISOString(),
    features: [
      {
        id: "feat_lead_create",
        name: "Tạo khách hàng tiềm năng",
        steps: [
          "Truy cập phân hệ Quản lý Lead",
          "Bấm nút '+ Thêm mới Lead'",
          "Nhập tên công ty: 'Công nghệ Á Châu'",
          "Nhập số hotline: '0901234567'",
          "Bấm 'Lưu dữ liệu'",
          "Kiểm tra dòng dữ liệu mới hiển thị trong bảng"
        ]
      },
      {
        id: "feat_report_export",
        name: "Xuất báo cáo doanh số tuần",
        steps: [
          "Mở mục Báo cáo & Thống kê",
          "Chọn khoảng thời gian: 7 ngày gần nhất",
          "Click nút 'Xuất file Excel'",
          "Kiểm tra hệ thống trả về file .xlsx thành công"
        ]
      }
    ]
  }
];

const loadProjects = () => {
  try {
    const saved = localStorage.getItem("autotest_projects");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      if (parsed && Array.isArray(parsed.projects) && parsed.projects.length > 0) return parsed.projects;
    }
    const oldFeats = localStorage.getItem("autotest_features");
    if (oldFeats) {
      const parsedFeats = JSON.parse(oldFeats);
      if (Array.isArray(parsedFeats) && parsedFeats.length > 0) {
        return [{
          id: genId("proj"),
          name: "Dự án mặc định",
          description: "Dữ liệu được chuyển từ phiên bản trước",
          createdAt: new Date().toISOString(),
          features: parsedFeats
        }];
      }
    }
    return SAMPLE_PROJECTS;
  } catch {
    return SAMPLE_PROJECTS;
  }
};

const saveProjects = (projects) => {
  try {
    localStorage.setItem("autotest_projects", JSON.stringify(projects));
  } catch (err) {
    console.error("Lỗi khi lưu dự án vào localStorage:", err);
  }
};

const loadHistory = () => {
  try {
    const saved = localStorage.getItem("autotest_history");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
    return [];
  } catch {
    return [];
  }
};

const saveHistory = (history) => {
  try {
    localStorage.setItem("autotest_history", JSON.stringify(history));
  } catch (err) {
    console.error("Lỗi khi lưu lịch sử vào localStorage:", err);
  }
};

const _getFeatureStatus = (featureId, history = []) => {
  const latestRun = history.find((r) => r.featureId === featureId);
  if (!latestRun) return "none";
  return latestRun.status;
};

const _getStatusDotClass = (status) => {
  if (status === "passed") return "bg-emerald-400";
  if (status === "failed") return "bg-rose-400";
  return "bg-slate-500";
};

const formatTime = (isoString) => {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString || "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  } catch {
    return isoString || "";
  }
};

const formatBatchDateTime = (isoString) => {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString || "";
    const pad = (n) => String(n).padStart(2, "0");
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const dd = pad(d.getDate());
    const MM = pad(d.getMonth() + 1);
    const yy = String(d.getFullYear()).slice(-2);
    return `${hh}:${mm} ${dd}/${MM}/${yy}`;
  } catch {
    return isoString || "";
  }
};

const formatDuration = (ms) => {
  if (typeof ms !== "number" || isNaN(ms)) return "0s";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const formatSublineTime = (isoString) => {
  try {
    const d = new Date(isoString || Date.now());
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  } catch {
    return "";
  }
};

const getDateGroupLabel = (isoString) => {
  try {
    const d = new Date(isoString || Date.now());
    if (isNaN(d.getTime())) return "Khác";
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    const pad = (n) => String(n).padStart(2, "0");
    const dateFormatted = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

    if (isToday) return `Hôm nay · ${dateFormatted}`;
    if (isYesterday) return `Hôm qua · ${dateFormatted}`;
    return dateFormatted;
  } catch {
    return "Khác";
  }
};

// Tên mặc định: Đợt chạy HH:mm DD/MM
const generateBatchRunName = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const pad = (n) => String(n).padStart(2, "0");
  return `Đợt chạy ${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};

// Chuẩn hóa một mục lịch sử thành Đợt chạy (Batch)
// Sidebar Lịch sử kiểm thử chỉ liệt kê đợt chạy (có mảng features). Bỏ toàn bộ hiển thị/gom theo tính năng đơn lẻ.
const normalizeBatch = (item) => {
  if (!item || !Array.isArray(item.features)) return null;
  return {
    ...item,
    id: item.id || genId("batch"),
    name: item.name || "Đợt chạy kiểm thử",
    notes: item.notes || "",
    startedAt: item.startedAt || item.timestamp || new Date().toISOString(),
    finishedAt: item.finishedAt || null,
    status: item.status === "Đang chạy" ? "Đang chạy" : "Kết thúc",
    features: item.features.map((f) => ({
      id: f.id || genId("feat"),
      name: f.name || f.featureName || "Tính năng",
      steps: Array.isArray(f.steps)
        ? f.steps.map((s) => (typeof s === "string" ? s : s.text || ""))
        : [],
      stepResults: Array.isArray(f.stepResults)
        ? f.stepResults
        : (Array.isArray(f.steps) && typeof f.steps[0] === "object" ? f.steps : []),
      status: f.status || "PASSED",
      durationMs: typeof f.durationMs === "number" ? f.durationMs : (f.duration || 0),
      error: f.error || null,
    })),
  };
};

const exportJSON = (data, filename = `autotest_${Date.now()}.json`) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), {
    href: url, download: filename,
  }).click();
  URL.revokeObjectURL(url);
};

// ═══════════════════════════════════════════════════════════════════
// CUSTOM DARK CHECKBOX (Viền sáng rõ ràng, style tối tương phản cao)
// ═══════════════════════════════════════════════════════════════════
function DarkCheckbox({ checked, onChange, ariaLabel, disabled = false }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={disabled ? undefined : onChange}
      className={`w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center border transition-colors ${disabled ? "opacity-40 cursor-not-allowed" : ""
        } ${checked
          ? "bg-indigo-600 border-indigo-400 text-white"
          : "bg-slate-900 border-slate-500 hover:border-slate-300"
        }`}
    >
      {checked && <Check size={10} strokeWidth={3} />}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HỘP THOẠI XÁC NHẬN & QUẢN LÝ DỰ ÁN (Tương phản cao)
// ═══════════════════════════════════════════════════════════════════
function ConfirmModal({ isOpen, onClose, onConfirm, title, message, itemName }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-sm shadow-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="text-xs text-slate-300 leading-relaxed">{message}</p>
        {itemName && (
          <div className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs text-slate-200 truncate font-medium">
            {itemName}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(); onClose(); }}
            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors"
          >
            Xác nhận xóa
          </button>
        </div>
      </div>
    </div>
  );
}

function ScreenshotLightbox({ isOpen, onClose, items = [], initialIndex = 0 }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex, isOpen]);

  const total = items.length;
  const currentItem = items[currentIndex];

  const handlePrev = useCallback(() => {
    if (total <= 1) return;
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : total - 1));
  }, [total]);

  const handleNext = useCallback(() => {
    if (total <= 1) return;
    setCurrentIndex((prev) => (prev < total - 1 ? prev + 1 : 0));
  }, [total]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      } else if (e.key === "ArrowRight") {
        handleNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, handlePrev, handleNext]);

  if (!isOpen || !currentItem) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 sm:p-6 select-none animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* Nút đóng */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 z-50 p-2.5 rounded-full bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 transition-colors shadow-lg cursor-pointer"
        title="Đóng (Esc)"
      >
        <X size={20} />
      </button>

      {/* Mũi tên chuyển ảnh trái */}
      {total > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handlePrev();
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-50 p-2.5 rounded-full bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 transition-colors shadow-lg cursor-pointer"
          title="Ảnh trước (←)"
        >
          <ChevronLeft size={24} />
        </button>
      )}

      {/* Mũi tên chuyển ảnh phải */}
      {total > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleNext();
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-50 p-2.5 rounded-full bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 transition-colors shadow-lg cursor-pointer"
          title="Ảnh tiếp theo (→)"
        >
          <ChevronRight size={24} />
        </button>
      )}

      {/* Khung hiển thị ảnh và chú thích */}
      <div
        className="flex flex-col items-center max-w-[92vw] max-h-[92vh] space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative rounded-lg overflow-hidden border border-slate-700/80 bg-slate-950 shadow-2xl flex items-center justify-center max-h-[80vh]">
          <img
            src={currentItem.url || currentItem.screenshotUrl}
            alt={currentItem.label || `Ảnh ${currentIndex + 1}`}
            className="max-w-[90vw] max-h-[78vh] w-auto h-auto object-contain select-none"
          />
        </div>

        {/* Chú thích chi tiết: Bước X · Nhãn Trước/Sau · mô tả bước */}
        <div className="text-center px-4 py-2 rounded-xl bg-slate-900/95 border border-slate-700/80 text-xs text-slate-200 font-sans shadow-xl max-w-2xl flex flex-col gap-1 items-center">
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <span className="font-semibold text-indigo-400">
              Bước {currentItem.stepIndex || currentIndex + 1}
            </span>

            {currentItem.label && (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${currentItem.type === "before"
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  : currentItem.type === "error"
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                    : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  }`}
              >
                {currentItem.label}
              </span>
            )}

            {currentItem.sublabel && (
              <span className="text-[11px] text-slate-400 italic">
                ({currentItem.sublabel})
              </span>
            )}

            <span className="text-slate-500">•</span>
            <span className="text-slate-400 font-mono text-[11px]">
              Ảnh {currentIndex + 1}/{total}
            </span>
          </div>

          <div className="text-slate-300 truncate max-w-xl text-center text-[11px]">
            {currentItem.stepText || currentItem.step || currentItem.text || ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectModal({ isOpen, onClose, onSave, project = null }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (project) {
      setName(project.name || "");
      setDescription(project.description || "");
    } else {
      setName("");
      setDescription("");
    }
  }, [project, isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return alert("Vui lòng nhập tên dự án");
    onSave({
      id: project?.id || genId("proj"),
      name: trimmed,
      description: description.trim(),
      createdAt: project?.createdAt || new Date().toISOString(),
      features: project?.features || [],
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-sm shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            {project ? "Chỉnh sửa dự án" : "Tạo dự án mới"}
          </h3>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="text-slate-400 hover:text-white p-1"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Tên dự án</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Cổng dịch vụ trực tuyến"
              autoFocus
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-400 outline-none focus:border-indigo-400 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Mô tả (tùy chọn)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả phạm vi hoặc mục tiêu kiểm thử"
              rows={2}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-400 outline-none focus:border-indigo-400 transition-colors resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
            >
              {project ? "Cập nhật" : "Tạo dự án"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function JsonImportModal({ isOpen, onClose, onImport, projectName }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) { setText(""); setError(""); }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-700">
          <div>
            <h3 className="text-sm font-semibold text-white">Nhập tính năng từ JSON</h3>
            <p className="text-xs text-slate-300 mt-0.5">{projectName}</p>
          </div>
          <button onClick={onClose} aria-label="Đóng" className="text-slate-400 hover:text-white p-1">
            <X size={14} />
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-300 font-medium">
            <label>Nội dung JSON hoặc chọn file</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => document.getElementById("__modal_fi__").click()}
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
          <input id="__modal_fi__" type="file" accept=".json" className="hidden"
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

// ═══════════════════════════════════════════════════════════════════
// HÀNG BƯỚC TEST (Gạch chân rõ ràng, số thứ tự sáng rõ)
// ═══════════════════════════════════════════════════════════════════
function SortableStepRow({
  id,
  index,
  step,
  onUpdate,
  onRemove,
  onKeyDown,
  onBlur,
  hasError,
  inputRef,
  disabled = false,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`group relative flex items-center py-1 transition-colors ${isDragging ? "bg-slate-900" : ""
        }`}
    >
      {/* Handle kéo thả: nổi bật khi hover */}
      <button
        type="button"
        disabled={disabled}
        aria-label={`Kéo để sắp xếp lại bước ${index + 1}`}
        className={`drag-handle absolute -left-5 p-0.5 text-slate-400 transition-opacity ${disabled ? "opacity-0 cursor-not-allowed" : "hover:text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={13} />
      </button>

      {/* Số thứ tự sáng rõ ràng (text-slate-300) */}
      <span className="w-6 shrink-0 text-xs text-slate-300 font-medium tabular-nums select-none text-left font-mono">
        {index + 1}.
      </span>

      {/* Ô nhập có gạch chân rõ ràng (border-slate-700), focus viền indigo-400 */}
      <div className="flex-1 min-w-0">
        <input
          ref={inputRef}
          value={step}
          disabled={disabled}
          onChange={(e) => onUpdate(e.target.value)}
          onKeyDown={(e) => onKeyDown(e, index)}
          onBlur={onBlur}
          placeholder="Mô tả bước, vd: Nhấn nút Đăng nhập"
          className={`w-full bg-transparent border-0 border-b ${hasError
            ? "border-rose-500 focus:border-rose-400"
            : "border-slate-700 focus:border-indigo-400"
            } px-0 py-1.5 text-sm text-slate-100 placeholder:text-slate-400 outline-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed`}
          aria-label={`Nội dung bước ${index + 1}`}
        />
      </div>

      {/* Nút xóa bên phải */}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Xóa bước ${index + 1}`}
        title="Xóa bước này"
        className={`shrink-0 p-1 rounded text-slate-400 transition-opacity ml-2 ${disabled ? "opacity-0 cursor-not-allowed" : "hover:text-rose-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DROPDOWN CHỌN DỰ ÁN (Viền slate-700 sáng, chữ trắng rõ nét)
// ═══════════════════════════════════════════════════════════════════
function ProjectSelectorDropdown({
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

  const filteredProjects = useMemo(() =>
    projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())),
    [projects, search]
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center justify-between gap-1 p-1 rounded-lg bg-slate-950 border border-slate-700">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex-1 flex items-center justify-between px-2.5 py-1.5 text-left rounded hover:bg-slate-900 transition-colors"
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
          className="p-1.5 rounded text-slate-300 hover:text-indigo-400 hover:bg-slate-900 transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-40 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-2 space-y-1.5 min-w-[260px]">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-950 border border-slate-700">
            <Search size={12} className="text-slate-400 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm dự án…"
              className="flex-1 bg-transparent text-xs text-white placeholder:text-slate-400 outline-none"
              autoFocus
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-slate-400 hover:text-white">
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
                    className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors text-xs ${isActive
                      ? "bg-indigo-600/25 text-white font-medium border border-indigo-500/40"
                      : "hover:bg-slate-800 text-slate-200"
                      }`}
                  >
                    <span className="truncate flex-1">{p.name} ({featCount})</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onEditProject(p); setIsOpen(false); }}
                        title="Đổi tên"
                        className="p-1 text-slate-300 hover:text-white"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDeleteProject(p); setIsOpen(false); }}
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
// FORM SOẠN THẢO TÍNH NĂNG (Tương phản cao, chữ trắng, viền rõ ràng)
// ═══════════════════════════════════════════════════════════════════
function FeatureEditorPanel({
  activeProject,
  editTarget,
  onSave,
  _onCancelEdit,
  onDeleteCurrent,
  onOpenJsonModal,
  onDuplicate,
  onOpenSidebar,
  sidebarOpen,
  onReorderFeature,
}) {
  const isEditing = !!editTarget;
  const [name, setName] = useState("");
  const [steps, setSteps] = useState([{ id: genId("step"), text: "" }]);
  const [touched, setTouched] = useState(new Set());
  const [submitted, setSubmitted] = useState(false);

  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [orderInput, setOrderInput] = useState("");
  const orderInputRef = useRef(null);

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

  useEffect(() => {
    if (editTarget) {
      setName(editTarget.name || "");
      const loadedSteps = Array.isArray(editTarget.steps) && editTarget.steps.length > 0
        ? editTarget.steps.map((s) => ({ id: genId("step"), text: s }))
        : [{ id: genId("step"), text: "" }];
      setSteps(loadedSteps);
    } else {
      setName("");
      setSteps([{ id: genId("step"), text: "" }]);
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
    setTouched(new Set());
    setSubmitted(false);
    setIsEditingOrder(false);
  }, [editTarget?.id]);

  const isDirty = useMemo(() => {
    if (!editTarget) {
      return name.trim().length > 0 || steps.some((s) => s.text.trim().length > 0);
    }
    if (name.trim() !== editTarget.name.trim()) return true;
    const origSteps = editTarget.steps || [];
    const currentSteps = steps.map((s) => s.text.trim());
    if (origSteps.length !== currentSteps.length) return true;
    return origSteps.some((s, idx) => s !== currentSteps[idx]);
  }, [name, steps, editTarget]);

  const validSteps = useMemo(() => steps.filter((s) => s.text.trim().length > 0), [steps]);

  const addStep = () => {
    const newStep = { id: genId("step"), text: "" };
    setSteps((prev) => [...prev, newStep]);
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

  const handleKeyDown = (e, index) => {
    if (e.key === "Enter" && index === steps.length - 1) {
      e.preventDefault();
      addStep();
    }
  };

  useEffect(() => {
    lastInputRef.current?.focus();
  }, [steps.length]);

  const handleSave = () => {
    setSubmitted(true);
    const trimmedName = name.trim();
    const finalSteps = steps.map((s) => s.text.trim()).filter(Boolean);
    if (!trimmedName) {
      nameInputRef.current?.focus();
      setEditorNotice("Vui lòng nhập tên tính năng trước khi lưu.");
      return;
    }
    if (!finalSteps.length) {
      setEditorNotice("Vui lòng nhập ít nhất 1 bước kiểm thử hợp lệ.");
      return;
    }

    setEditorNotice("");
    onSave({
      id: editTarget?.id ?? genId("feat"),
      name: trimmedName,
      steps: finalSteps,
    });
  };

  useEffect(() => {
    const handleGlobalKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const handleDragEnd = ({ active, over }) => {
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
      {/* ── HEADER FORM: Breadcrumb và Tiêu đề gộp thành MỘT dòng (border-slate-700) ── */}
      <header className="px-6 py-3 border-b border-slate-700 flex items-center justify-between shrink-0">
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
          {isDirty && (
            <span className="text-amber-300 font-medium ml-1">
              (Chưa lưu)
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenJsonModal}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs text-slate-200 hover:text-white hover:bg-slate-800 transition-colors font-medium border border-slate-700"
            title="Nhập tính năng từ file JSON"
          >
            <FileJson size={13} className="text-indigo-400" /> Nhập JSON
          </button>
          {isEditing && (
            <>
              <button
                type="button"
                onClick={() => onDuplicate(editTarget)}
                className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                title="Nhân bản tính năng"
              >
                <Copy size={13} />
              </button>
              <button
                type="button"
                onClick={onDeleteCurrent}
                className="p-1.5 rounded text-slate-300 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                title="Xóa tính năng"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── THÂN FORM CĂN THẲNG LỀ TRÁI CHUẨN XÁC ── */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-[850px] mx-auto w-full space-y-6">
          {/* Thông báo inline nếu có lỗi nhập liệu */}
          {editorNotice && (
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0 text-amber-400" />
                <span>{editorNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setEditorNotice("")}
                className="text-amber-400 hover:text-white p-0.5"
                title="Đóng thông báo"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Tên tính năng và Số thứ tự */}
          <div className="flex items-center gap-3">
            {/* Số thứ tự ngay bên TRÁI tên tính năng, cách tên 12px, căn giữa theo chiều dọc */}
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

          {/* Danh sách bước: Số thứ tự bắt đầu ở 0px, ô nhập bắt đầu tại 24px (pl-6) */}
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
                      onUpdate={(val) => updateStep(s.id, val)}
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

            {/* Dòng thêm bước: Chữ sáng rõ (text-slate-300) */}
            <button
              type="button"
              onClick={addStep}
              className="w-full flex items-center py-2 text-xs text-slate-300 hover:text-white transition-colors text-left group font-medium"
            >
              <span className="w-6 shrink-0 flex items-center text-slate-400 group-hover:text-white">
                <Plus size={13} />
              </span>
              <span>Thêm bước…</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── THANH ĐÁY (border-slate-700, chữ rõ ràng) ── */}
      <footer className="h-12 shrink-0 px-6 border-t border-slate-700 bg-slate-950 flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-xs text-slate-300 font-medium">
          <span>{saveShortcutText}</span>
          <span className="text-slate-500">•</span>
          <span>{validSteps.length} bước</span>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shadow-sm"
          >
            {isEditing ? "Lưu" : "Tạo tính năng"}
          </button>
        </div>
      </footer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 1  ─  QUẢN LÝ TÍNH NĂNG (Giao diện 2 cột tinh gọn)
// ═══════════════════════════════════════════════════════════════════
function LibraryTab({
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
}) {
  const [featureSearch, setFeatureSearch] = useState("");
  const [editTargetFeature, setEditTargetFeature] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectToEdit, setProjectToEdit] = useState(null);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);

  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    itemName: "",
    onConfirm: () => { },
  });

  const activeProject = useMemo(() =>
    projects.find((p) => p.id === activeProjectId) || projects[0] || null,
    [projects, activeProjectId]
  );

  const features = activeProject?.features || [];
  const filteredFeatures = useMemo(() =>
    features.filter((f) => f.name.toLowerCase().includes(featureSearch.toLowerCase())),
    [features, featureSearch]
  );

  const handleOpenCreateProject = () => {
    setProjectToEdit(null);
    setProjectModalOpen(true);
  };

  const handleOpenEditProject = (p) => {
    setProjectToEdit(p);
    setProjectModalOpen(true);
  };

  const handleDeleteProj = (p) => {
    setConfirmModal({
      isOpen: true,
      title: "Xóa dự án",
      message: "Bạn có chắc muốn xóa dự án này cùng toàn bộ các tính năng bên trong?",
      itemName: p.name,
      onConfirm: () => onDeleteProject(p.id),
    });
  };

  const handleDeleteFeat = (feat) => {
    setConfirmModal({
      isOpen: true,
      title: "Xóa tính năng",
      message: `Bạn có chắc muốn xóa tính năng này khỏi dự án "${activeProject.name}"?`,
      itemName: feat.name,
      onConfirm: () => {
        onDeleteFeature(activeProject.id, feat.id);
        if (editTargetFeature?.id === feat.id) setEditTargetFeature(null);
      },
    });
  };

  return (
    <div className="tab-content flex h-full gap-0 overflow-hidden relative">
      {/* ── CỘT BÊN TRÁI: DANH SÁCH TÍNH NĂNG (border-slate-700) ── */}
      <aside
        className={`${sidebarOpen ? "w-72" : "w-0 overflow-hidden border-r-0"
          } shrink-0 bg-slate-950 border-r border-slate-700 flex flex-col transition-all duration-150 z-10`}
      >
        {/* Dropdown Dự án ở trên cùng (px-4 py-3 border-slate-700) */}
        <div className="px-4 py-3 border-b border-slate-700">
          <ProjectSelectorDropdown
            projects={projects}
            activeProject={activeProject}
            onSelectProject={(id) => {
              onSelectProject(id);
              setEditTargetFeature(null);
            }}
            onCreateProject={handleOpenCreateProject}
            onEditProject={handleOpenEditProject}
            onDeleteProject={handleDeleteProj}
            onExportCurrentProject={() => onExportProject(activeProject)}
            onExportAllProjects={onExportAll}
          />
        </div>

        {/* Tiêu đề Tính năng, nút Thêm và nút Thu gọn riêng biệt */}
        <div className="px-4 pt-3 pb-2.5 border-b border-slate-700 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">
              Tính năng ({features.length})
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setEditTargetFeature(null)}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-indigo-400 hover:text-indigo-300 hover:bg-slate-900 transition-colors"
                title="Tạo tính năng mới"
              >
                <Plus size={13} /> Thêm
              </button>
              <span className="w-px h-3 bg-slate-700 mx-0.5" />
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-white transition-colors"
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
              className="flex-1 bg-transparent text-xs text-white placeholder:text-slate-400 outline-none"
            />
            {featureSearch && (
              <button
                type="button"
                onClick={() => setFeatureSearch("")}
                aria-label="Xóa tìm kiếm"
                className="text-slate-400 hover:text-white"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Danh sách tính năng (chữ trắng/sáng rõ ràng) */}
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
              return (
                <div
                  key={feat.id}
                  onClick={() => setEditTargetFeature(feat)}
                  className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors text-xs ${isActive
                    ? "bg-indigo-600/30 text-white font-medium border border-indigo-500/40"
                    : "text-slate-200 hover:bg-slate-900 hover:text-white"
                    }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`font-mono text-xs w-4 text-center shrink-0 ${isActive ? "text-indigo-300 font-bold" : "text-slate-400 font-medium"}`}>
                      {featNumber}
                    </span>
                    <span className="truncate">{feat.name}</span>
                  </div>

                  {/* Icon thao tác: Chỉ hiện khi hover item */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicateFeature(activeProject.id, feat);
                      }}
                      title="Nhân bản"
                      className="p-1 text-slate-300 hover:text-white"
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

        {/* Footer cột tính năng */}
        <div className="h-12 shrink-0 px-4 border-t border-slate-700 flex items-center justify-end text-xs text-slate-300 font-medium">
          {features.length > 0 && (
            <button
              type="button"
              onClick={() => onExportProject(activeProject)}
              className="text-slate-300 hover:text-white transition-colors flex items-center gap-1.5"
              title="Xuất file JSON dự án này"
            >
              <Download size={12} /> Xuất JSON
            </button>
          )}
        </div>
      </aside>

      {/* ── CỘT CHÍNH: SOẠN THẢO TÍNH NĂNG ── */}
      <FeatureEditorPanel
        activeProject={activeProject}
        editTarget={editTargetFeature}
        onSave={(feat) => {
          onUpsertFeature(activeProject.id, feat);
          setEditTargetFeature(feat);
        }}
        onCancelEdit={() => setEditTargetFeature(null)}
        onDeleteCurrent={() => {
          if (editTargetFeature) handleDeleteFeat(editTargetFeature);
        }}
        onOpenJsonModal={() => setJsonModalOpen(true)}
        onDuplicate={(feat) => onDuplicateFeature(activeProject.id, feat)}
        onOpenSidebar={() => setSidebarOpen(true)}
        sidebarOpen={sidebarOpen}
        onReorderFeature={(featId, newOrder) => {
          if (onReorderFeature) onReorderFeature(activeProject.id, featId, newOrder);
        }}
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

// ═══════════════════════════════════════════════════════════════════
// HỘP THOẠI ĐỢT CHẠY MỚI (NewBatchModal)
// ═══════════════════════════════════════════════════════════════════
function NewBatchModal({ isOpen, onClose, onStart }) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setName(generateBatchRunName());
      setNotes("");
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (!name.trim()) return;
    onStart({ name: name.trim(), notes: notes.trim() });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col">
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

// ═══════════════════════════════════════════════════════════════════
// TAB 2  ─  TRÌNH CHẠY TEST (Tương phản cao)
// ═══════════════════════════════════════════════════════════════════
function RunnerTab({
  projects,
  activeProjectId,
  onSelectProject,
  onUpsertProject,
  onDeleteProject,
  onExportProject,
  onExportAll,
  _history = [],
  onStartBatchRun,
  runningBatchId,
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
    (f.steps || []).map((s) => ({ featureName: f.name, step: s }))
  );

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
      <aside className="w-72 shrink-0 border-r border-slate-700 bg-slate-950 flex flex-col">
        {/* Dropdown chọn dự án */}
        <div className="px-4 py-3 border-b border-slate-700">
          <ProjectSelectorDropdown
            projects={projects}
            activeProject={currentProject}
            onSelectProject={onSelectProject}
            onCreateProject={() => { setProjectToEdit(null); setProjectModalOpen(true); }}
            onEditProject={(p) => { setProjectToEdit(p); setProjectModalOpen(true); }}
            onDeleteProject={(p) => onDeleteProject(p.id)}
            onExportCurrentProject={() => onExportProject(currentProject)}
            onExportAllProjects={onExportAll}
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
              className="flex-1 bg-transparent text-xs text-white placeholder:text-slate-400 outline-none"
            />
          </div>
        </div>

        {/* Danh sách tính năng */}
        <div className="flex-1 overflow-y-auto px-3.5 py-2 space-y-0.5">
          {filteredFeatures.map((feat) => {
            const checked = selectedIds.has(feat.id);
            return (
              <label
                key={feat.id}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded transition-colors text-xs cursor-pointer ${checked
                  ? "bg-indigo-600/30 text-white font-medium border border-indigo-500/40"
                  : "text-slate-200 hover:text-white hover:bg-slate-900"
                  }`}
              >
                <DarkCheckbox
                  checked={checked}
                  onChange={() => toggleSelect(feat.id)}
                  ariaLabel={feat.name}
                />
                <span className="flex-1 truncate">{feat.name}</span>
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
                        className="border border-slate-700/80 rounded-lg overflow-hidden bg-slate-900/60 shadow-sm transition-all"
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

                            {/* Tên tính năng: bỏ viền và bỏ nền, chỉ còn chữ, in đậm, cùng cỡ chữ và màu tím */}
                            <span className="text-sm font-bold text-indigo-400 truncate">
                              {feat.name}
                            </span>
                          </div>
                          <span className="text-indigo-400 font-mono text-sm shrink-0 ml-2 flex items-center">
                            {steps.length} bước
                          </span>
                        </button>

                        {!isCollapsed && (
                          <div className="border-t border-slate-800 divide-y divide-slate-800/80 bg-slate-950/40">
                            {steps.length === 0 ? (
                              <div className="px-3.5 py-2 text-xs text-slate-500 italic">
                                Chưa có bước thực hiện nào được thiết lập cho tính năng này
                              </div>
                            ) : (
                              steps.map((stepText, stepIdx) => (
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
                                </div>
                              ))
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
        <footer className="h-12 shrink-0 px-6 border-t border-slate-700 bg-slate-950 flex items-center justify-between">
          <div className="text-xs text-slate-300 font-medium">
            {orderedFeatures.length} tính năng • {mergedSteps.length} bước
          </div>

          {runningBatchId ? (
            <button
              type="button"
              onClick={onNavigateToHistory}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700 text-indigo-300 hover:text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
            >
              <Loader2 size={14} className="animate-spin text-indigo-400" /> Xem đợt chạy đang diễn ra
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenBatchModal}
              disabled={orderedFeatures.length === 0}
              className="flex items-center gap-1.5 px-5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
            >
              <PlayCircle size={15} /> Bắt đầu chạy
            </button>
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

// ═══════════════════════════════════════════════════════════════════
// HỘP THOẠI HƯỚNG DẪN SỬ DỤNG (Chi tiết, Trực quan, Đa danh mục)
// ═══════════════════════════════════════════════════════════════════
function HelpModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState("script"); // "script" | "status" | "history" | "rules"

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header Modal */}
        <div className="px-5 py-3.5 border-b border-slate-700 flex items-center justify-between bg-slate-950/80 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-lg">💡</span>
            <div>
              <h3 className="text-sm font-semibold text-white">Cẩm nang & Hướng dẫn sử dụng AutoTest Studio</h3>
              <p className="text-[11px] text-slate-400">Tài liệu chuẩn hóa viết kịch bản, quy tắc đánh số, trạng thái và báo cáo</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md transition-colors cursor-pointer"
            title="Đóng (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-4 pt-2 gap-1.5 shrink-0 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab("script")}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
              activeTab === "script"
                ? "bg-slate-800 text-indigo-300 border-indigo-500"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/50"
            }`}
          >
            <span>✍️</span>
            <span>Viết kịch bản & Đánh số</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("status")}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
              activeTab === "status"
                ? "bg-slate-800 text-indigo-300 border-indigo-500"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/50"
            }`}
          >
            <span>🚦</span>
            <span>Ý nghĩa Trạng thái & Bằng chứng</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
              activeTab === "history"
                ? "bg-slate-800 text-indigo-300 border-indigo-500"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/50"
            }`}
          >
            <span>📊</span>
            <span>Báo cáo & Lịch sử</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("rules")}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
              activeTab === "rules"
                ? "bg-slate-800 text-indigo-300 border-indigo-500"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/50"
            }`}
          >
            <span>★</span>
            <span>Quy tắc vàng & Ví dụ</span>
          </button>
        </div>

        {/* Nội dung theo Tab */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-300 leading-relaxed flex-1">
          {activeTab === "script" && (
            <div className="space-y-4">
              {/* Cấu trúc 3 phần */}
              <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2">
                <h4 className="font-semibold text-white flex items-center gap-1.5 text-xs">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[11px] font-bold">1</span>
                  Cấu trúc 3 giai đoạn chuẩn của một Ca kiểm thử
                </h4>
                <div className="space-y-2 text-slate-300 pl-1">
                  <div className="p-2 rounded bg-slate-900/90 border border-slate-700/60">
                    <strong className="text-indigo-300 block mb-0.5">Bước A. Khởi đầu bằng Mở URL (Bắt buộc):</strong>
                    <span>Luôn bắt đầu kịch bản bằng hành động mở website kèm giao thức đầy đủ:</span>
                    <div className="mt-1 font-mono text-[11px] text-emerald-300 bg-black/40 p-1.5 rounded">
                      vào trang https://www.saucedemo.com
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-900/90 border border-slate-700/60">
                    <strong className="text-indigo-300 block mb-0.5">Bước B. Thao tác tương tác (Hành động):</strong>
                    <span>Chỉ rõ hành động (<code className="text-amber-300 font-mono">nhập</code>, <code className="text-amber-300 font-mono">bấm</code>, <code className="text-amber-300 font-mono">chọn</code>) kèm tên nhãn/nút hiển thị trên giao diện:</span>
                    <div className="mt-1 font-mono text-[11px] text-emerald-300 bg-black/40 p-1.5 rounded space-y-0.5">
                      <div>nhập standard_user vào ô Username</div>
                      <div>nhập secret_sauce vào ô Password</div>
                      <div>bấm nút Login</div>
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-900/90 border border-slate-700/60">
                    <strong className="text-indigo-300 block mb-0.5">Bước C. Kiểm chứng kết quả (Assertion):</strong>
                    <span>Khẳng định sự xuất hiện của phần tử hoặc văn bản cụ thể làm tiêu chí đạt:</span>
                    <div className="mt-1 font-mono text-[11px] text-emerald-300 bg-black/40 p-1.5 rounded">
                      kiểm tra xuất hiện chữ Products
                    </div>
                  </div>
                </div>
              </div>

              {/* Quy tắc đánh số thứ tự */}
              <div className="p-3.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 space-y-2">
                <h4 className="font-semibold text-indigo-300 flex items-center gap-1.5 text-xs">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[11px] font-bold">2</span>
                  Quy tắc đánh số thứ tự (Step-by-step Ordering)
                </h4>
                <p className="text-slate-300">
                  AI bóc tách kịch bản theo chuỗi hành động tuần tự (Pipeline). Việc đánh số thứ tự rõ ràng ở đầu mỗi dòng đem lại các lợi ích quan trọng:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] pt-1">
                  <div className="p-2 rounded bg-slate-900/90 border border-slate-700/80">
                    <span className="font-semibold text-white block mb-1">🎯 Theo dõi tiến độ chính xác:</span>
                    <span className="text-slate-300">Giao diện Runner sẽ đếm và hiển thị tiến độ thời gian thực: <code className="text-emerald-300">Bước 2/5 (40%)</code> giúp bạn nắm bắt thời điểm thực thi.</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/90 border border-slate-700/80">
                    <span className="font-semibold text-white block mb-1">📍 Khoanh vùng lỗi tức thì:</span>
                    <span className="text-slate-300">Nếu lỗi xảy ra ở bước nào, hệ thống ghim cờ lỗi kèm ảnh chụp bằng chứng tại đúng bước đó thay vì báo lỗi mơ hồ cho cả ca test.</span>
                  </div>
                </div>
                <div className="mt-2 p-2.5 rounded bg-slate-950/80 border border-slate-800 text-[11px]">
                  <span className="font-semibold text-amber-300 block mb-1">Ví dụ kịch bản đánh số chuẩn:</span>
                  <pre className="font-mono text-emerald-300 whitespace-pre-wrap leading-relaxed">
{`1. Vào trang https://www.saucedemo.com
2. Nhập standard_user vào ô Username
3. Nhập secret_sauce vào ô Password
4. Bấm nút Login
5. Kiểm tra xuất hiện chữ Products`}
                  </pre>
                </div>
              </div>

              {/* Sử dụng biến động */}
              <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1.5">
                <h4 className="font-semibold text-white flex items-center gap-1.5 text-xs">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[11px] font-bold">3</span>
                  Sử dụng biến động (Variables) cho Data-Driven Testing
                </h4>
                <p className="text-slate-300">
                  Dùng cú pháp <code className="bg-slate-900 px-1 py-0.5 rounded text-amber-300 font-mono">{"{{ten_bien}}"}</code> trong kịch bản để tự động thế giá trị từ Bảng biến số mà không cần sửa kịch bản gốc:
                </p>
                <div className="p-2 rounded bg-slate-900/90 font-mono text-[11px] text-slate-200">
                  vào trang <span className="text-amber-400">{"{{base_url}}"}</span> nhập <span className="text-amber-400">{"{{username}}"}</span> vào ô Username
                </div>
              </div>
            </div>
          )}

          {activeTab === "status" && (
            <div className="space-y-4">
              {/* Ý nghĩa trạng thái */}
              <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2.5">
                <h4 className="font-semibold text-white flex items-center gap-1.5 text-xs">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[11px] font-bold">1</span>
                  Ý nghĩa các Trạng thái Kiểm thử
                </h4>
                <div className="space-y-2 text-[11px]">
                  <div className="flex items-start gap-2.5 p-2 rounded bg-slate-900/70 border border-slate-800">
                    <span className="w-3 h-3 rounded-full bg-slate-500 mt-0.5 shrink-0" />
                    <div>
                      <strong className="text-slate-300">Sẵn sàng / Chờ chạy (Pending):</strong> Ca kiểm thử đang nằm trong hàng đợi hoặc chuẩn bị khởi tạo trình duyệt.
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 p-2 rounded bg-slate-900/70 border border-slate-800">
                    <span className="w-3 h-3 rounded-full bg-amber-400 mt-0.5 shrink-0 animate-pulse" />
                    <div>
                      <strong className="text-amber-300">Đang chạy (Running):</strong> Trình duyệt Playwright/Stagehand đang mở và AI đang phân tích DOM để thực thi thao tác thời gian thực.
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 p-2 rounded bg-slate-900/70 border border-slate-800">
                    <span className="w-3 h-3 rounded-full bg-emerald-400 mt-0.5 shrink-0" />
                    <div>
                      <strong className="text-emerald-400">Thành công / Đạt (Passed):</strong> Tất cả các thao tác tương tác hoàn tất trơn tru và điều kiện kiểm chứng (Assertion) khớp hoàn toàn với thực tế.
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 p-2 rounded bg-slate-900/70 border border-slate-800">
                    <span className="w-3 h-3 rounded-full bg-rose-400 mt-0.5 shrink-0" />
                    <div>
                      <strong className="text-rose-400">Lỗi / Thất bại (Failed):</strong> Ca kiểm thử gặp sự cố (không tìm thấy phần tử, sai kết quả kỳ vọng, hoặc timeout).
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 p-2 rounded bg-slate-900/70 border border-slate-800">
                    <span className="w-3 h-3 rounded-full bg-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <strong className="text-amber-500">Đã hủy (Aborted):</strong> Người dùng chủ động nhấn nút "Hủy đợt chạy" hoặc phiên bị đóng giữa chừng.
                    </div>
                  </div>
                </div>
              </div>

              {/* Phân loại lỗi Enterprise */}
              <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/30 space-y-2">
                <h4 className="font-semibold text-rose-300 flex items-center gap-1.5 text-xs">
                  <span className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-300 flex items-center justify-center text-[11px] font-bold">2</span>
                  Danh mục phân loại nguyên nhân lỗi (Failure Taxonomy)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 rounded bg-slate-900/90 border border-rose-500/20">
                    <span className="font-mono font-semibold text-rose-400 block mb-0.5">ASSERTION_FAILED</span>
                    <span className="text-slate-300">Kết quả thực tế mâu thuẫn với kỳ vọng (Ví dụ: kỳ vọng thấy chữ Products nhưng màn hình lại hiện thông báo lỗi tài khoản).</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/90 border border-rose-500/20">
                    <span className="font-mono font-semibold text-rose-400 block mb-0.5">ELEMENT_NOT_FOUND</span>
                    <span className="text-slate-300">Không tìm thấy phần tử DOM (nút bấm, ô nhập) sau thời gian chờ. Thường do sai tên phần tử hoặc website đổi giao diện.</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/90 border border-rose-500/20">
                    <span className="font-mono font-semibold text-rose-400 block mb-0.5">TIMEOUT</span>
                    <span className="text-slate-300">Hết thời gian thao tác (mặc định 60 giây/bước) do mạng quá chậm hoặc website treo.</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/90 border border-rose-500/20">
                    <span className="font-mono font-semibold text-rose-400 block mb-0.5">EXECUTION_ERROR</span>
                    <span className="text-slate-300">Lỗi môi trường trình duyệt bị ngắt kết nối đột ngột hoặc ngoại lệ hệ thống.</span>
                  </div>
                </div>
              </div>

              {/* Bằng chứng ảnh */}
              <div className="p-3.5 rounded-lg bg-sky-500/10 border border-sky-500/30 space-y-2">
                <h4 className="font-semibold text-sky-300 flex items-center gap-1.5 text-xs">
                  <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-300 flex items-center justify-center text-[11px] font-bold">3</span>
                  Ý nghĩa Bằng chứng Trực quan (Before / After Evidence)
                </h4>
                <div className="space-y-1.5 text-[11px] text-slate-300">
                  <div>
                    <strong className="text-sky-300">🎯 Ảnh Trước thao tác (Before - Viền đỏ dày 4px):</strong> Hệ thống tự động khoanh khung viền đỏ nổi bật quanh phần tử mục tiêu trước khi click hay nhập. Điều này cho phép bạn thẩm định 100% tính chính xác của AI xem có bấm đúng phần tử yêu cầu không.
                  </div>
                  <div>
                    <strong className="text-emerald-300">📸 Ảnh Sau thao tác (After):</strong> Chụp lại trạng thái trang web sau khi hoàn thành thao tác để lưu trữ bằng chứng kiểm thử không thể chối cãi.
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "history" && (
            <div className="space-y-4">
              {/* Duyệt đợt chạy */}
              <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2">
                <h4 className="font-semibold text-white flex items-center gap-1.5 text-xs">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[11px] font-bold">1</span>
                  Xem và Quản lý Lịch sử theo Đợt chạy (Batch Runs)
                </h4>
                <ul className="list-disc list-inside space-y-1 text-slate-300 pl-1 text-[11px]">
                  <li>Chuyển sang tab <strong className="text-white">Lịch sử</strong> ở thanh điều hướng trên cùng.</li>
                  <li>Cột bên trái liệt kê toàn bộ các đợt chạy theo thời gian thực: hiển thị ngày giờ, số ca test đạt/hỏng, tỷ lệ Pass Rate và tên dự án.</li>
                  <li>Dùng thanh tìm kiếm trên đầu danh sách để lọc nhanh theo tên đợt chạy, tên tính năng hoặc dự án.</li>
                </ul>
              </div>

              {/* Xem chi tiết và Lightbox */}
              <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2">
                <h4 className="font-semibold text-white flex items-center gap-1.5 text-xs">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[11px] font-bold">2</span>
                  Xem Diễn biến Bước & Phóng to Lightbox 2x Retina
                </h4>
                <p className="text-slate-300 text-[11px]">
                  Khi chọn một đợt chạy, bảng chi tiết bên phải sẽ hiển thị từng bước kiểm thử kèm log thực thi:
                </p>
                <div className="space-y-1.5 text-[11px] pl-1">
                  <div className="p-2 rounded bg-slate-900/90 border border-slate-700/60">
                    <strong className="text-indigo-300">🔍 Phóng to ảnh (Lightbox):</strong> Nhấp vào bất kỳ ảnh chụp màn hình nào để mở trình xem ảnh toàn màn hình với độ nét Retina 2x. Sử dụng phím mũi tên hoặc nút chuyển để xem ảnh Trước và Sau thao tác.
                  </div>
                  <div className="p-2 rounded bg-slate-900/90 border border-slate-700/60">
                    <strong className="text-rose-300">🩺 Phân tích nguyên nhân lỗi (Root Cause):</strong> Với ca test bị lỗi, hệ thống tự động bóc tách lỗi chi tiết, đề xuất giải pháp khắc phục trực tiếp trong bảng báo cáo.
                  </div>
                </div>
              </div>

              {/* Tải báo cáo HTML */}
              <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-2">
                <h4 className="font-semibold text-emerald-300 flex items-center gap-1.5 text-xs">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-[11px] font-bold">3</span>
                  Xuất / Tải Báo Cáo HTML Độc Lập (Offline Single-File)
                </h4>
                <p className="text-slate-300 text-[11px]">
                  Nhấn nút <strong className="text-white bg-indigo-600 px-1.5 py-0.5 rounded">Tải Báo Cáo</strong> ở góc trên bên phải của đợt chạy:
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-300 pl-1 text-[11px]">
                  <li>Hệ thống tạo ra một file HTML duy nhất chứa toàn bộ thông tin kiểm thử, biểu đồ thống kê và logs.</li>
                  <li><strong className="text-white">Ảnh chụp đã được nhúng sẵn Base64:</strong> Báo cáo mở xem được ngoại tuyến (offline) trên mọi máy tính và điện thoại mà không cần mạng Internet hay kết nối máy chủ AutoTest.</li>
                  <li>Dễ dàng đính kèm vào email bàn giao, lưu trữ hồ sơ nghiệm thu hoặc gửi ticket lỗi cho đội ngũ lập trình viên.</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === "rules" && (
            <div className="space-y-4">
              {/* Quy tắc vàng */}
              <div className="space-y-2 p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <h4 className="font-semibold text-amber-300 flex items-center gap-1.5 text-xs">
                  <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center text-[11px] font-bold">★</span>
                  Quy tắc vàng: Khẳng định dấu hiệu cụ thể (Tránh câu hỏi nghi vấn mở)
                </h4>
                <p className="text-slate-300">
                  AI cần một <strong className="text-white">tiêu chí nhận diện cụ thể</strong> để đối chiếu. Hãy tránh viết câu hỏi nghi vấn mở như <code className="bg-slate-900/80 px-1 py-0.5 rounded text-rose-300">kiểm tra đã đăng nhập thành công chưa?</code> vì khi đăng nhập lỗi, AI có thể tìm thấy khung thông báo lỗi và hiểu nhầm là đã tìm thấy kết quả.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 pt-1 text-[11px]">
                  <div className="p-2 rounded bg-slate-900/90 border border-emerald-500/30">
                    <span className="font-semibold text-emerald-400 block mb-1">✔ Test đăng nhập thành công (Positive):</span>
                    <span className="text-slate-300">Nhập user/pass đúng ➔ <code className="text-emerald-300">kiểm tra thấy chữ Products</code> hoặc <code className="text-emerald-300">kiểm tra có nút Logout</code></span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/90 border border-rose-500/30">
                    <span className="font-semibold text-rose-400 block mb-1">✔ Test đăng nhập thất bại (Negative):</span>
                    <span className="text-slate-300">Nhập sai mật khẩu ➔ <code className="text-rose-300">kiểm tra hiển thị thông báo lỗi Username and password do not match</code></span>
                  </div>
                </div>
              </div>

              {/* Bảng so sánh */}
              <div className="space-y-1.5 p-3.5 rounded-lg bg-slate-950/60 border border-slate-800">
                <h4 className="font-semibold text-white flex items-center gap-1.5 text-xs">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[11px] font-bold">2</span>
                  Bảng đối chiếu Kịch bản Nên viết vs Không nên viết
                </h4>
                <div className="space-y-2 mt-1">
                  <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-[11px]">
                    <div className="text-rose-400 font-semibold mb-0.5">✕ Không nên viết (Mơ hồ, dễ sai lệch):</div>
                    <div className="text-slate-300 italic">"vào trang saucedemo gõ linh tinh rồi ấn login xem có được không"</div>
                    <div className="text-slate-400 text-[10px] mt-0.5">➔ Thiếu URL đầy đủ, không rõ giá trị nhập, câu hỏi mở "xem có được không" khiến AI không biết tiêu chí nào là đạt/hỏng.</div>
                  </div>
                  <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-[11px]">
                    <div className="text-emerald-400 font-semibold mb-0.5">✓ Nên viết (Rõ ràng, tuần tự từng bước):</div>
                    <div className="text-slate-200">
                      "1. Vào trang https://www.saucedemo.com<br/>
                       2. Nhập standard_user vào ô Username<br/>
                       3. Nhập secret_sauce vào ô Password<br/>
                       4. Bấm nút Login<br/>
                       5. Kiểm tra xuất hiện chữ Products"
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Modal */}
        <div className="px-5 py-3 border-t border-slate-700 flex justify-between items-center bg-slate-950/80 shrink-0">
          <span className="text-[11px] text-slate-400">Nhấn <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-600 rounded text-[10px] text-slate-300">Esc</kbd> để đóng</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HỘP THOẠI CÀI ĐẶT (.env)
// ═══════════════════════════════════════════════════════════════════
function ModelSettingsModal({ isOpen, onClose, currentModel, onModelUpdated }) {
  const [envVars, setEnvVars] = useState([]);
  const [initialVars, setInitialVars] = useState({});
  const [showSecrets, setShowSecrets] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: "", text: "" });

  const isSecretKey = (key) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key);

  const toggleSecret = (key) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Đọc toàn bộ file .env khi mở modal
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    setIsLoading(true);
    setStatusMsg({ type: "", text: "" });

    fetch(`${API_BASE_URL}/config/env`)
      .then((res) => res.json())
      .then((data) => {
        if (!mounted) return;
        if (data.success && Array.isArray(data.variables)) {
          setEnvVars(data.variables);
          const initialMap = {};
          data.variables.forEach((v) => {
            initialMap[v.key] = v.value;
          });
          setInitialVars(initialMap);
        } else {
          // Fallback nếu có lỗi
          setEnvVars([{ key: "LLM_MODEL", value: currentModel || "qwen/qwen3.8-27b" }]);
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setStatusMsg({ type: "error", text: `Không thể đọc file .env: ${err.message}` });
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      mounted = false;
      window.removeEventListener("keydown", handleKey);
    };
  }, [isOpen, currentModel, onClose]);

  if (!isOpen) return null;

  const handleValueChange = (key, newValue) => {
    // Giá trị không được chứa xuống dòng
    const sanitized = newValue.replace(/[\r\n]+/g, "");
    setEnvVars((prev) =>
      prev.map((item) => (item.key === key ? { ...item, value: sanitized } : item))
    );
  };

  const handleSave = async (e) => {
    e?.preventDefault();

    // Xác định các biến đã sửa so với ban đầu
    const modifiedVars = envVars.filter((item) => initialVars[item.key] !== item.value);

    if (modifiedVars.length === 0) {
      setStatusMsg({ type: "info", text: "Không có biến nào bị thay đổi." });
      return;
    }

    // Kiểm tra không được chứa ký tự xuống dòng
    for (const item of modifiedVars) {
      if (/[\r\n]/.test(item.value)) {
        setStatusMsg({
          type: "error",
          text: `Giá trị của biến "${item.key}" không được chứa ký tự xuống dòng.`,
        });
        return;
      }
    }

    setIsSaving(true);
    setStatusMsg({ type: "", text: "" });

    try {
      const res = await fetch(`${API_BASE_URL}/config/env`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables: modifiedVars }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        // Cập nhật lại initialVars
        const nextInitial = { ...initialVars };
        modifiedVars.forEach((v) => {
          nextInitial[v.key] = v.value;
        });
        setInitialVars(nextInitial);

        // Nếu có thay đổi LLM_MODEL, cập nhật ra ngoài
        const updatedModelVar = modifiedVars.find((v) => v.key === "LLM_MODEL");
        if (updatedModelVar && onModelUpdated) {
          onModelUpdated(updatedModelVar.value);
        }

        if (data.requireRestart) {
          setStatusMsg({
            type: "warning",
            text: "Cần khởi động lại để áp dụng",
          });
        } else {
          setStatusMsg({
            type: "success",
            text: "Đã lưu cấu hình thành công!",
          });
          setTimeout(() => {
            onClose();
          }, 1200);
        }
      } else {
        setStatusMsg({
          type: "error",
          text: data.error || "Không thể cập nhật file .env",
        });
      }
    } catch (err) {
      setStatusMsg({
        type: "error",
        text: `Lỗi kết nối máy chủ: ${err.message}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header Modal */}
        <div className="px-5 py-3.5 border-b border-slate-700 flex items-center justify-between bg-slate-950/80 shrink-0">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-indigo-500/20 text-indigo-400">
              <Settings size={18} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">Cài đặt (.env)</h3>
              <p className="text-[11px] text-slate-400">Chỉnh sửa các biến trong file cấu hình</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md transition-colors cursor-pointer"
            title="Đóng (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Danh sách các biến .env */}
        <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
          <div className="p-5 overflow-y-auto space-y-3 text-xs flex-1">
            {isLoading ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                <Loader2 size={22} className="animate-spin text-indigo-400" />
                <span>Đang đọc file .env...</span>
              </div>
            ) : envVars.length === 0 ? (
              <div className="py-8 text-center text-slate-400">
                Không tìm thấy biến cấu hình nào trong file .env
              </div>
            ) : (
              envVars.map((item) => {
                const isSecret = isSecretKey(item.key);
                const isVisible = showSecrets[item.key];
                const isModified = initialVars[item.key] !== item.value;

                return (
                  <div
                    key={item.key}
                    className={`flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 p-2.5 rounded-lg border transition-all ${
                      isModified
                        ? "bg-indigo-950/20 border-indigo-500/40"
                        : "bg-slate-950/60 border-slate-800/80"
                    }`}
                  >
                    {/* Tên biến (chỉ đọc) */}
                    <div className="sm:w-5/12 min-w-[150px] shrink-0">
                      <span
                        className="text-[11px] font-mono font-semibold text-indigo-300 break-all select-text"
                        title={item.key}
                      >
                        {item.key}
                      </span>
                      {isModified && (
                        <span className="ml-1.5 px-1.5 py-0.2 rounded text-[9px] font-semibold bg-indigo-500/20 text-indigo-300">
                          Đã sửa
                        </span>
                      )}
                    </div>

                    {/* Ô giá trị (sửa được) */}
                    <div className="flex-1 relative flex items-center">
                      <input
                        type={isSecret ? (isVisible ? "text" : "password") : "text"}
                        value={item.value}
                        onChange={(e) => handleValueChange(item.key, e.target.value)}
                        disabled={isLoading || isSaving}
                        className={`w-full px-3 py-1.5 bg-slate-900 border rounded-md text-white font-mono text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all ${
                          isSecret ? "pr-9" : ""
                        } border-slate-700 placeholder:text-slate-500 disabled:opacity-50`}
                      />
                      {isSecret && (
                        <button
                          type="button"
                          onClick={() => toggleSecret(item.key)}
                          className="absolute right-2 text-slate-400 hover:text-slate-200 p-1 cursor-pointer transition-colors"
                          title={isVisible ? "Ẩn giá trị" : "Hiện giá trị"}
                        >
                          {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Thông báo phản hồi */}
          {statusMsg.text && (
            <div className="px-5 py-2 shrink-0">
              {statusMsg.type === "success" && (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-2 text-[11px]">
                  <Check size={14} className="shrink-0" />
                  <span>{statusMsg.text}</span>
                </div>
              )}
              {statusMsg.type === "warning" && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center gap-2 text-[11px]">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{statusMsg.text}</span>
                </div>
              )}
              {statusMsg.type === "error" && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center gap-2 text-[11px]">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{statusMsg.text}</span>
                </div>
              )}
              {statusMsg.type === "info" && (
                <div className="p-2.5 rounded-lg bg-slate-800 text-slate-300 text-[11px]">
                  <span>{statusMsg.text}</span>
                </div>
              )}
            </div>
          )}

          {/* Footer nút hành động */}
          <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 flex justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSaving || isLoading}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-md shadow-indigo-900/30"
            >
              {isSaving ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Đang lưu vào .env...</span>
                </>
              ) : (
                <>
                  <Save size={13} />
                  <span>Lưu</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HÀM TẠO BÁO CÁO HTML ĐỘC LẬP CLIENT-SIDE (FALLBACK)
// ═══════════════════════════════════════════════════════════════════
const escapeHtmlReport = (str) => {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const generateClientSideHtmlReport = (batch, fallbackProjectName = "Mặc định") => {
  if (!batch) return "";
  const reportTitle = batch.name || "Báo cáo kiểm thử tự động";
  const projectName = batch.projectName || fallbackProjectName || "Mặc định";
  const formattedDate = formatTime(batch.startedAt);

  const features = Array.isArray(batch.features) ? batch.features : [];
  const totalFeatures = features.length;
  const passedFeatures = features.filter((f) => f.status === "PASSED" || f.status === "passed").length;
  const failedFeatures = totalFeatures - passedFeatures;
  const isPassedOverall = failedFeatures === 0 && totalFeatures > 0;
  const passRate = totalFeatures > 0 ? Math.round((passedFeatures / totalFeatures) * 100) : 0;

  let totalSteps = 0;
  let passedSteps = 0;
  let totalImagesCount = 0;

  for (const feat of features) {
    const rawSteps = Array.isArray(feat.stepResults) && feat.stepResults.length > 0
      ? feat.stepResults
      : (Array.isArray(feat.steps) && typeof feat.steps[0] === "object" ? feat.steps : []);

    for (const st of rawSteps) {
      totalSteps++;
      if (st.status === "passed") passedSteps++;
      const shots = Array.isArray(st.screenshots) && st.screenshots.length > 0
        ? st.screenshots
        : (st.screenshotUrl ? [{ url: st.screenshotUrl }] : []);
      totalImagesCount += shots.length;
    }
  }

  let durationMs = batch.durationMs || batch.duration || 0;
  if (!durationMs && batch.startedAt && batch.finishedAt) {
    const diff = new Date(batch.finishedAt).getTime() - new Date(batch.startedAt).getTime();
    if (diff > 0) durationMs = diff;
  }
  if (!durationMs) {
    durationMs = features.reduce((acc, f) => acc + (f.durationMs || 0), 0);
  }
  const formattedDuration = formatDuration(durationMs);

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Báo cáo kiểm thử - ${escapeHtmlReport(reportTitle)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #030712;
      color: #f3f4f6;
      line-height: 1.5;
      padding: 32px 16px;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
    }
    .card {
      background-color: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      font-size: 13px;
      font-weight: 600;
      color: #818cf8;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .title {
      font-size: 22px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 4px;
    }
    .subtitle {
      font-size: 13px;
      color: #94a3b8;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }
    .badge-passed {
      background-color: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.4);
    }
    .badge-failed {
      background-color: rgba(244, 63, 94, 0.15);
      color: #fb7185;
      border: 1px solid rgba(244, 63, 94, 0.4);
    }
    .badge-feature {
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 9999px;
      text-transform: uppercase;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      padding-top: 16px;
      border-top: 1px solid #1e293b;
    }
    .kpi-box {
      background-color: #090d16;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 12px 14px;
    }
    .kpi-label {
      font-size: 11px;
      color: #94a3b8;
      margin-bottom: 4px;
    }
    .kpi-value {
      font-size: 15px;
      font-weight: 700;
      color: #f8fafc;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .notes-box {
      background-color: #090d16;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 12px 14px;
      margin-top: 16px;
      font-size: 12px;
      color: #cbd5e1;
    }
    .notes-label {
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 4px;
    }
    .section-title {
      font-size: 15px;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .feature-card {
      background-color: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      margin-bottom: 24px;
      overflow: hidden;
    }
    .feature-header {
      padding: 16px 20px;
      background-color: rgba(15, 23, 42, 0.9);
      border-bottom: 1px solid #1e293b;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .feature-title {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .feature-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      color: #94a3b8;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .feature-content {
      padding: 20px;
    }
    .step-item {
      background-color: #090d16;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .step-item:last-child {
      margin-bottom: 0;
    }
    .step-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .step-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      flex: 1;
    }
    .step-num {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background-color: #1e293b;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      color: #cbd5e1;
      shrink: 0;
    }
    .step-type {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .type-navigate { background: rgba(14, 165, 233, 0.15); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.3); }
    .type-act { background: rgba(129, 140, 248, 0.15); color: #818cf8; border: 1px solid rgba(129, 140, 248, 0.3); }
    .type-assert { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .type-view { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .step-text {
      font-size: 13px;
      font-weight: 600;
      color: #f1f5f9;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      word-break: break-word;
    }
    .step-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .step-time {
      font-size: 11px;
      color: #94a3b8;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .step-status {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .status-passed { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .status-failed { background: rgba(244, 63, 94, 0.2); color: #fb7185; }
    .error-box {
      background-color: rgba(136, 19, 55, 0.25);
      border: 1px solid rgba(225, 29, 72, 0.4);
      border-radius: 6px;
      padding: 10px 14px;
      color: #fda4af;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      margin-top: 10px;
      margin-bottom: 12px;
    }
    .shots-container {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px;
      padding-top: 12px;
      border-top: 1px solid #1e293b;
      margin-top: 12px;
    }
    .shot-card {
      background-color: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      overflow: hidden;
      width: 240px;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .shot-card:hover {
      transform: scale(1.02);
      border-color: #818cf8;
    }
    .shot-header {
      padding: 6px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      background-color: #1e293b;
      border-bottom: 1px solid #334155;
    }
    .shot-tag {
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 3px;
    }
    .tag-before { background: rgba(129, 140, 248, 0.2); color: #a5b4fc; }
    .tag-after { background: rgba(16, 185, 129, 0.2); color: #6ee7b7; }
    .tag-error { background: rgba(244, 63, 94, 0.2); color: #fda4af; }
    .tag-view { background: rgba(14, 165, 233, 0.2); color: #7dd3fc; }
    .shot-sub {
      color: #94a3b8;
      font-size: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 140px;
    }
    .shot-img-wrapper {
      width: 240px;
      height: 150px;
      overflow: hidden;
      background-color: #000000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .shot-img-wrapper img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .arrow-divider {
      font-size: 18px;
      color: #818cf8;
      font-weight: bold;
    }
    .lightbox-modal {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.88);
      z-index: 9999;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .lightbox-modal.active {
      display: flex;
    }
    .lightbox-content {
      max-width: 90vw;
      max-height: 90vh;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #334155;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .lightbox-content img {
      max-width: 100%;
      max-height: 85vh;
      display: block;
    }
    .lightbox-close {
      position: absolute;
      top: 20px;
      right: 24px;
      background: #1e293b;
      color: #fff;
      border: 1px solid #475569;
      border-radius: 50%;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      cursor: pointer;
    }
    .footer {
      text-align: center;
      font-size: 12px;
      color: #64748b;
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #1e293b;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header-top">
        <div>
          <div class="brand">🧪 AUTOTEST STUDIO · BÁO CÁO THỰC THI KIỂM THỬ</div>
          <h1 class="title">${escapeHtmlReport(reportTitle)}</h1>
          <div class="subtitle">Dự án: ${escapeHtmlReport(projectName)} · Mã phiên: ${escapeHtmlReport(batch.id)}</div>
        </div>
        <div>
          <span class="badge ${isPassedOverall ? "badge-passed" : "badge-failed"}">
            ${isPassedOverall ? "✓ PASSED (THÀNH CÔNG)" : "✕ FAILED (CÓ THẤT BẠI)"}
          </span>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-box">
          <div class="kpi-label">Thời gian bắt đầu</div>
          <div class="kpi-value">${formattedDate}</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Tổng thời lượng</div>
          <div class="kpi-value">${formattedDuration}</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Tỷ lệ Đạt (Tính năng)</div>
          <div class="kpi-value">${passedFeatures}/${totalFeatures} (${passRate}%)</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Tiến độ các bước</div>
          <div class="kpi-value">${passedSteps}/${totalSteps} Đạt</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Bằng chứng thị giác</div>
          <div class="kpi-value">${totalImagesCount} ảnh</div>
        </div>
      </div>

      ${batch.notes ? `
        <div class="notes-box">
          <div class="notes-label">Ghi chú đợt chạy:</div>
          <div>${escapeHtmlReport(batch.notes)}</div>
        </div>
      ` : ""}
    </div>

    <div class="section-title">
      <span>📋 Chi tiết kết quả kiểm thử (${features.length} tính năng)</span>
    </div>

    ${features.map((feat, featIdx) => {
      const featStatus = (feat.status || "PASSED").toUpperCase();
      const featPassed = featStatus === "PASSED";
      const rawSteps = Array.isArray(feat.stepResults) && feat.stepResults.length > 0
        ? feat.stepResults
        : (Array.isArray(feat.steps) && typeof feat.steps[0] === "object" ? feat.steps : []);

      return `
      <div class="feature-card">
        <div class="feature-header">
          <div class="feature-title">
            <span style="color: #818cf8;">#${featIdx + 1}</span>
            <span>${escapeHtmlReport(feat.name)}</span>
          </div>
          <div class="feature-meta">
            <span>${formatDuration(feat.durationMs || 0)}</span>
            <span class="badge-feature ${featPassed ? "badge-passed" : "badge-failed"}">
              ${featPassed ? "✓ ĐẠT" : "✕ LỖI"}
            </span>
          </div>
        </div>

        <div class="feature-content">
          ${feat.error ? `
            <div class="error-box">
              <strong>Lỗi tính năng:</strong> ${escapeHtmlReport(feat.error)}
            </div>
          ` : ""}

          ${rawSteps.length === 0 ? `
            <div style="font-size:12px; color:#64748b; font-style:italic;">
              Chưa có dữ liệu bước kiểm thử chi tiết.
            </div>
          ` : rawSteps.map((st, stepIdx) => {
            const stPassed = (st.status || "passed").toLowerCase() === "passed";
            const stType = (st.type || "act").toLowerCase();
            const isNav = stType === "navigate" || stType === "goto";
            const isAssert = stType === "assert" || stType === "observe";
            const isView = stType === "view";
            const typeClass = isNav ? "type-navigate" : isAssert ? "type-assert" : isView ? "type-view" : "type-act";
            const typeName = isNav ? "Điều hướng" : isAssert ? "Kiểm tra" : isView ? "Giao diện" : "Hành động";
            const shots = Array.isArray(st.screenshots) && st.screenshots.length > 0
              ? st.screenshots
              : (st.screenshotUrl ? [{ url: st.screenshotUrl, type: "after", label: "Ảnh chụp màn hình" }] : []);

            return `
            <div class="step-item">
              <div class="step-header">
                <div class="step-left">
                  <span class="step-num">${stepIdx + 1}</span>
                  <span class="step-type ${typeClass}">${typeName}</span>
                  <span class="step-text">${escapeHtmlReport(st.text || st.step || "Thao tác")}</span>
                </div>
                <div class="step-right">
                  ${st.durationMs ? `<span class="step-time">${formatDuration(st.durationMs)}</span>` : ""}
                  <span class="step-status ${stPassed ? "status-passed" : "status-failed"}">
                    ${stPassed ? "Đạt" : "Lỗi"}
                  </span>
                </div>
              </div>

              ${!stPassed && (st.error || st.message) ? `
                <div class="error-box">
                  <strong>Lỗi:</strong> ${escapeHtmlReport(st.error || st.message)}
                  ${st.detectedAlert ? `<div style="margin-top:6px; font-size:11px; color:#fca5a5;"><strong>Cảnh báo trên trang:</strong> ${escapeHtmlReport(st.detectedAlert)}</div>` : ""}
                </div>
              ` : ""}

              ${shots.length > 0 ? `
                <div class="shots-container">
                  ${shots.map((shot, shotIdx) => {
                    const isBefore = shot.type === "before";
                    const isError = shot.type === "error";
                    const isV = shot.type === "view";
                    const tagClass = isBefore ? "tag-before" : isError ? "tag-error" : isV ? "tag-view" : "tag-after";
                    const tagText = isBefore ? "Trước" : isError ? "Lỗi" : isV ? "Trang" : "Sau";
                    const subText = shot.sublabel || (isBefore ? "Tiêu điểm viền đỏ" : isV ? "Trang web" : "Kết quả tương tác");

                    return `
                    ${shotIdx > 0 ? `<span class="arrow-divider">→</span>` : ""}
                    <div class="shot-card" onclick="openLightbox('${shot.url}')" title="Nhấp để phóng to">
                      <div class="shot-header">
                        <span class="shot-tag ${tagClass}">${tagText}</span>
                        <span class="shot-sub">${escapeHtmlReport(subText)}</span>
                      </div>
                      <div class="shot-img-wrapper">
                        <img src="${shot.url}" alt="${escapeHtmlReport(shot.label || "Ảnh chụp")}" loading="lazy" />
                      </div>
                    </div>
                    `;
                  }).join("")}
                </div>
              ` : ""}
            </div>
            `;
          }).join("")}
        </div>
      </div>
      `;
    }).join("")}

    <div class="footer">
      Báo cáo được khởi tạo tự động bởi <strong>AutoTest Studio</strong> · Ngày xuất: ${formatTime(new Date().toISOString())}
    </div>
  </div>

  <div id="lightbox" class="lightbox-modal" onclick="closeLightbox()">
    <div class="lightbox-close" onclick="closeLightbox()">✕</div>
    <div class="lightbox-content" onclick="event.stopPropagation()">
      <img id="lightbox-img" src="" alt="Ảnh phóng to" />
    </div>
  </div>

  <script>
    function openLightbox(url) {
      if (!url) return;
      document.getElementById('lightbox-img').src = url;
      document.getElementById('lightbox').classList.add('active');
    }
    function closeLightbox() {
      document.getElementById('lightbox').classList.remove('active');
    }
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeLightbox();
    });
  </script>
</body>
</html>`;
};

// ═══════════════════════════════════════════════════════════════════
// TAB 3  ─  LỊCH SỬ KIỂM THỬ (Quản lý theo Đợt chạy)
// ═══════════════════════════════════════════════════════════════════
function HistoryTab({
  projects,
  activeProjectId,
  onSelectProject,
  onUpsertProject,
  onDeleteProject,
  onExportProject,
  onExportAll,
  history = [],
  selectedBatchId,
  onSelectBatchId,
  onDeleteBatch,
  onAbortBatchRun,
  _runningBatchId,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFeatures, setExpandedFeatures] = useState({});
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [deleteConfirmBatch, setDeleteConfirmBatch] = useState(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectToEdit, setProjectToEdit] = useState(null);
  const [downloadingReportId, setDownloadingReportId] = useState(null);

  const handleDownloadHtmlReport = async (batch) => {
    if (!batch || downloadingReportId) return;
    setDownloadingReportId(batch.id);

    try {
      // 1. Tải báo cáo từ Backend (có nhúng base64 ảnh trực tiếp từ ổ cứng)
      const res = await fetch(`${API_BASE_URL}/history/${encodeURIComponent(batch.id)}/report`, {
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const ascii = String(batch.name || "report")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d")
          .replace(/Đ/g, "D");
        const safeName = ascii
          .replace(/[^\w\s-]/gi, "")
          .trim()
          .replace(/\s+/g, "_")
          .toLowerCase();
        a.download = `report_${safeName || "test_report"}_${batch.id}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }
    } catch (err) {
      console.warn("Không thể tải báo cáo từ backend, chuyển sang tạo báo cáo trực tiếp:", err.message);
    }

    // 2. Dự phòng: Tạo báo cáo HTML trực tiếp trên Client
    try {
      const html = generateClientSideHtmlReport(batch, currentProject?.name);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ascii = String(batch.name || "report")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D");
      const safeName = ascii
        .replace(/[^\w\s-]/gi, "")
        .trim()
        .replace(/\s+/g, "_")
        .toLowerCase();
      a.download = `report_${safeName || "test_report"}_${batch.id}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Lỗi khi tạo báo cáo HTML client-side:", err);
      alert("Không thể tải báo cáo HTML: " + err.message);
    } finally {
      setDownloadingReportId(null);
    }
  };

  const currentProject = useMemo(() =>
    projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  // Chuẩn hóa toàn bộ lịch sử thành cấu trúc Đợt chạy
  const normalizedBatches = useMemo(() => {
    return (history || []).map(normalizeBatch).filter(Boolean);
  }, [history]);

  // Lọc theo dự án hiện tại và ô tìm kiếm (lọc theo tên đợt chạy & tên tính năng bên trong)
  const filteredBatches = useMemo(() => {
    let list = normalizedBatches;
    if (activeProjectId) {
      list = list.filter((b) => b.projectId === activeProjectId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((b) => {
        const matchName = b.name && b.name.toLowerCase().includes(q);
        const matchFeatures = Array.isArray(b.features) && b.features.some((f) => f.name && f.name.toLowerCase().includes(q));
        return matchName || matchFeatures;
      });
    }
    return list;
  }, [normalizedBatches, activeProjectId, searchQuery]);

  // Sắp xếp: Đợt chạy đang chạy ở đầu danh sách, sau đó mới nhất ở trên
  const sortedBatches = useMemo(() => {
    return [...filteredBatches].sort((a, b) => {
      const aRunning = a.status === "Đang chạy";
      const bRunning = b.status === "Đang chạy";
      if (aRunning && !bRunning) return -1;
      if (!aRunning && bRunning) return 1;
      const timeA = new Date(a.startedAt || 0).getTime();
      const timeB = new Date(b.startedAt || 0).getTime();
      return timeB - timeA;
    });
  }, [filteredBatches]);

  // Nhóm theo ngày cho Sidebar
  const dateGroups = useMemo(() => {
    const groups = [];
    const map = new Map();
    for (const b of sortedBatches) {
      const label = getDateGroupLabel(b.startedAt);
      if (!map.has(label)) {
        map.set(label, []);
        groups.push({ label, items: map.get(label) });
      }
      map.get(label).push(b);
    }
    return groups;
  }, [sortedBatches]);

  // Đợt chạy đang được chọn
  const activeBatch = useMemo(() => {
    if (selectedBatchId) {
      const found = sortedBatches.find((b) => b.id === selectedBatchId);
      if (found) return found;
    }
    return sortedBatches[0] || null;
  }, [selectedBatchId, sortedBatches]);

  // Tự động chọn đợt chạy đầu tiên nếu chưa chọn
  useEffect(() => {
    if (!selectedBatchId && sortedBatches.length > 0) {
      onSelectBatchId(sortedBatches[0].id);
    }
  }, [selectedBatchId, sortedBatches, onSelectBatchId]);

  // Danh sách tính năng trong đợt chạy: FAILED và ERROR lên đầu
  const sortedFeaturesInBatch = useMemo(() => {
    if (!activeBatch?.features) return [];
    const priority = (s) => {
      if (s === "FAILED") return 0;
      if (s === "ERROR") return 1;
      if (s === "RUNNING") return 2;
      if (s === "PENDING") return 3;
      if (s === "SKIPPED") return 4;
      if (s === "PASSED") return 5;
      return 6;
    };
    return [...activeBatch.features].sort((a, b) => priority(a.status) - priority(b.status));
  }, [activeBatch?.features]);

  // Thu thập toàn bộ ảnh chụp trong đợt chạy được chọn cho Lightbox
  const allLightboxShots = useMemo(() => {
    if (!activeBatch?.features) return [];
    const list = [];
    for (const feat of activeBatch.features) {
      for (const step of feat.stepResults || []) {
        if (Array.isArray(step.screenshots) && step.screenshots.length > 0) {
          for (const shot of step.screenshots) {
            list.push({
              ...shot,
              featureName: feat.name,
              stepText: step.text,
            });
          }
        } else if (step.screenshotUrl) {
          list.push({
            url: step.screenshotUrl,
            label: "Ảnh chụp màn hình",
            type: "after",
            featureName: feat.name,
            stepText: step.text,
          });
        }
      }
    }
    return list;
  }, [activeBatch]);

  const handleOpenLightbox = (shotUrl) => {
    const foundIdx = allLightboxShots.findIndex((s) => s.url === shotUrl);
    setLightboxIndex(foundIdx >= 0 ? foundIdx : 0);
    setLightboxOpen(true);
  };

  const toggleFeatureExpand = (featId) => {
    setExpandedFeatures((prev) => ({ ...prev, [featId]: !prev[featId] }));
  };

  // Tính các số liệu pass và fail của đợt chạy
  const metrics = useMemo(() => {
    const feats = activeBatch?.features || [];
    return {
      pass: feats.filter((f) => f.status === "PASSED").length,
      fail: feats.filter((f) => f.status === "FAILED" || f.status === "ERROR").length,
      total: feats.length,
    };
  }, [activeBatch]);

  // Tính thời lượng đợt chạy
  const batchDuration = useMemo(() => {
    if (!activeBatch) return "0s";
    if (activeBatch.finishedAt && activeBatch.startedAt) {
      const ms = Math.max(0, new Date(activeBatch.finishedAt).getTime() - new Date(activeBatch.startedAt).getTime());
      return formatDuration(ms);
    }
    const sumMs = (activeBatch.features || []).reduce((acc, f) => acc + (f.durationMs || 0), 0);
    if (sumMs > 0) return formatDuration(sumMs);
    if (activeBatch.status === "Đang chạy" && activeBatch.startedAt) {
      const ms = Math.max(0, Date.now() - new Date(activeBatch.startedAt).getTime());
      return formatDuration(ms);
    }
    return "0s";
  }, [activeBatch]);

  return (
    <div className="tab-content flex h-full">
      {/* ── LEFT: Danh sách Đợt chạy ── */}
      <aside className="w-80 shrink-0 border-r border-slate-700 bg-slate-950 flex flex-col">
        {/* Dropdown chọn dự án */}
        <div className="px-4 py-3 border-b border-slate-700">
          <ProjectSelectorDropdown
            projects={projects}
            activeProject={currentProject}
            onSelectProject={onSelectProject}
            onCreateProject={() => { setProjectToEdit(null); setProjectModalOpen(true); }}
            onEditProject={(p) => { setProjectToEdit(p); setProjectModalOpen(true); }}
            onDeleteProject={(p) => onDeleteProject(p.id)}
            onExportCurrentProject={() => onExportProject(currentProject)}
            onExportAllProjects={onExportAll}
          />
        </div>

        {/* Ô lọc đợt chạy và tính năng */}
        <div className="px-4 py-2.5 border-b border-slate-700">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700">
            <Search size={12} className="text-slate-400 shrink-0" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Lọc đợt chạy hoặc tính năng…"
              className="flex-1 bg-transparent text-xs text-white placeholder:text-slate-400 outline-none"
            />
          </div>
        </div>

        {/* Danh sách đợt chạy nhóm theo ngày */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
          {sortedBatches.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 italic">
              {searchQuery ? "Không tìm thấy đợt chạy phù hợp" : "Chưa có đợt chạy nào"}
            </div>
          ) : (
            dateGroups.map(({ label, items }) => (
              <div key={label} className="space-y-1">
                <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider font-mono">
                  {label}
                </div>
                {items.map((b) => {
                  const isSelected = activeBatch?.id === b.id;
                  const statusText = b.status === "Đang chạy" ? "Đang chạy" : "Đã kết thúc";

                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onSelectBatchId(b.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg transition-all flex flex-col gap-1 cursor-pointer select-none ${isSelected
                        ? "bg-indigo-600/25 border border-indigo-500/50 text-white shadow-xs"
                        : "hover:bg-slate-900 border border-transparent text-slate-300"
                        }`}
                    >
                      <div className="text-xs font-semibold text-white truncate" title={b.name}>
                        {b.name}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono truncate">
                        {formatSublineTime(b.startedAt)} · {statusText}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer sidebar */}
        <div className="h-10 shrink-0 px-4 border-t border-slate-700 text-xs text-slate-400 flex items-center justify-between font-mono">
          <span>Tổng: {filteredBatches.length} đợt chạy</span>
        </div>
      </aside>

      {/* ── RIGHT: Vùng chính kết quả đợt chạy ── */}
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-950">
        {!activeBatch ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <History size={36} className="text-slate-600 mb-3" />
            <h3 className="text-sm font-semibold text-white mb-1">Chưa chọn đợt chạy nào</h3>
            <p className="text-xs text-slate-400 max-w-sm">
              Chọn một đợt chạy từ danh sách bên trái hoặc chuyển sang tab "Trình chạy test" để tạo đợt chạy mới.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
            <div className="max-w-[950px] mx-auto w-full space-y-6">
              {/* Header đợt chạy */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    {(activeBatch.projectName || currentProject?.name) && (
                      <div className="text-[11px] font-mono text-indigo-400">
                        <span>{activeBatch.projectName || currentProject?.name}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="text-lg font-bold text-white truncate" title={activeBatch.name}>
                        {activeBatch.name}
                      </h2>

                      {/* Trạng thái: Chỉ có "Đang chạy" hoặc "Kết thúc" */}
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${activeBatch.status === "Đang chạy"
                          ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 animate-pulse"
                          : "bg-slate-800 text-slate-300 border border-slate-700"
                          }`}
                      >
                        {activeBatch.status === "Đang chạy" ? (
                          <>
                            <Loader2 size={13} className="animate-spin text-indigo-400" />
                            Đang chạy
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={13} className="text-slate-400" />
                            Đã kết thúc
                          </>
                        )}
                      </span>
                    </div>

                    {/* Thời điểm và thời lượng: hh:mm dd/mm/yy · 25.4s */}
                    <div className="text-xs text-slate-400 font-mono pt-0.5">
                      <span>{formatBatchDateTime(activeBatch.startedAt)} · {batchDuration}</span>
                    </div>

                    {/* Số liệu đợt chạy: ✔ pass · ✖ fail */}
                    <div className="flex items-center gap-3 text-xs font-mono pt-1 flex-wrap">
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        ✔ {metrics.pass} pass
                      </span>
                      <span>•</span>
                      <span className="text-rose-400 font-semibold flex items-center gap-1">
                        ✖ {metrics.fail} fail
                      </span>
                    </div>
                  </div>

                  {/* Nút hành động */}
                  <div className="flex items-center gap-2 shrink-0">
                    {activeBatch.status === "Đang chạy" && onAbortBatchRun && (
                      <button
                        type="button"
                        onClick={onAbortBatchRun}
                        className="px-3 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                        title="Dừng đợt chạy này"
                      >
                        <X size={13} /> Hủy đợt chạy
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDownloadHtmlReport(activeBatch)}
                      disabled={downloadingReportId === activeBatch.id}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/40 text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm disabled:opacity-50"
                      title="Tải báo cáo HTML độc lập kèm toàn bộ ảnh và kết quả kiểm thử"
                    >
                      {downloadingReportId === activeBatch.id ? (
                        <Loader2 size={13} className="animate-spin text-white" />
                      ) : (
                        <Download size={13} />
                      )}
                      <span>Tải báo cáo HTML</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeleteConfirmBatch(activeBatch)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 border border-transparent hover:border-rose-900/50 transition-colors cursor-pointer"
                      title="Xóa đợt chạy này"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Ghi chú tùy chọn */}
                {activeBatch.notes && (
                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-slate-300 leading-relaxed font-sans">
                    <span className="text-slate-400 font-semibold block mb-0.5">Ghi chú:</span>
                    {activeBatch.notes}
                  </div>
                )}
              </div>

              {/* Danh sách tính năng trong đợt chạy (FAILED và ERROR lên đầu) */}
              <div className="space-y-3">
                <div className="text-xs text-white font-semibold flex items-center justify-between">
                  <span>Danh sách tính năng ({sortedFeaturesInBatch.length})</span>
                </div>

                <div className="space-y-2.5">
                  {sortedFeaturesInBatch.map((feat) => {
                    const isExpanded = !!expandedFeatures[feat.id];
                    const isPassed = feat.status === "PASSED";
                    const isFailed = feat.status === "FAILED";
                    const isError = feat.status === "ERROR";
                    const isSkipped = feat.status === "SKIPPED";
                    const isRunning = feat.status === "RUNNING";

                    const stepCount = (feat.steps || []).length;
                    const stepResults = feat.stepResults || [];

                    return (
                      <div
                        key={feat.id}
                        className="border border-slate-800 rounded-xl bg-slate-900/60 overflow-hidden shadow-xs transition-all hover:border-slate-700/80"
                      >
                        {/* Hàng tính năng - Click để mở rộng/thu gọn */}
                        <button
                          type="button"
                          onClick={() => toggleFeatureExpand(feat.id)}
                          className="w-full flex items-center justify-between px-4 py-3 bg-slate-900/80 hover:bg-slate-800/80 transition-colors text-left cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-slate-400 shrink-0">
                              {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </span>

                            {/* Badge kết quả: PASSED / FAILED / ERROR / SKIPPED / Đang chạy */}
                            {isPassed && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 shrink-0">
                                <CheckCircle2 size={12} /> PASSED
                              </span>
                            )}
                            {isFailed && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1 shrink-0">
                                <AlertCircle size={12} /> FAILED
                              </span>
                            )}
                            {isError && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 shrink-0">
                                <AlertTriangle size={12} /> ERROR
                              </span>
                            )}
                            {isSkipped && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1 shrink-0">
                                <MinusCircle size={12} /> SKIPPED
                              </span>
                            )}
                            {isRunning && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 flex items-center gap-1 shrink-0">
                                <Loader2 size={12} className="animate-spin" /> Đang chạy
                              </span>
                            )}
                            {!isPassed && !isFailed && !isError && !isSkipped && !isRunning && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-900 text-slate-500 border border-slate-800 shrink-0">
                                Chờ chạy
                              </span>
                            )}

                            <span className="font-semibold text-white truncate text-xs">
                              {feat.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-xs text-slate-400 font-mono shrink-0 ml-3">
                            <span>{formatDuration(feat.durationMs)}</span>
                            <span>•</span>
                            <span>{stepCount} bước</span>
                          </div>
                        </button>

                        {/* Chi tiết từng bước và kết quả khi mở rộng */}
                        {isExpanded && (
                          <div className="border-t border-slate-800/80 p-4 space-y-3 bg-slate-950/50">
                            {/* Nội dung kịch bản gốc của tính năng */}
                            {((Array.isArray(feat.steps) && feat.steps.length > 0) || feat.description) && (
                              <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-xs space-y-1.5">
                                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-sans">
                                  Kịch bản kiểm thử:
                                </div>
                                <div className="space-y-1 font-mono text-slate-200 text-xs leading-relaxed">
                                  {(Array.isArray(feat.steps) && feat.steps.length > 0 ? feat.steps : [feat.description]).map((line, idx, arr) => (
                                    <div key={idx} className="flex items-start gap-2">
                                      {arr.length > 1 && (
                                        <span className="text-slate-500 select-none shrink-0 text-[11px]">
                                          {idx + 1}.
                                        </span>
                                      )}
                                      <span className="whitespace-pre-wrap break-words">{line}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Thông báo lỗi tính năng nếu có */}
                            {feat.error && (
                              <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-900/50 text-rose-300 text-xs font-mono leading-relaxed">
                                <span className="font-bold block mb-1">Thông báo lỗi:</span>
                                {feat.error}
                              </div>
                            )}

                            {/* Danh sách các bước */}
                            {stepResults.length > 0 ? (
                              <div className="space-y-3">
                                {stepResults.map((st, stepIdx) => {
                                  const stepPass = st.status === "passed";
                                  const screenshots = Array.isArray(st.screenshots) && st.screenshots.length > 0
                                    ? st.screenshots
                                    : (st.screenshotUrl ? [{ url: st.screenshotUrl, type: "after", label: "Ảnh chụp màn hình" }] : []);

                                  return (
                                    <div
                                      key={stepIdx}
                                      className={`p-3 rounded-lg border text-xs space-y-2 ${stepPass
                                        ? "bg-slate-900/60 border-slate-800"
                                        : "bg-rose-950/20 border-rose-900/40"
                                        }`}
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-2 min-w-0">
                                          <span className="text-slate-400 font-mono font-bold shrink-0">
                                            #{stepIdx + 1}
                                          </span>
                                          <span className="text-slate-200 font-mono break-words leading-relaxed">
                                            {st.text}
                                          </span>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                          {st.failureType && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                              {st.failureType}
                                            </span>
                                          )}
                                          <span
                                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 font-mono ${stepPass
                                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                              : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                              }`}
                                          >
                                            {stepPass ? "PASS" : "FAIL"}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Chi tiết lỗi của bước & cảnh báo */}
                                      {st.error && (
                                        <div className="p-2 rounded bg-rose-950/40 border border-rose-900/60 text-rose-300 font-mono text-[11px] leading-relaxed space-y-1">
                                          <div>{st.error}</div>
                                          {st.detectedAlert && (
                                            <div className="pt-1 border-t border-rose-900/50 text-[10px] text-amber-300 flex items-center gap-1">
                                              <span>⚠️ Cảnh báo trên trang:</span>
                                              <span className="font-semibold">{st.detectedAlert}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* Bằng chứng ảnh chụp màn hình */}
                                      {screenshots.length > 0 && (
                                        <div className="pt-2 border-t border-slate-800/80">
                                          <div className="flex items-center gap-1.5 mb-2 text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
                                            <Camera size={12} className="text-indigo-400" />
                                            <span>Bằng chứng trực quan ({screenshots.length})</span>
                                          </div>

                                          <div className="flex flex-wrap items-center gap-3">
                                            {screenshots.map((shot, shotIdx) => {
                                              const isBefore = shot.type === "before";
                                              const isErrorShot = shot.type === "error";

                                              return (
                                                <button
                                                  key={shotIdx}
                                                  type="button"
                                                  onClick={() => handleOpenLightbox(shot.url)}
                                                  className={`group relative flex flex-col overflow-hidden rounded-lg border transition-all text-left focus:outline-none cursor-zoom-in ${isBefore
                                                    ? "border-indigo-500/40 hover:border-indigo-400 bg-indigo-950/20"
                                                    : isErrorShot
                                                      ? "border-rose-500/50 hover:border-rose-400 bg-rose-950/20"
                                                      : "border-emerald-500/40 hover:border-emerald-400 bg-emerald-950/20"
                                                    }`}
                                                  title={`Bấm để phóng to: ${shot.label || "Ảnh chụp"}`}
                                                >
                                                  <div className="px-2 py-1 flex items-center justify-between gap-2 border-b border-inherit bg-slate-950/70 w-[180px]">
                                                    <span
                                                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${isBefore
                                                        ? "bg-indigo-500/20 text-indigo-300"
                                                        : isErrorShot
                                                          ? "bg-rose-500/20 text-rose-300"
                                                          : "bg-emerald-500/20 text-emerald-300"
                                                        }`}
                                                    >
                                                      {isBefore ? "Trước" : isErrorShot ? "Lỗi" : "Sau"}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 truncate text-right">
                                                      {shot.label || "Ảnh"}
                                                    </span>
                                                  </div>

                                                  <div className="relative overflow-hidden w-[180px] bg-slate-950">
                                                    <img
                                                      src={shot.url}
                                                      alt={shot.label || `Ảnh ${shotIdx + 1}`}
                                                      loading="lazy"
                                                      className="w-full h-auto object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                                                    />
                                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                                      <span className="p-1 rounded-full bg-slate-900/85 text-white shadow-md">
                                                        <Maximize2 size={13} />
                                                      </span>
                                                    </div>
                                                  </div>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              // Khi chưa có stepResults, hiển thị danh sách các bước từ snapshot
                              <div className="space-y-1.5">
                                {(feat.steps || []).map((stepText, sIdx) => (
                                  <div
                                    key={sIdx}
                                    className="flex items-start gap-2.5 px-3 py-1.5 rounded bg-slate-900/40 text-xs font-mono text-slate-300"
                                  >
                                    <span className="text-slate-500 w-5 shrink-0 text-right">
                                      {sIdx + 1}
                                    </span>
                                    <span className="break-words flex-1">{stepText}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <ScreenshotLightbox
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        items={allLightboxShots}
        initialIndex={lightboxIndex}
      />

      <ConfirmModal
        isOpen={Boolean(deleteConfirmBatch)}
        onClose={() => setDeleteConfirmBatch(null)}
        onConfirm={() => {
          if (deleteConfirmBatch && onDeleteBatch) {
            onDeleteBatch(deleteConfirmBatch.id);
          }
          setDeleteConfirmBatch(null);
        }}
        title="Xóa đợt chạy"
        message="Bạn có chắc chắn muốn xóa đợt chạy này khỏi lịch sử kiểm thử?"
        itemName={deleteConfirmBatch?.name}
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

// ═══════════════════════════════════════════════════════════════════
// GỐC ỨNG DỤNG
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [projects, setProjects] = useState(loadProjects);
  const [activeProjectId, setActiveProjectId] = useState(() => {
    const loaded = loadProjects();
    return loaded[0]?.id || "";
  });
  const [history, setHistory] = useState(loadHistory);
  const [activeTab, setActiveTab] = useState("library"); // "library" | "runner" | "history"
  const [runningBatchId, setRunningBatchId] = useState(null);
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const abortControllerRef = useRef(null);
  const [serverStatus, setServerStatus] = useState("checking"); // "online" | "busy" | "llm_offline" | "offline"
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [currentModel, setCurrentModel] = useState("qwen/qwen3.8-27b");

  useEffect(() => {
    let mounted = true;
    const checkHealth = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
        if (!mounted) return;
        if (res.ok) {
          const data = await res.json();
          if (data.runner?.isBusy) {
            setServerStatus("busy");
          } else if (data.llm?.status === "offline") {
            setServerStatus("llm_offline");
          } else {
            setServerStatus("online");
          }
          if (data.llm?.model) {
            setCurrentModel(data.llm.model);
          }
        } else {
          setServerStatus("offline");
        }
      } catch {
        if (mounted) setServerStatus("offline");
      }
    };

    // Đọc model ban đầu từ config
    fetch(`${API_BASE_URL}/config/model`)
      .then((res) => res.json())
      .then((data) => {
        if (mounted && data.success && data.model) {
          setCurrentModel(data.model);
        }
      })
      .catch(() => {});

    checkHealth();
    const interval = setInterval(checkHealth, 8000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  // Tải lịch sử đầy đủ từ máy chủ backend
  const fetchBackendHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/history`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.runs) && data.runs.length > 0) {
          setHistory((prev) => {
            const backendMap = new Map(data.runs.map((r) => [r.id, r]));
            const merged = prev.map((item) => {
              if (item.status === "Đang chạy") return item;
              return backendMap.get(item.id) || item;
            });
            for (const r of data.runs) {
              if (!merged.some((m) => m.id === r.id)) {
                merged.push(r);
              }
            }
            saveHistory(merged);
            return merged;
          });
        }
      }
    } catch (err) {
      console.warn("Không thể tải lịch sử từ máy chủ backend:", err.message);
    }
  }, []);

  useEffect(() => {
    fetchBackendHistory();
  }, [fetchBackendHistory]);

  useEffect(() => {
    if (activeTab === "history" && !runningBatchId) {
      fetchBackendHistory();
    }
  }, [activeTab, runningBatchId, fetchBackendHistory]);

  useEffect(() => {
    if (projects.length > 0 && !projects.some((p) => p.id === activeProjectId)) {
      setActiveProjectId(projects[0].id);
    }
  }, [projects, activeProjectId]);

  const upsertProject = (project) => {
    setProjects((prev) => {
      const idx = prev.findIndex((p) => p.id === project.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...project };
        return next;
      }
      return [project, ...prev];
    });
    setActiveProjectId(project.id);
  };

  const deleteProject = (projectId) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setHistory((prev) => prev.filter((r) => r.projectId !== projectId));
  };

  const upsertFeature = (projectId, feat) => {
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
  };

  const reorderFeature = (projectId, featId, targetOrder1Based) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        const features = [...(p.features || [])];
        const oldIndex = features.findIndex((f) => f.id === featId);
        const targetIndex = targetOrder1Based - 1;
        if (
          oldIndex < 0 ||
          targetIndex < 0 ||
          targetIndex >= features.length ||
          oldIndex === targetIndex
        ) {
          return p;
        }
        const [moved] = features.splice(oldIndex, 1);
        features.splice(targetIndex, 0, moved);
        return { ...p, features };
      })
    );
  };

  const duplicateFeature = (projectId, feat) => {
    const copy = {
      ...feat,
      id: genId("feat"),
      name: `${feat.name} (Bản sao)`,
    };
    upsertFeature(projectId, copy);
  };

  const importFeatures = (projectId, newFeats) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        const map = new Map((p.features || []).map((f) => [f.id, f]));
        newFeats.forEach((f) => map.set(f.id, f));
        return { ...p, features: Array.from(map.values()) };
      })
    );
  };

  const deleteFeature = (projectId, featureId) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return { ...p, features: (p.features || []).filter((f) => f.id !== featureId) };
      })
    );
    setHistory((prev) => prev.filter((r) => r.featureId !== featureId));
  };

  const startBatchRun = async ({ name, notes, features, projectId, projectName }) => {
    const batchId = genId("batch");
    const startedAt = new Date().toISOString();

    // Snapshot bản sao các bước
    const initialFeatures = features.map((f) => ({
      id: f.id,
      name: f.name,
      steps: [...(f.steps || [])],
      stepResults: [],
      status: "PENDING",
      durationMs: 0,
      error: null,
    }));

    const initialBatch = {
      id: batchId,
      projectId: projectId || activeProjectId,
      projectName: projectName || projects.find((p) => p.id === activeProjectId)?.name || "Dự án",
      name,
      notes: notes || "",
      startedAt,
      finishedAt: null,
      status: "Đang chạy",
      features: initialFeatures,
    };

    setHistory((prev) => [initialBatch, ...prev]);
    setSelectedBatchId(batchId);
    setRunningBatchId(batchId);
    setActiveTab("history");

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let currentBatch = { ...initialBatch };

    for (let i = 0; i < features.length; i++) {
      if (abortController.signal.aborted) {
        currentBatch = {
          ...currentBatch,
          features: currentBatch.features.map((f, idx) =>
            idx >= i && (f.status === "PENDING" || f.status === "RUNNING") ? { ...f, status: "SKIPPED" } : f
          ),
        };
        break;
      }

      const feat = features[i];
      const featStartTime = Date.now();

      currentBatch = {
        ...currentBatch,
        features: currentBatch.features.map((f, idx) =>
          idx === i ? { ...f, status: "RUNNING" } : f
        ),
      };
      setHistory((prev) => prev.map((b) => (b.id === batchId ? currentBatch : b)));

      const description = (feat.steps && feat.steps.length > 0)
        ? feat.steps.join(", ")
        : feat.name;

      try {
        const res = await fetch(`${API_BASE_URL}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description,
            projectId: currentBatch.projectId,
            projectName: currentBatch.projectName,
            featureId: feat.id,
            featureName: feat.name,
          }),
          signal: abortController.signal,
        });

        const data = await res.json();
        const featDuration = Date.now() - featStartTime;

        if (!res.ok) {
          const errMsg = data.error || `Lỗi máy chủ (${res.status})`;
          currentBatch = {
            ...currentBatch,
            features: currentBatch.features.map((f, idx) =>
              idx === i
                ? {
                  ...f,
                  status: "ERROR",
                  durationMs: featDuration,
                  error: errMsg,
                  stepResults: (f.steps || []).map((s, sIdx) => ({
                    text: s,
                    status: "failed",
                    error: sIdx === 0 ? errMsg : undefined,
                  })),
                }
                : f
            ),
          };
        } else {
          const isPassed = data.status === "passed";
          let formattedSteps = [];
          if (Array.isArray(data.steps) && data.steps.length > 0) {
            formattedSteps = data.steps.map((st) => ({
              text: st.text,
              status: st.status === "passed" ? "passed" : "failed",
              failureType: st.failureType,
              detectedAlert: st.detectedAlert,
              error: st.status !== "passed" ? st.message : undefined,
              screenshotUrl: st.screenshotUrl
                ? (st.screenshotUrl.startsWith("http") ? st.screenshotUrl : `${API_BASE_URL}${st.screenshotUrl}`)
                : undefined,
              screenshots: Array.isArray(st.screenshots)
                ? st.screenshots.map((s) => ({
                  ...s,
                  url: s.url.startsWith("http") ? s.url : `${API_BASE_URL}${s.url}`,
                }))
                : (st.screenshotUrl ? [{ url: st.screenshotUrl.startsWith("http") ? st.screenshotUrl : `${API_BASE_URL}${st.screenshotUrl}`, type: "after", label: "Ảnh chụp màn hình" }] : []),
            }));
          } else {
            formattedSteps = (feat.steps || []).map((s) => ({
              text: s,
              status: isPassed ? "passed" : "failed",
              error: !isPassed ? (data.error || "Không thành công") : undefined,
            }));
          }

          currentBatch = {
            ...currentBatch,
            features: currentBatch.features.map((f, idx) =>
              idx === i
                ? {
                  ...f,
                  status: isPassed ? "PASSED" : "FAILED",
                  durationMs: featDuration,
                  stepResults: formattedSteps,
                  error: isPassed ? null : (data.error || "Không thành công"),
                }
                : f
            ),
          };
        }
      } catch (err) {
        const featDuration = Date.now() - featStartTime;
        if (err.name === "AbortError" || abortController.signal.aborted) {
          currentBatch = {
            ...currentBatch,
            features: currentBatch.features.map((f, idx) => {
              if (idx === i) {
                return { ...f, status: "SKIPPED", durationMs: featDuration, error: "Đã hủy" };
              }
              if (idx > i && f.status === "PENDING") {
                return { ...f, status: "SKIPPED" };
              }
              return f;
            }),
          };
          break;
        } else {
          currentBatch = {
            ...currentBatch,
            features: currentBatch.features.map((f, idx) =>
              idx === i
                ? {
                  ...f,
                  status: "ERROR",
                  durationMs: featDuration,
                  error: err.message,
                  stepResults: (f.steps || []).map((s, sIdx) => ({
                    text: s,
                    status: "failed",
                    error: sIdx === 0 ? err.message : undefined,
                  })),
                }
                : f
            ),
          };
        }
      }

      setHistory((prev) => prev.map((b) => (b.id === batchId ? currentBatch : b)));
    }

    const finishedAt = new Date().toISOString();
    currentBatch = {
      ...currentBatch,
      status: "Kết thúc",
      finishedAt,
      features: currentBatch.features.map((f) =>
        f.status === "PENDING" || f.status === "RUNNING" ? { ...f, status: "SKIPPED" } : f
      ),
    };

    setHistory((prev) => {
      const updated = prev.map((b) => (b.id === batchId ? currentBatch : b));
      saveHistory(updated);
      return updated;
    });
    setRunningBatchId(null);
    abortControllerRef.current = null;

    try {
      await fetch(`${API_BASE_URL}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentBatch),
      });
    } catch (err) {
      console.warn("Lỗi lưu đợt chạy lên backend:", err.message);
    }
  };

  const abortBatchRun = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const deleteBatch = async (batchId) => {
    setHistory((prev) => prev.filter((b) => b.id !== batchId));
    if (selectedBatchId === batchId) {
      setSelectedBatchId(null);
    }
    try {
      await fetch(`${API_BASE_URL}/history/${encodeURIComponent(batchId)}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.warn("Không thể xóa đợt chạy trên server:", err.message);
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
    <div className="min-h-screen bg-slate-950 flex flex-col text-slate-100 font-sans selection:bg-indigo-500/30 selection:text-indigo-200 w-full">
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
              <span className="text-slate-300 font-mono text-[10px]">
                {serverStatus === "online"
                  ? "Sẵn sàng"
                  : serverStatus === "busy"
                    ? "Đang chạy"
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
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-indigo-500/40 hover:border-indigo-400 text-[11px] font-medium transition-all cursor-pointer select-none group shadow-xs"
              title={`Cài đặt (.env) - Model: ${currentModel}`}
            >
              <Cpu size={13} className="text-indigo-400 group-hover:scale-110 transition-transform" />
              <span className="font-mono text-[11px] text-indigo-300 truncate max-w-[130px]">
                {currentModel.split("/").pop()}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setHelpModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 text-[11px] font-medium transition-colors cursor-pointer select-none"
              title="Hướng dẫn sử dụng hệ thống"
            >
              <span className="text-amber-400">💡</span>
              <span>Hướng dẫn</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── NỘI DUNG CHÍNH ── */}
      <div className="flex-1 overflow-hidden w-full">
        {activeTab === "library" && (
          <div className="h-full w-full" style={{ height: "calc(100vh - 53px)" }}>
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
            />
          </div>
        )}
        {activeTab === "runner" && (
          <div className="h-full w-full" style={{ height: "calc(100vh - 53px)" }}>
            <RunnerTab
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={setActiveProjectId}
              onUpsertProject={upsertProject}
              onDeleteProject={deleteProject}
              onExportProject={(p) => exportJSON(p, `${p.name.replace(/\s+/g, "_")}.json`)}
              onExportAll={() => exportJSON({ projects, history }, "autotest_all_projects.json")}
              history={history}
              onStartBatchRun={startBatchRun}
              runningBatchId={runningBatchId}
              onNavigateToHistory={() => setActiveTab("history")}
            />
          </div>
        )}
        {activeTab === "history" && (
          <div className="h-full w-full" style={{ height: "calc(100vh - 53px)" }}>
            <HistoryTab
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={setActiveProjectId}
              onUpsertProject={upsertProject}
              onDeleteProject={deleteProject}
              onExportProject={(p) => exportJSON(p, `${p.name.replace(/\s+/g, "_")}.json`)}
              onExportAll={() => exportJSON({ projects, history }, "autotest_all_projects.json")}
              history={history}
              selectedBatchId={selectedBatchId}
              onSelectBatchId={setSelectedBatchId}
              onDeleteBatch={deleteBatch}
              onAbortBatchRun={abortBatchRun}
              runningBatchId={runningBatchId}
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

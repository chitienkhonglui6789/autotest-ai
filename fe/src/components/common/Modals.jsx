import React, { useState, useEffect, useCallback, useRef } from "react";
import { Check, X, ChevronLeft, ChevronRight } from "lucide-react";
import { resolveAssetUrl } from "../../api/client.js";

export function DarkCheckbox({ checked, onChange, ariaLabel, disabled = false }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={disabled ? undefined : onChange}
      className={`w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center border transition-colors ${
        disabled ? "opacity-40 cursor-not-allowed" : ""
      } ${
        checked
          ? "bg-indigo-600 border-indigo-400 text-white"
          : "bg-slate-900 border-slate-500 hover:border-slate-300"
      }`}
    >
      {checked && <Check size={10} strokeWidth={3} />}
    </button>
  );
}

export function ConfirmModal({ isOpen, onClose, onConfirm, title, message, itemName }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onCloseRef.current?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-sm shadow-2xl p-5 space-y-3"
      >
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

export function ScreenshotLightbox({ isOpen, onClose, items = [], initialIndex = 0 }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
        onCloseRef.current?.();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      } else if (e.key === "ArrowRight") {
        handleNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handlePrev, handleNext]);

  if (!isOpen || !currentItem) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 sm:p-6 select-none"
      onClick={onClose}
    >
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

      <div
        className="flex flex-col items-center max-w-[92vw] max-h-[92vh] space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative rounded-lg overflow-hidden border border-slate-700/80 bg-slate-950 shadow-2xl flex items-center justify-center max-h-[80vh]">
          <img
            src={resolveAssetUrl(currentItem.url || currentItem.screenshotUrl)}
            alt={currentItem.label || `Ảnh ${currentIndex + 1}`}
            className="max-w-[90vw] max-h-[78vh] w-auto h-auto object-contain select-none"
          />
        </div>

        <div className="text-center px-4 py-2 rounded-xl bg-slate-900/95 border border-slate-700/80 text-xs text-slate-200 font-sans shadow-xl max-w-2xl flex flex-col gap-1 items-center">
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <span className="font-semibold text-indigo-400">
              Bước {currentItem.stepIndex || currentIndex + 1}
            </span>

            {currentItem.label && (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                  currentItem.type === "before"
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


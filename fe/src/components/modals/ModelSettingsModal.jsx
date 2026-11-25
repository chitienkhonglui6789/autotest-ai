import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Settings,
  X,
  Loader2,
  Eye,
  EyeOff,
  Check,
  AlertTriangle,
  AlertCircle,
  Save,
  PlugZap,
  Sparkles,
  Monitor,
} from "lucide-react";
import { apiClient } from "../../api/client.js";

const LLM_PRESETS = [
  {
    id: "ollama_qwen",
    label: "Ollama · Qwen 3.8-27B (Local)",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3.8-27b",
    apiKey: "ollama",
    provider: "openai-compatible",
  },
  {
    id: "lmstudio_qwen",
    label: "LM Studio · Local Model",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "qwen/qwen3.8-27b",
    apiKey: "lm-studio",
    provider: "openai-compatible",
  },
  {
    id: "gemini_openai",
    label: "Google Gemini (OpenAI API)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-flash-lite-latest",
    provider: "openai-compatible",
  },
];

export function ModelSettingsModal({ isOpen, onClose, currentModel, onModelUpdated }) {
  const [envVars, setEnvVars] = useState([]);
  const [initialVars, setInitialVars] = useState({});
  const [showSecrets, setShowSecrets] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: "", text: "" });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const currentModelRef = useRef(currentModel);
  currentModelRef.current = currentModel;
  const closeTimerRef = useRef(null);

  const isSecretKey = (key) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key);

  const toggleSecret = (key) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (!isOpen) {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      return;
    }

    let mounted = true;
    setIsLoading(true);
    setStatusMsg({ type: "", text: "" });

    apiClient.getEnvConfig()
      .then((data) => {
        if (!mounted) return;
        if (data.success && Array.isArray(data.variables)) {
          // Ẩn các biến STAGEHAND_* cũ nếu còn sót lại trong .env để giao diện sạch sẽ
          const filtered = data.variables.filter((v) => !/^STAGEHAND_/i.test(v.key));
          setEnvVars(filtered);
          const initialMap = {};
          filtered.forEach((v) => {
            initialMap[v.key] = v.value;
          });
          setInitialVars(initialMap);
        } else {
          setEnvVars([{ key: "LLM_MODEL", value: currentModelRef.current || "qwen3.8-27b" }]);
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setStatusMsg({ type: "error", text: `Không thể đọc file .env: ${err.message}` });
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onCloseRef.current?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  const varMap = useMemo(() => {
    const map = {};
    for (const item of envVars) map[item.key] = item.value;
    return map;
  }, [envVars]);

  if (!isOpen) return null;

  const upsertVarValue = (key, newValue) => {
    const sanitized = String(newValue ?? "").replace(/[\r\n]+/g, "");
    setEnvVars((prev) => {
      const exists = prev.some((item) => item.key === key);
      if (!exists) return [...prev, { key, value: sanitized }];
      return prev.map((item) => (item.key === key ? { ...item, value: sanitized } : item));
    });
  };

  const applyPreset = (preset) => {
    upsertVarValue("LLM_PROVIDER", preset.provider);
    upsertVarValue("LLM_BASE_URL", preset.baseUrl);
    upsertVarValue("LLM_MODEL", preset.model);
    if (preset.apiKey !== undefined) {
      upsertVarValue("LLM_API_KEY", preset.apiKey);
    }
    setStatusMsg({
      type: "info",
      text: `Đã nạp mẫu "${preset.label}". Bạn có thể bấm "Kiểm tra kết nối" hoặc "Lưu".`,
    });
  };

  const handleTestLlm = async () => {
    setIsTestingLlm(true);
    setStatusMsg({ type: "info", text: "Đang gửi tín hiệu kiểm tra kết nối tới LLM..." });
    try {
      const res = await apiClient.testLlmConnection({
        baseUrl: varMap.LLM_BASE_URL || "",
        model: varMap.LLM_MODEL || "",
        apiKey: varMap.LLM_API_KEY || "",
      });
      if (res.success) {
        setStatusMsg({
          type: "success",
          text: `${res.message} · Model: ${res.model}`,
        });
      } else {
        setStatusMsg({
          type: "error",
          text: res.message || "Không thể kết nối tới LLM.",
        });
      }
    } catch (err) {
      setStatusMsg({
        type: "error",
        text: `Lỗi khi kiểm tra LLM: ${err.message}`,
      });
    } finally {
      setIsTestingLlm(false);
    }
  };

  const handleSave = async (e) => {
    e?.preventDefault();

    const modifiedVars = envVars.filter((item) => initialVars[item.key] !== item.value);

    if (modifiedVars.length === 0) {
      setStatusMsg({ type: "info", text: "Không có biến nào bị thay đổi." });
      return;
    }

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
      const data = await apiClient.saveEnvConfig({ variables: modifiedVars });

      if (data.success) {
        const nextInitial = { ...initialVars };
        modifiedVars.forEach((v) => {
          nextInitial[v.key] = v.value;
        });
        setInitialVars(nextInitial);

        const updatedModelVar = modifiedVars.find((v) => v.key === "LLM_MODEL");
        if (updatedModelVar && onModelUpdated) {
          onModelUpdated(updatedModelVar.value);
        }

        if (data.requireRestart) {
          setStatusMsg({
            type: "warning",
            text: "Đã lưu! Riêng thay đổi PORT/HOST cần khởi động lại Server để áp dụng.",
          });
        } else {
          setStatusMsg({
            type: "success",
            text: "Đã lưu cấu hình và áp dụng ngay lập tức!",
          });
          if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
          closeTimerRef.current = setTimeout(() => {
            closeTimerRef.current = null;
            onCloseRef.current?.();
          }, 1100);
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

  const isHeadless = String(varMap.HEADLESS || "false").trim().toLowerCase() === "true";

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
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
              <Settings size={17} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">Cấu hình Engine AI & Biến môi trường (.env)</h3>
              <p className="text-[11px] text-slate-400">
                Thiết lập Local LLM (Qwen 3.8-27B / Ollama / LM Studio) hoặc Cloud API · Áp dụng tức thì
              </p>
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

        <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
          <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
            {!isLoading && (
              <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-[11px] font-semibold text-indigo-300 flex items-center gap-1.5">
                    <Sparkles size={13} /> Chọn nhanh cấu hình AI (Presets)
                  </span>

                  <button
                    type="button"
                    onClick={() => upsertVarValue("HEADLESS", isHeadless ? "false" : "true")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
                      !isHeadless
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                        : "bg-slate-800 border-slate-700 text-slate-300"
                    }`}
                    title="Chuyển đổi giữa chế độ mở cửa sổ trình duyệt để quan sát trực tiếp và chạy ẩn"
                  >
                    <Monitor size={12} />
                    <span>{!isHeadless ? "Trình duyệt: Hiện trực tiếp" : "Trình duyệt: Chạy ẩn (Headless)"}</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {LLM_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-indigo-950/60 border border-slate-700 hover:border-indigo-500/50 text-slate-200 hover:text-indigo-200 text-[11px] font-medium transition-colors cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
              <div className="space-y-2">
                {envVars.map((item) => {
                  const isSecret = isSecretKey(item.key);
                  const isVisible = showSecrets[item.key];
                  const isModified = initialVars[item.key] !== item.value;

                  return (
                    <div
                      key={item.key}
                      className={`flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 p-2.5 rounded-lg border transition-colors ${
                        isModified
                          ? "bg-indigo-950/20 border-indigo-500/40"
                          : "bg-slate-950/60 border-slate-800/80"
                      }`}
                    >
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

                      <div className="flex-1 relative flex items-center">
                        <input
                          type={isSecret ? (isVisible ? "text" : "password") : "text"}
                          value={item.value}
                          onChange={(e) => upsertVarValue(item.key, e.target.value)}
                          disabled={isLoading || isSaving}
                          className={`w-full px-3 py-1.5 bg-slate-900 border rounded-md text-white font-mono text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors ${
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
                })}
              </div>
            )}
          </div>

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

          <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={handleTestLlm}
              disabled={isLoading || isTestingLlm || isSaving}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              title="Thử gửi một yêu cầu nhỏ để kiểm tra kết nối và tốc độ phản hồi của LLM"
            >
              {isTestingLlm ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Đang kiểm tra…</span>
                </>
              ) : (
                <>
                  <PlugZap size={13} />
                  <span>Kiểm tra kết nối AI</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={isSaving || isLoading}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-md shadow-indigo-900/30"
              >
                {isSaving ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Đang lưu…</span>
                  </>
                ) : (
                  <>
                    <Save size={13} />
                    <span>Lưu cấu hình</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ServiceUnavailableError } from "../errors/AppError.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const envFilePath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: envFilePath });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

const parseBoolean = (val, defaultValue = false) => {
  if (val === undefined || val === null) return defaultValue;
  return val.trim().toLowerCase() === "true";
};

const parseNumber = (val, defaultValue) => {
  const parsed = Number(val);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
};

export const config = Object.freeze({
  server: Object.freeze({
    get port() {
      return parseNumber(process.env.PORT, 3000);
    },
    get host() {
      return process.env.HOST || "0.0.0.0";
    },
  }),
  browser: Object.freeze({
    get headless() {
      return parseBoolean(process.env.HEADLESS, false);
    },
  }),
  timeouts: Object.freeze({
    get stepMs() {
      return parseNumber(process.env.STEP_TIMEOUT_MS, 60_000);
    },
    get runMs() {
      return parseNumber(process.env.RUN_TIMEOUT_MS, 5 * 60_000);
    },
    get llmMs() {
      return parseNumber(process.env.LLM_TIMEOUT_MS, 300_000);
    },
    get gotoMs() {
      return parseNumber(process.env.GOTO_TIMEOUT_MS, 60_000);
    },
    get observeTimeoutMs() {
      return parseNumber(process.env.OBSERVE_TIMEOUT_MS, 15_000);
    },
    get retryIntervalMs() {
      return parseNumber(process.env.RETRY_INTERVAL_MS, 1_500);
    },
    get postActWaitMs() {
      return parseNumber(process.env.POST_ACT_WAIT_MS, 1_200);
    },
  }),
  limits: Object.freeze({
    get maxSteps() {
      return parseNumber(process.env.MAX_STEPS, 30);
    },
    maxDescriptionLength: 10000,
    get bodyLimit() {
      return process.env.BODY_LIMIT || "10mb";
    },
  }),
  llm: {
    get provider() {
      return (process.env.LLM_PROVIDER || "openai-compatible").trim().toLowerCase();
    },
    get baseUrl() {
      return (process.env.LLM_BASE_URL || "http://127.0.0.1:11434/v1").trim().replace(/\/+$/, "");
    },
    get model() {
      return process.env.LLM_MODEL?.trim() || "qwen3.8-27b";
    },
    get apiKey() {
      return (process.env.LLM_API_KEY || "").trim();
    },
    get maxTokens() {
      return parseNumber(process.env.LLM_MAX_TOKENS, 4096);
    },
  },
  screenshots: Object.freeze({
    get format() {
      const fmt = (process.env.SCREENSHOT_FORMAT || "jpeg").trim().toLowerCase();
      return fmt === "png" ? "png" : "jpeg";
    },
    get quality() {
      return parseNumber(process.env.SCREENSHOT_QUALITY, 80);
    },
    get fullPage() {
      return parseBoolean(process.env.SCREENSHOT_FULL_PAGE, false);
    },
    get retentionDays() {
      return parseNumber(process.env.SCREENSHOT_RETENTION_DAYS, 7);
    },
    get maxFolders() {
      return parseNumber(process.env.SCREENSHOT_MAX_FOLDERS, 100);
    },
  }),
  diagnostics: Object.freeze({
    get strictness() {
      const raw = (process.env.DIAGNOSTIC_STRICTNESS || "balanced").trim().toLowerCase();
      if (raw === "explicit" || raw === "strict") return raw;
      return "balanced";
    },
  }),
});

/**
 * Kiểm tra các biến môi trường bắt buộc trước khi xử lý nghiệp vụ
 */
export const assertConfigReady = () => {
  const errors = [];
  if (!config.llm.baseUrl) {
    errors.push("Thiếu LLM_BASE_URL (ví dụ: http://127.0.0.1:11434/v1)");
  } else {
    try {
      new URL(config.llm.baseUrl);
    } catch {
      errors.push(`LLM_BASE_URL không hợp lệ: "${config.llm.baseUrl}"`);
    }
  }

  if (!config.llm.model) {
    errors.push("Thiếu LLM_MODEL (ví dụ: qwen2.5-coder, gpt-4o, gemini-flash)");
  }

  if (errors.length > 0) {
    throw new ServiceUnavailableError(`Lỗi cấu hình hệ thống:\n- ${errors.join("\n- ")}`);
  }
};

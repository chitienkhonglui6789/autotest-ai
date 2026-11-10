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
    gotoMs: 60_000,
  }),
  limits: Object.freeze({
    get maxSteps() {
      return parseNumber(process.env.MAX_STEPS, 30);
    },
    maxDescriptionLength: 4000,
    bodyLimit: "1mb",
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
  },
  stagehand: Object.freeze({
    get modelName() {
      return (process.env.STAGEHAND_MODEL ?? "").trim();
    },
    get apiKey() {
      return (process.env.STAGEHAND_API_KEY || process.env.LLM_API_KEY || "").trim();
    },
  }),
});

/**
 * Kiểm tra các biến môi trường bắt buộc trước khi xử lý nghiệp vụ
 */
export const assertConfigReady = () => {
  if (!config.llm.baseUrl || !config.llm.model) {
    throw new ServiceUnavailableError("Thiếu LLM_BASE_URL hoặc LLM_MODEL trong .env");
  }
  if (config.stagehand.modelName && !config.stagehand.apiKey) {
    throw new ServiceUnavailableError("STAGEHAND_MODEL đã được khai báo nhưng thiếu API key tương ứng");
  }
};

import {
  readModelFromEnv,
  updateModelInEnv,
  readAllEnvVars,
  updateEnvVars,
  getEnvPath,
} from "../services/config.service.js";
import { llmService } from "../services/llm.service.js";
import { config } from "../config/env.js";

export class ConfigController {
  /**
   * GET /config/env - Đọc toàn bộ danh sách biến trong file .env
   */
  getEnv = async (req, res, next) => {
    try {
      const variables = readAllEnvVars();
      res.status(200).json({
        success: true,
        variables,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST/PUT /config/env - Cập nhật các biến vào file .env
   */
  updateEnv = async (req, res, next) => {
    try {
      const { variables } = req.body || {};
      if (!variables) {
        return res.status(400).json({
          success: false,
          error: "Dữ liệu cấu hình không hợp lệ",
        });
      }

      const result = updateEnvVars(variables);
      res.status(200).json({
        success: true,
        updatedKeys: result.updatedKeys,
        requireRestart: result.requireRestart,
        message: result.requireRestart
          ? "Cần khởi động lại để áp dụng"
          : "Đã lưu cấu hình thành công",
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err.message,
      });
    }
  };

  /**
   * GET /config/model - Đọc tên Model AI hiện tại từ file .env (Tương thích ngược)
   */
  getModel = async (req, res, next) => {
    try {
      const model = readModelFromEnv();
      res.status(200).json({
        success: true,
        model,
        envPath: getEnvPath(),
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST/PUT /config/model - Ghi đè tên Model AI vào file .env (Tương thích ngược)
   */
  updateModel = async (req, res, next) => {
    try {
      const { model } = req.body || {};
      if (!model || typeof model !== "string" || !model.trim()) {
        return res.status(400).json({
          success: false,
          error: "Tên Model không được để trống",
        });
      }

      const updatedModel = updateModelInEnv(model);

      res.status(200).json({
        success: true,
        model: updatedModel,
        message: `Đã cập nhật Model thành "${updatedModel}" trong file .env`,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /config/test-llm - Kiểm tra kết nối thực tế tới Local/Cloud LLM hiện hành (hoặc cấu hình thử)
   */
  testLlm = async (req, res) => {
    const startedAt = Date.now();
    const overrideBaseUrl = req.body?.baseUrl ? String(req.body.baseUrl).trim() : config.llm.baseUrl;
    const overrideModel = req.body?.model ? String(req.body.model).trim() : config.llm.model;
    const overrideApiKey = req.body?.apiKey !== undefined ? String(req.body.apiKey).trim() : config.llm.apiKey;

    try {
      const testClient = new llmService.constructor({
        ...config,
        llm: {
          ...config.llm,
          baseUrl: overrideBaseUrl.replace(/\/+$/, ""),
          model: overrideModel,
          apiKey: overrideApiKey,
        },
        timeouts: {
          ...config.timeouts,
          llmMs: 15000,
        },
      });

      const reply = await testClient.chatCompletion(
        [{ role: "user", content: "Trả lời duy nhất 1 từ: OK" }],
        AbortSignal.timeout(15000)
      );

      const latencyMs = Date.now() - startedAt;
      res.status(200).json({
        success: true,
        latencyMs,
        model: overrideModel,
        baseUrl: overrideBaseUrl,
        reply: String(reply || "").slice(0, 60),
        message: `Kết nối AI thành công (${latencyMs}ms)!`,
      });
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      res.status(200).json({
        success: false,
        latencyMs,
        model: overrideModel,
        baseUrl: overrideBaseUrl,
        message: `Kết nối thất bại: ${err.message}`,
      });
    }
  };
}

export const configController = new ConfigController();

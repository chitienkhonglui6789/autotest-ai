import {
  readModelFromEnv,
  updateModelInEnv,
  readAllEnvVars,
  updateEnvVars,
  getEnvPath,
} from "../services/config.service.js";

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
}

export const configController = new ConfigController();

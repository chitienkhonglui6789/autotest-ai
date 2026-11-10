import { AppError } from "../errors/AppError.js";
import { logger } from "../utils/logger.js";

/**
 * Middleware tập trung xử lý lỗi của toàn bộ ứng dụng
 */
export const errorHandler = (err, req, res, _next) => {
  // Lỗi parse JSON do express.json()
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "JSON không hợp lệ" });
  }

  // Lỗi payload quá lớn
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Body quá lớn" });
  }

  // Các lỗi domain có định danh (AppError)
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(`[${err.name}] ${err.message}`);
    } else {
      logger.warn(`[${err.name}] ${err.message}`);
    }
    return res.status(err.statusCode).json({ error: err.message });
  }

  // Lỗi không mong đợi (Unhandle exceptions)
  logger.error("Lỗi không kiểm soát được:", err);
  return res.status(500).json({
    error: "Lỗi hệ thống nội bộ, vui lòng thử lại sau",
  });
};


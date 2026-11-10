import app from "./app.js";
import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { stagehandService } from "./services/stagehand.service.js";

const { port, host } = config.server;

const server = app.listen(port, host, () => {
  logger.info(`Server đang chạy tại http://${host}:${port}`);
  logger.info(`- POST http://${host}:${port}/run`);
  logger.info(`- GET  http://${host}:${port}/health`);
});

// ================= GRACEFUL SHUTDOWN =================
const gracefulShutdown = async (signal) => {
  logger.info(`Nhận tín hiệu ${signal}. Đang thu hồi tài nguyên & đóng server...`);

  // Dọn dẹp an toàn các tiến trình Chrome còn mở
  await stagehandService.destroyAll().catch((err) => {
    logger.error("Lỗi khi thu hồi trình duyệt:", err);
  });

  server.close(() => {
    logger.info("HTTP server đã đóng hoàn tất. Thoát tiến trình an toàn.");
    process.exit(0);
  });

  // Ép buộc dừng nếu quá 8 giây
  setTimeout(() => {
    logger.error("Đóng server quá thời gian cho phép. Ép buộc dừng tiến trình.");
    process.exit(1);
  }, 8_000).unref();
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Rejection:", reason);
});


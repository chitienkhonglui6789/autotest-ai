import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config/env.js";
import routes from "./routes/index.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { NotFoundError } from "./errors/AppError.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.resolve(__dirname, "../screenshots");
const clientDistDir = process.env.CLIENT_DIST_DIR || path.resolve(__dirname, "../../fe/dist");

export const createApp = () => {
  const app = express();

  // 1. Core Middlewares
  app.use(cors());
  app.use(express.json({ limit: config.limits.bodyLimit }));

  // Phục vụ tĩnh ảnh chụp màn hình
  app.use("/screenshots", express.static(screenshotsDir));

  // 2. Application Routes
  app.use("/", routes);

  // 3. Phục vụ tĩnh Frontend (Production / Docker build)
  if (fs.existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir));
    app.get(/^(?!\/(screenshots|run|health|status|config|env|model|history)).*$/, (req, res, next) => {
      if (req.accepts("html")) {
        return res.sendFile(path.join(clientDistDir, "index.html"));
      }
      next(new NotFoundError("Không tìm thấy"));
    });
  }

  // 4. Fallback 404 Handler
  app.use((req, res, next) => {
    next(new NotFoundError("Không tìm thấy"));
  });

  // 5. Global Error Handler
  app.use(errorHandler);

  return app;
};

export default createApp();


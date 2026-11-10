import { Router } from "express";
import runnerRoutes from "./runner.routes.js";
import historyRoutes from "./history.routes.js";
import configRoutes from "./config.routes.js";
import { runnerController } from "../controllers/runner.controller.js";
import { configController } from "../controllers/config.controller.js";

const router = Router();

// Endpoint kiểm tra sức khỏe và trạng thái lock & LLM
router.get("/health", runnerController.getStatus);
router.get("/status", runnerController.getStatus);

// Endpoint cấu hình (.env)
router.use("/config", configRoutes);
router.get("/env", configController.getEnv);
router.post("/env", configController.updateEnv);
router.put("/env", configController.updateEnv);
router.get("/model", configController.getModel);
router.post("/model", configController.updateModel);
router.put("/model", configController.updateModel);

// Mount history routes (/history)
router.use("/history", historyRoutes);

// Mount runner routes (/run)
router.use("/", runnerRoutes);

export default router;


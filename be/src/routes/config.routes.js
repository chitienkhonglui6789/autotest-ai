import { Router } from "express";
import { configController } from "../controllers/config.controller.js";

const router = Router();

// API quản lý toàn bộ biến .env
router.get("/env", configController.getEnv);
router.post("/env", configController.updateEnv);
router.put("/env", configController.updateEnv);

// API riêng cho model (tương thích ngược)
router.get("/model", configController.getModel);
router.post("/model", configController.updateModel);
router.put("/model", configController.updateModel);

export default router;

import { Router } from "express";
import { historyController } from "../controllers/history.controller.js";

const router = Router();

router.get("/", historyController.getAll);
router.post("/", historyController.save);
router.delete("/", historyController.clear);

router.get("/:id", historyController.getById);
router.get("/:id/report", historyController.exportReport);
router.delete("/:id", historyController.deleteById);

export default router;


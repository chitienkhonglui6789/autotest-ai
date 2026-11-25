import { Router } from "express";
import { batchesController } from "../controllers/batches.controller.js";
import { MethodNotAllowedError } from "../errors/AppError.js";

const router = Router();

router
  .route("/start")
  .post(batchesController.start)
  .all((req, res, next) => {
    next(new MethodNotAllowedError("Chỉ nhận POST"));
  });

router
  .route("/:id/abort")
  .post(batchesController.abort)
  .all((req, res, next) => {
    next(new MethodNotAllowedError("Chỉ nhận POST"));
  });

router
  .route("/:id/live")
  .get(batchesController.getLive)
  .all((req, res, next) => {
    next(new MethodNotAllowedError("Chỉ nhận GET"));
  });

export default router;

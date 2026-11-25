import { Router } from "express";
import { runnerController } from "../controllers/runner.controller.js";
import { batchesController } from "../controllers/batches.controller.js";
import { validateRunRequest } from "../middlewares/validateRequest.js";
import { MethodNotAllowedError } from "../errors/AppError.js";

const router = Router();

router
  .route("/run")
  .post(validateRunRequest, runnerController.run)
  .all((req, res, next) => {
    next(new MethodNotAllowedError("Chỉ nhận POST"));
  });

router
  .route("/run/batch")
  .post(batchesController.start)
  .all((req, res, next) => {
    next(new MethodNotAllowedError("Chỉ nhận POST"));
  });

router
  .route("/run/abort")
  .post(runnerController.abort)
  .all((req, res, next) => {
    next(new MethodNotAllowedError("Chỉ nhận POST"));
  });

router
  .route("/run/live")
  .get(runnerController.getLive)
  .all((req, res, next) => {
    next(new MethodNotAllowedError("Chỉ nhận GET"));
  });

router
  .route("/steps/split")
  .post(runnerController.splitSteps)
  .all((req, res, next) => {
    next(new MethodNotAllowedError("Chỉ nhận POST"));
  });

router
  .route("/cache")
  .get(runnerController.listCache)
  .delete(runnerController.clearCache)
  .all((req, res, next) => {
    next(new MethodNotAllowedError("Chỉ nhận GET hoặc DELETE"));
  });

export default router;

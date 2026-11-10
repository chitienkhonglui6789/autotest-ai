import { Router } from "express";
import { runnerController } from "../controllers/runner.controller.js";
import { validateRunRequest } from "../middlewares/validateRequest.js";
import { MethodNotAllowedError } from "../errors/AppError.js";

const router = Router();

router
  .route("/run")
  .post(validateRunRequest, runnerController.run)
  .all((req, res, next) => {
    next(new MethodNotAllowedError("Chỉ nhận POST"));
  });

export default router;


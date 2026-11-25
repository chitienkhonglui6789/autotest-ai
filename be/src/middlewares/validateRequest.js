import { BadRequestError } from "../errors/AppError.js";
import { config } from "../config/env.js";

/**
 * Middleware kiểm tra tính hợp lệ của request body gửi lên POST /run
 * Hỗ trợ truyền trực tiếp mảng `steps` hoặc chuỗi `description`
 */
export const validateRunRequest = (req, res, next) => {
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return next(new BadRequestError("Body phải là một đối tượng JSON"));
  }

  const { description, steps, variables, dryRun } = body;

  const hasValidSteps = Array.isArray(steps) && steps.length > 0;
  const hasValidDescription =
    typeof description === "string" &&
    description.trim().length > 0 &&
    description.length <= config.limits.maxDescriptionLength;

  if (!hasValidSteps && !hasValidDescription) {
    return next(
      new BadRequestError(
        `Cần cung cấp danh sách bước (steps) hoặc mô tả (description) từ 1-${config.limits.maxDescriptionLength} ký tự`
      )
    );
  }

  if (variables !== undefined) {
    const isInvalidVariables =
      typeof variables !== "object" ||
      variables === null ||
      Array.isArray(variables) ||
      !Object.values(variables).every((val) => typeof val === "string");

    if (isInvalidVariables) {
      return next(new BadRequestError("variables phải là đối tượng {tên: chuỗi}"));
    }
  }

  if (dryRun !== undefined && typeof dryRun !== "boolean") {
    return next(new BadRequestError("dryRun phải là kiểu boolean"));
  }

  next();
};

import { BadRequestError } from "../errors/AppError.js";
import { config } from "../config/env.js";

/**
 * Middleware kiểm tra tính hợp lệ của request body gửi lên POST /run
 */
export const validateRunRequest = (req, res, next) => {
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return next(new BadRequestError("Body phải là một đối tượng JSON"));
  }

  const { description, variables, dryRun } = body;

  // Kiểm tra description
  if (
    typeof description !== "string" ||
    !description.trim() ||
    description.length > config.limits.maxDescriptionLength
  ) {
    return next(
      new BadRequestError(
        `description phải là chuỗi 1-${config.limits.maxDescriptionLength} ký tự`
      )
    );
  }

  // Kiểm tra variables
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

  // Kiểm tra dryRun (nếu có phải là boolean)
  if (dryRun !== undefined && typeof dryRun !== "boolean") {
    return next(new BadRequestError("dryRun phải là kiểu boolean"));
  }

  next();
};


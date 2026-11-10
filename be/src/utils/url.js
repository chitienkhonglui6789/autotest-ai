import { BadRequestError } from "../errors/AppError.js";

/**
 * Chuẩn hóa và xác thực URL
 * "abc.com" → "https://abc.com/"; "abc" (thiếu domain/đuôi) thì báo lỗi
 *
 * @param {string} text
 * @returns {string}
 */
export const toUrl = (text) => {
  if (typeof text !== "string" || !text.trim()) {
    throw new BadRequestError("Địa chỉ URL không được để trống");
  }

  let u = text.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    u = "https://" + u;
  }

  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    throw new BadRequestError(`"${text}" không phải địa chỉ hợp lệ`);
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new BadRequestError(`Chỉ cho phép http/https, nhận được "${parsed.protocol}"`);
  }

  if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") {
    throw new BadRequestError(`"${text}" chưa phải địa chỉ đầy đủ (thiếu đuôi như .com)`);
  }

  return parsed.href;
};


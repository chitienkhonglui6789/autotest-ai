import fs from "node:fs";
import path from "node:path";
import { envFilePath } from "../config/env.js";
import { logger } from "../utils/logger.js";

const initialServerConfig = {
  port: process.env.PORT,
  host: process.env.HOST,
};

/**
 * Lấy đường dẫn file .env ưu tiên đường dẫn trong cấu hình
 */
export function getEnvPath() {
  if (fs.existsSync(envFilePath)) {
    return envFilePath;
  }
  const rootEnv = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(rootEnv)) {
    return rootEnv;
  }
  const beEnv = path.resolve(process.cwd(), "be/.env");
  if (fs.existsSync(beEnv)) {
    return beEnv;
  }
  return envFilePath;
}

/**
 * Đọc toàn bộ file .env và trả về danh sách mọi biến giữ đúng thứ tự trong file
 * @returns {Array<{ key: string, value: string }>}
 */
export function readAllEnvVars() {
  const filePath = getEnvPath();
  const vars = [];

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split(/\r?\n/);

      for (const line of lines) {
        // Chỉ nhận diện các dòng biến có dạng KEY=VALUE (bỏ qua comment bắt đầu bằng #)
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
        if (match) {
          const key = match[1];
          let val = match[2].trim();
          // Bỏ quote bọc ngoài nếu có
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          vars.push({ key, value: val });
        }
      }
    }
  } catch (err) {
    logger.warn(`Lỗi khi đọc file .env (${filePath}):`, err.message);
  }

  return vars;
}

/**
 * Cập nhật các biến vào file .env
 * Giữ nguyên các dòng chú thích, dòng trống, thứ tự và các dòng không nhận diện được.
 * Giá trị không được chứa ký tự xuống dòng.
 * Không ghi giá trị các key vào log.
 * @param {Record<string, string> | Array<{ key: string, value: string }>} updates
 * @returns {{ success: boolean, updatedKeys: string[], requireRestart: boolean }}
 */
export function updateEnvVars(updates) {
  const filePath = getEnvPath();

  // Chuẩn hóa input thành Map
  const updatesMap = new Map();
  if (Array.isArray(updates)) {
    for (const item of updates) {
      if (item && item.key) {
        updatesMap.set(item.key.trim(), item.value ?? "");
      }
    }
  } else if (updates && typeof updates === "object") {
    for (const [k, v] of Object.entries(updates)) {
      updatesMap.set(k.trim(), v ?? "");
    }
  }

  // Kiểm tra tính hợp lệ: không được chứa ký tự xuống dòng
  for (const [k, v] of updatesMap.entries()) {
    const strVal = String(v);
    if (/[\r\n]/.test(strVal)) {
      throw new Error(`Giá trị của biến "${k}" không được chứa ký tự xuống dòng.`);
    }
  }

  let originalContent = "";
  if (fs.existsSync(filePath)) {
    originalContent = fs.readFileSync(filePath, "utf-8");
  }

  const lines = originalContent.split(/\r?\n/);
  const updatedKeys = [];
  const handledKeys = new Set();

  const newLines = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) {
      // Giữ nguyên chú thích, dòng trống hoặc dòng không nhận diện được
      return line;
    }

    const indent = match[1];
    const key = match[2];

    if (updatesMap.has(key)) {
      const newVal = String(updatesMap.get(key));
      handledKeys.add(key);
      updatedKeys.push(key);
      return `${indent}${key}=${newVal}`;
    }

    // Biến không đổi, giữ nguyên
    return line;
  });

  // Nếu có biến mới chưa có trong file, thêm vào cuối
  for (const [k, v] of updatesMap.entries()) {
    if (!handledKeys.has(k)) {
      newLines.push(`${k}=${String(v)}`);
      updatedKeys.push(k);
    }
  }

  // Ghi lại file .env
  fs.writeFileSync(filePath, newLines.join("\n"), "utf-8");

  // Đồng bộ vào runtime process.env
  let requireRestart = false;
  for (const key of updatedKeys) {
    const val = String(updatesMap.get(key));
    process.env[key] = val;

    // Kiểm tra nếu thay đổi PORT hoặc HOST (do máy chủ HTTP đã bind port từ đầu)
    if (key === "PORT" && val !== initialServerConfig.port) {
      requireRestart = true;
    }
    if (key === "HOST" && val !== initialServerConfig.host) {
      requireRestart = true;
    }
  }

  // TUYỆT ĐỐI KHÔNG GHI GIÁ TRỊ CÁC KEY VÀO LOG
  logger.info(`Đã cập nhật ${updatedKeys.length} biến trong file .env: ${updatedKeys.join(", ")}`);

  return {
    success: true,
    updatedKeys,
    requireRestart,
  };
}

/**
 * Đọc giá trị Model hiện tại từ file .env
 * @returns {string} Tên model
 */
export function readModelFromEnv() {
  const vars = readAllEnvVars();
  const found = vars.find((v) => v.key === "LLM_MODEL");
  if (found && found.value) return found.value;
  return process.env.LLM_MODEL?.trim() || "qwen3.8-27b";
}

/**
 * Cập nhật tên Model vào file .env (giữ lại để tương thích ngược)
 */
export function updateModelInEnv(newModel) {
  if (!newModel || typeof newModel !== "string" || !newModel.trim()) {
    throw new Error("Tên Model không được để trống");
  }
  updateEnvVars({ LLM_MODEL: newModel.trim() });
  return newModel.trim();
}

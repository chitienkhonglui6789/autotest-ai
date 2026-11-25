import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";
import { config } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BE_ROOT = path.resolve(__dirname, "../../");

export const DATA_DIR = path.resolve(BE_ROOT, "data");
export const SESSIONS_DIR = path.resolve(DATA_DIR, "sessions");
export const SCREENSHOTS_DIR = path.resolve(BE_ROOT, "screenshots");
export const TEMP_UPLOADS_DIR = path.resolve(SCREENSHOTS_DIR, "temp_uploads");
export const DOWNLOADS_DIR = path.resolve(SCREENSHOTS_DIR, "downloads");

export class StorageService {
  constructor() {
    this.screenshotsDir = SCREENSHOTS_DIR;
    this.tempUploadsDir = TEMP_UPLOADS_DIR;
    this.downloadsDir = DOWNLOADS_DIR;
    this.dataDir = DATA_DIR;
    this.sessionsDir = SESSIONS_DIR;
  }

  /**
   * Khởi tạo các thư mục lưu trữ cần thiết
   */
  async ensureDirectories() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.mkdir(this.sessionsDir, { recursive: true });
      await fs.mkdir(this.screenshotsDir, { recursive: true });
      await fs.mkdir(this.tempUploadsDir, { recursive: true });
      await fs.mkdir(this.downloadsDir, { recursive: true });
    } catch (err) {
      logger.error("Lỗi khi khởi tạo thư mục lưu trữ:", err.message);
    }
  }

  /**
   * Đường dẫn tệp storageState (Cookies / localStorage) dùng lại phiên đăng nhập theo Project
   */
  getProjectSessionPath(projectId) {
    const safeId = this._sanitizeFilename(String(projectId || "default"), "default");
    return path.join(this.sessionsDir, `${safeId}.json`);
  }

  hasProjectSessionSync(projectId) {
    try {
      return fsSync.existsSync(this.getProjectSessionPath(projectId));
    } catch {
      return false;
    }
  }

  async clearProjectSession(projectId) {
    const sessionPath = this.getProjectSessionPath(projectId);
    try {
      await fs.rm(sessionPath, { force: true });
      return true;
    } catch (err) {
      logger.warn(`Không thể xóa phiên storageState cho dự án ${projectId}:`, err.message);
      return false;
    }
  }

  /**
   * Chuẩn hóa tên tệp an toàn (chặn path traversal / ký tự cấm của hệ điều hành)
   * @param {string} filename
   * @param {string} [fallback="file.bin"]
   * @returns {string}
   */
  _sanitizeFilename(filename, fallback = "file.bin") {
    const base = path.basename(String(filename || "").trim());
    const clean = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
    if (!clean || clean === "." || clean === "..") return fallback;
    return clean;
  }

  /**
   * Tạo thư mục lưu ảnh cho một phiên kiểm thử
   * @param {string} runId
   * @returns {Promise<string>}
   */
  async getRunScreenshotsDir(runId) {
    const safeRunId = this._sanitizeFilename(runId, `run_${Date.now()}`);
    const runDir = path.join(this.screenshotsDir, safeRunId);
    await fs.mkdir(runDir, { recursive: true });
    return runDir;
  }

  /**
   * Xóa toàn bộ thư mục ảnh của một phiên chạy
   * @param {string} runId
   */
  async deleteRunScreenshots(runId) {
    const raw = String(runId || "").trim();
    if (!raw || raw === "." || raw === ".." || path.basename(raw) !== raw) return;
    try {
      const runDir = path.join(this.screenshotsDir, raw);
      await fs.rm(runDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn(`Không thể xóa thư mục screenshots cho ${raw}:`, err.message);
    }
  }

  /**
   * Tạo tệp mẫu tạm thời để tải lên
   * @param {string} filename
   * @param {string|Buffer} [content]
   * @returns {Promise<string>}
   */
  async createTempUploadFile(filename, content = "AutoTest Synthetic Binary Payload") {
    await fs.mkdir(this.tempUploadsDir, { recursive: true });
    const safeName = this._sanitizeFilename(filename, "upload_sample.bin");
    const filePath = path.join(this.tempUploadsDir, safeName);
    await fs.writeFile(filePath, content, "utf-8");
    return filePath;
  }

  /**
   * Lưu tệp tải về từ trình duyệt
   * @param {object} download - Playwright Download object
   * @returns {Promise<{ filename: string, path: string, timestamp: number }>}
   */
  async saveDownloadedFile(download) {
    await fs.mkdir(this.downloadsDir, { recursive: true });
    const suggestedFilename = this._sanitizeFilename(download.suggestedFilename(), "download.bin");
    const savePath = path.join(this.downloadsDir, `${Date.now()}_${suggestedFilename}`);
    await download.saveAs(savePath);
    return {
      filename: suggestedFilename,
      path: savePath,
      timestamp: Date.now(),
    };
  }

  /**
   * Dọn dẹp thư mục screenshots cũ / mồ côi theo Retention Policy
   * @param {Set<string>} activeRunIds
   * @returns {Promise<number>}
   */
  async cleanupRetention(activeRunIds = new Set()) {
    try {
      const maxFolders = config.screenshots?.maxFolders || 100;
      const retentionDays = config.screenshots?.retentionDays || 7;
      const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
      const now = Date.now();

      await fs.mkdir(this.screenshotsDir, { recursive: true });
      const entries = await fs.readdir(this.screenshotsDir, { withFileTypes: true });
      const dirEntries = entries.filter((e) => e.isDirectory());

      const dirsWithStat = [];
      for (const d of dirEntries) {
        // Bỏ qua thư mục hệ thống nội bộ
        if (d.name === "temp_uploads" || d.name === "downloads") continue;
        const dirPath = path.join(this.screenshotsDir, d.name);
        try {
          const stat = await fs.stat(dirPath);
          dirsWithStat.push({ name: d.name, path: dirPath, mtime: stat.mtimeMs });
        } catch {}
      }

      dirsWithStat.sort((a, b) => b.mtime - a.mtime);

      let deletedCount = 0;
      for (let i = 0; i < dirsWithStat.length; i++) {
        const item = dirsWithStat[i];
        const isTooOld = now - item.mtime > maxAgeMs;
        const isExceedingQuota = i >= maxFolders;
        const isOrphaned = !activeRunIds.has(item.name);

        if (isTooOld || isExceedingQuota || (isOrphaned && dirsWithStat.length > 50)) {
          try {
            await fs.rm(item.path, { recursive: true, force: true });
            deletedCount++;
          } catch {}
        }
      }

      if (deletedCount > 0) {
        logger.info(`[Retention Policy] Đã dọn dẹp ${deletedCount} thư mục ảnh chụp màn hình cũ/mồ côi.`);
      }
      return deletedCount;
    } catch (cleanErr) {
      logger.debug("Lỗi trong quá trình dọn dẹp screenshots:", cleanErr.message);
      return 0;
    }
  }
}

export const storageService = new StorageService();


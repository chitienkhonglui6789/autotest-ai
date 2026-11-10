import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BE_ROOT = path.resolve(__dirname, "../../");
const DATA_DIR = path.resolve(BE_ROOT, "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const SCREENSHOTS_DIR = path.resolve(BE_ROOT, "screenshots");

export class HistoryService {
  constructor(filePath = HISTORY_FILE) {
    this.filePath = filePath;
    this.inMemoryCache = null;
    this._initPromise = this._ensureStorage();
  }

  async _ensureStorage() {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      try {
        await fs.access(this.filePath);
      } catch {
        await fs.writeFile(this.filePath, JSON.stringify([], null, 2), "utf-8");
      }
    } catch (err) {
      logger.error("Không thể khởi tạo tệp lưu trữ lịch sử:", err);
    }
  }

  async _readHistory() {
    await this._initPromise;
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      const list = JSON.parse(content || "[]");
      return Array.isArray(list) ? list : [];
    } catch (err) {
      logger.warn("Lỗi khi đọc file lịch sử, sử dụng mảng rỗng:", err.message);
      return [];
    }
  }

  async _writeHistory(runs) {
    await this._initPromise;
    const tempFile = `${this.filePath}.${Date.now()}.tmp`;
    try {
      const limited = runs.slice(0, 500); // Lưu tối đa 500 phiên gần nhất
      await fs.writeFile(tempFile, JSON.stringify(limited, null, 2), "utf-8");
      await fs.rename(tempFile, this.filePath);
      return true;
    } catch (err) {
      logger.error("Lỗi khi ghi tệp lịch sử:", err);
      try {
        await fs.unlink(tempFile);
      } catch {}
      return false;
    }
  }

  /**
   * Lấy danh sách lịch sử với bộ lọc
   */
  async getAll({ projectId, featureId, status, search, limit = 100 } = {}) {
    const list = await this._readHistory();

    let filtered = list;
    if (projectId) {
      filtered = filtered.filter((r) => r.projectId === projectId);
    }
    if (featureId) {
      filtered = filtered.filter((r) => r.featureId === featureId);
    }
    if (status && (status === "passed" || status === "failed")) {
      filtered = filtered.filter((r) => r.status === status);
    }
    if (search && typeof search === "string" && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((r) => {
        return (
          (r.featureName && r.featureName.toLowerCase().includes(q)) ||
          (r.projectName && r.projectName.toLowerCase().includes(q)) ||
          (r.description && r.description.toLowerCase().includes(q)) ||
          (Array.isArray(r.steps) && r.steps.some((s) => s.text?.toLowerCase().includes(q)))
        );
      });
    }

    // Sắp xếp phiên mới nhất lên đầu
    filtered.sort((a, b) => {
      const tA = new Date(a.timestamp || a.startedAt || 0).getTime();
      const tB = new Date(b.timestamp || b.startedAt || 0).getTime();
      return tB - tA;
    });

    return filtered.slice(0, limit);
  }

  /**
   * Lấy chi tiết một phiên chạy theo id
   */
  async getById(id) {
    if (!id) return null;
    const list = await this._readHistory();
    return list.find((r) => r.id === id) || null;
  }

  /**
   * Lưu hoặc cập nhật phiên chạy
   */
  async saveRun(runData) {
    if (!runData || !runData.id) {
      throw new Error("runData phải có id hợp lệ");
    }

    const list = await this._readHistory();
    const existingIndex = list.findIndex((r) => r.id === runData.id);

    const normalizedRun = {
      ...runData,
      id: runData.id,
      timestamp: runData.timestamp || runData.startedAt || new Date().toISOString(),
      startedAt: runData.startedAt || runData.timestamp || new Date().toISOString(),
      finishedAt: runData.finishedAt || new Date().toISOString(),
      duration: runData.duration || runData.durationMs || 0,
      durationMs: runData.durationMs || runData.duration || 0,
      status: runData.status || (runData.status === "passed" ? "passed" : "failed"),
      projectId: runData.projectId || "default",
      projectName: runData.projectName || "Dự án kiểm thử",
      name: runData.name || runData.featureName || "Đợt chạy kiểm thử",
      notes: runData.notes || "",
      features: Array.isArray(runData.features) ? runData.features : undefined,
      featureId: runData.featureId || null,
      featureName: runData.featureName || "Kiểm thử tự động",
      description: runData.description || "",
      plan: runData.plan || [],
      planNotes: runData.planNotes || "",
      steps: Array.isArray(runData.steps)
        ? runData.steps.map((st, idx) => ({
            index: st.index || idx + 1,
            type: st.type || "act",
            text: st.text || st.step || "",
            status: st.status === "passed" ? "passed" : "failed",
            message: st.message || st.error || null,
            error: st.error || (st.status !== "passed" ? st.message : null),
            durationMs: st.durationMs || 0,
            screenshotUrl: st.screenshotUrl || null,
            screenshots: Array.isArray(st.screenshots)
              ? st.screenshots.map((s) => ({
                  type: s.type || "after",
                  label: s.label || (s.type === "before" ? "Trước khi hành động" : "Sau khi hành động"),
                  sublabel: s.sublabel || (s.type === "before" ? "Highlight phần tử" : "Kết quả tương tác"),
                  url: s.url,
                }))
              : (st.screenshotUrl
                  ? [{
                      type: "after",
                      label: "Ảnh chụp",
                      sublabel: "Kết quả",
                      url: st.screenshotUrl,
                    }]
                  : []),
          }))
        : [],
      error: runData.error || null,
    };

    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...normalizedRun };
    } else {
      list.unshift(normalizedRun);
    }

    await this._writeHistory(list);
    return normalizedRun;
  }

  /**
   * Lưu nhiều phiên chạy cùng lúc
   */
  async saveMultipleRuns(runs) {
    if (!Array.isArray(runs) || runs.length === 0) return [];
    const list = await this._readHistory();

    for (const runData of runs) {
      if (!runData || !runData.id) continue;
      const existingIndex = list.findIndex((r) => r.id === runData.id);
      const normalizedRun = {
        ...runData,
        id: runData.id,
        timestamp: runData.timestamp || runData.startedAt || new Date().toISOString(),
        startedAt: runData.startedAt || runData.timestamp || new Date().toISOString(),
        finishedAt: runData.finishedAt || new Date().toISOString(),
        duration: runData.duration || runData.durationMs || 0,
        durationMs: runData.durationMs || runData.duration || 0,
        status: runData.status || (runData.status === "passed" ? "passed" : "failed"),
        projectId: runData.projectId || "default",
        projectName: runData.projectName || "Dự án kiểm thử",
        name: runData.name || runData.featureName || "Đợt chạy kiểm thử",
        notes: runData.notes || "",
        features: Array.isArray(runData.features) ? runData.features : undefined,
        featureId: runData.featureId || null,
        featureName: runData.featureName || "Kiểm thử tự động",
        description: runData.description || "",
        steps: Array.isArray(runData.steps) ? runData.steps : [],
        error: runData.error || null,
      };

      if (existingIndex >= 0) {
        list[existingIndex] = { ...list[existingIndex], ...normalizedRun };
      } else {
        list.unshift(normalizedRun);
      }
    }

    await this._writeHistory(list);
    return list;
  }

  /**
   * Xóa một phiên chạy và xóa thư mục ảnh liên quan
   */
  async deleteById(id) {
    if (!id) return false;
    const list = await this._readHistory();
    const nextList = list.filter((r) => r.id !== id);

    if (nextList.length === list.length) {
      return false;
    }

    await this._writeHistory(nextList);

    // Dọn dẹp thư mục screenshots của run này nếu có
    try {
      const runFolder = path.join(SCREENSHOTS_DIR, id);
      await fs.rm(runFolder, { recursive: true, force: true });
    } catch (err) {
      logger.warn(`Không thể xóa thư mục screenshots cho ${id}:`, err.message);
    }

    return true;
  }

  /**
   * Xóa toàn bộ lịch sử (hoặc theo projectId)
   */
  async clear({ projectId } = {}) {
    const list = await this._readHistory();
    if (projectId) {
      const toDelete = list.filter((r) => r.projectId === projectId);
      const remaining = list.filter((r) => r.projectId !== projectId);
      await this._writeHistory(remaining);

      for (const r of toDelete) {
        try {
          await fs.rm(path.join(SCREENSHOTS_DIR, r.id), { recursive: true, force: true });
        } catch {}
      }
      return toDelete.length;
    }

    // Xóa tất cả
    await this._writeHistory([]);
    return list.length;
  }
}

export const historyService = new HistoryService();


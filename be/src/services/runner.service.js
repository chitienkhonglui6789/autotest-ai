import { assertConfigReady } from "../config/env.js";
import { runnerLock } from "../utils/asyncLock.js";
import { classifierService } from "./classifier.service.js";
import { stagehandService } from "./stagehand.service.js";
import { historyService } from "./history.service.js";
import { logger } from "../utils/logger.js";

export class RunnerService {
  constructor(
    classifier = classifierService,
    stagehand = stagehandService,
    history = historyService,
    lock = runnerLock
  ) {
    this.classifier = classifier;
    this.stagehand = stagehand;
    this.history = history;
    this.lock = lock;
  }

  /**
   * Điều phối quy trình kiểm thử hoàn chỉnh với cơ chế khóa độc quyền
   *
   * @param {object} params
   * @param {string} params.description - Mô tả test case
   * @param {Record<string, string>} [params.variables] - Biến thay thế
   * @param {boolean} [params.dryRun] - Nếu true, chỉ sinh plan mà không mở trình duyệt
   * @param {string} [params.projectId] - ID dự án
   * @param {string} [params.projectName] - Tên dự án
   * @param {string} [params.featureId] - ID tính năng
   * @param {string} [params.featureName] - Tên tính năng
   * @param {AbortSignal} [params.signal] - Tín hiệu hủy khi client ngắt kết nối
   * @returns {Promise<object>}
   */
  async execute({
    description,
    variables,
    dryRun = false,
    projectId,
    projectName,
    featureId,
    featureName,
    signal = null,
  }) {
    // 1. Kiểm tra cấu hình môi trường
    assertConfigReady();

    if (signal?.aborted) {
      throw new Error("Phiên kiểm thử đã bị hủy trước khi bắt đầu");
    }

    // 2. Chạy trong khối khóa độc quyền
    return await this.lock.runExclusive(async () => {
      logger.info(`Bắt đầu xử lý: "${description.slice(0, 80)}..." (dryRun: ${dryRun})`);

      // 3. Phân loại câu lệnh thành các bước test tuần tự
      const plan = await this.classifier.classify(description.trim(), signal);

      if (signal?.aborted) {
        throw new Error("Phiên kiểm thử đã bị hủy");
      }

      // 4. Nếu chỉ yêu cầu dryRun
      if (dryRun === true) {
        logger.info("Chế độ dryRun: trả về kế hoạch kiểm thử mà không chạy trình duyệt");
        return {
          dryRun: true,
          plan: plan.steps,
          planNotes: plan.notes,
        };
      }

      // 5. Thực thi tự động trên trình duyệt
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const result = {
        id: runId,
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        projectId: projectId || "default",
        projectName: projectName || "Dự án kiểm thử",
        featureId: featureId || null,
        featureName: featureName || (description ? description.slice(0, 45) : "Kiểm thử tự động"),
        description: description,
        plan: plan.steps,
        planNotes: plan.notes,
        steps: [],
        error: null,
      };

      try {
        await this.stagehand.runSteps(plan.steps, variables, result, signal);
      } finally {
        result.finishedAt = new Date().toISOString();
        const startMs = new Date(result.startedAt).getTime();
        const endMs = new Date(result.finishedAt).getTime();
        result.duration = Math.max(0, endMs - startMs);
        result.durationMs = result.duration;

        // Lưu vào history service tự động
        try {
          await this.history.saveRun(result);
          logger.info(`Đã lưu phiên chạy ${runId} vào lịch sử.`);
        } catch (hErr) {
          logger.warn(`Lỗi khi lưu phiên chạy vào lịch sử: ${hErr.message}`);
        }
      }

      logger.info(`Kết thúc thực thi với trạng thái: ${result.status}`);
      return result;
    }, { description, dryRun });
  }
}

export const runnerService = new RunnerService();


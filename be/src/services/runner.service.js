import { assertConfigReady } from "../config/env.js";
import { runnerLock } from "../utils/asyncLock.js";
import { stepPlannerService } from "./step-planner.service.js";
import { microAgentRunnerService } from "./engine/micro-agent-runner.service.js";
import { stepCacheService } from "./engine/step-cache.service.js";
import { historyService } from "./history.service.js";
import { projectsService } from "./projects.service.js";
import { llmService } from "./llm.service.js";
import { logger } from "../utils/logger.js";

export class RunnerService {
  constructor(
    stepPlanner = stepPlannerService,
    engine = microAgentRunnerService,
    history = historyService,
    projects = projectsService,
    lock = runnerLock,
    cache = stepCacheService,
    llm = llmService
  ) {
    this.stepPlanner = stepPlanner;
    this.engine = engine;
    this.history = history;
    this.projects = projects;
    this.lock = lock;
    this.cache = cache;
    this.llm = llm;
  }

  getLiveStatus() {
    return this.engine.getLiveStatus();
  }

  /**
   * Điều phối quy trình kiểm thử hoàn chỉnh trên Kiến trúc Native Playwright + Micro-ReAct:
   * - Giữ nguyên 1:1 danh sách bước từ giao diện Studio (Zero-Classifier, 0ms).
   * - Nếu gọi API thô chỉ truyền `description`, tự động tách mệnh đề tiếng Việt.
   * - Thực thi qua 3 tầng: Step Trace Cache -> Fast-Path -> Micro-ReAct Loop.
   */
  async execute({
    description,
    steps: rawSteps = null,
    variables,
    dryRun = false,
    projectId,
    projectName,
    featureId,
    featureName,
    diagnosticStrictness = null,
    ownerToken = null,
    abortController = null,
    signal = null,
  }) {
    assertConfigReady();

    if (signal?.aborted) {
      throw new Error("Phiên kiểm thử đã bị hủy trước khi bắt đầu");
    }

    const resolvedStepEstimate = Array.isArray(rawSteps) && rawSteps.length > 0 ? rawSteps.length : 15;
    const lockBudgetMs = Math.max(20 * 60 * 1000, resolvedStepEstimate * 2 * 60 * 1000);

    return await this.lock.runExclusive(
      async () => {
        const descText = String(description || "").trim();
        logger.info(
          `Bắt đầu xử lý kịch bản: "${(featureName || descText).slice(0, 80)}" (dryRun: ${dryRun}) [Owner: ${ownerToken || "local"}]`
        );

        let proj = null;
        let feat = null;
        if (projectId) {
          try {
            proj = await this.projects.getById(projectId);
            feat = featureId ? proj?.features?.find((f) => f.id === featureId) || null : null;
          } catch {}
        }

        // Nếu không truyền mảng steps trực tiếp nhưng có projectId & featureId, tự động lấy mảng steps gốc từ DB
        let resolvedRawSteps = Array.isArray(rawSteps) && rawSteps.length > 0 ? rawSteps : null;
        if (!resolvedRawSteps && feat && Array.isArray(feat.steps) && feat.steps.length > 0) {
          resolvedRawSteps = feat.steps;
        }

        const plan = await this.stepPlanner.prepareExecutionPlan(descText, signal, resolvedRawSteps);

        if (signal?.aborted) {
          throw new Error("Phiên kiểm thử đã bị hủy");
        }

        if (dryRun === true) {
          logger.info("Chế độ dryRun: trả về kế hoạch kiểm thử mà không mở trình duyệt");
          return {
            dryRun: true,
            plan: plan.steps,
            planNotes: plan.notes,
          };
        }

        const execCtx = await this.projects.getExecutionContext(
          projectId || proj?.id,
          feat?.sessionMode || "inherit",
          variables
        );

        const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const result = {
          id: runId,
          status: "running",
          startedAt: new Date().toISOString(),
          finishedAt: null,
          projectId: projectId || "default",
          projectName: projectName || proj?.name || "Dự án kiểm thử",
          featureId: featureId || null,
          featureName: featureName || feat?.name || (descText ? descText.slice(0, 45) : "Kiểm thử tự động"),
          description: descText || plan.steps.map((s) => s.text).join("\n"),
          plan: plan.steps,
          planNotes: plan.notes,
          steps: [],
          error: null,
        };

        try {
          await this.engine.runSteps(plan.steps, execCtx.mergedVars, result, signal, {
            persistSession: execCtx.persistSession,
            storageStatePath: execCtx.storageStatePath,
            secretKeys: execCtx.secretKeys,
            diagnosticStrictness: diagnosticStrictness || proj?.diagnosticStrictness || null,
            onActivity: () => this.lock.touch(),
            onStepComplete: () => this.lock.touch(),
          });
        } finally {
          result.finishedAt = new Date().toISOString();
          const startMs = new Date(result.startedAt).getTime();
          const endMs = new Date(result.finishedAt).getTime();
          result.duration = Math.max(0, endMs - startMs);
          result.durationMs = result.duration;

          try {
            await this.history.saveRun(result);
            logger.info(`Đã lưu phiên chạy ${runId} vào lịch sử.`);
          } catch (hErr) {
            logger.warn(`Lỗi khi lưu phiên chạy vào lịch sử: ${hErr.message}`);
          }
        }

        logger.info(`Kết thúc thực thi với trạng thái: ${result.status} (${result.durationMs}ms)`);
        return result;
      },
      { description, dryRun, ownerToken, projectId, featureId },
      "Đang có lần chạy khác, thử lại sau",
      abortController,
      lockBudgetMs
    );
  }
}

export const runnerService = new RunnerService();

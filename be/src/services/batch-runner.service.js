import { assertConfigReady } from "../config/env.js";
import { runnerLock } from "../utils/asyncLock.js";
import { stepPlannerService } from "./step-planner.service.js";
import { microAgentRunnerService } from "./engine/micro-agent-runner.service.js";
import { stepCacheService } from "./engine/step-cache.service.js";
import { historyService } from "./history.service.js";
import { projectsService } from "./projects.service.js";
import { logger } from "../utils/logger.js";
import { BadRequestError, ConflictError, NotFoundError } from "../errors/AppError.js";

function generateBatchName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `Đợt chạy ${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

function normalizeStepResults(steps = []) {
  if (!Array.isArray(steps)) return [];
  return steps.map((st, idx) => ({
    index: st.index || idx + 1,
    type: st.type || "act",
    text: st.text || st.step || "",
    isSoft: Boolean(st.isSoft),
    executionMode: st.executionMode || null,
    status: st.status === "passed" ? "passed" : st.status === "running" ? "running" : "failed",
    verdict: st.verdict || null,
    isAssertionStep: Boolean(st.isAssertionStep),
    durationMs: typeof st.durationMs === "number" ? st.durationMs : 0,
    message: st.message || "",
    actionsLog: Array.isArray(st.actionsLog) ? [...st.actionsLog] : undefined,
    value: st.value,
    failureType: st.failureType || null,
    detectedAlert: st.detectedAlert || null,
    evidence: st.evidence || null,
    uxWarnings: Array.isArray(st.uxWarnings) && st.uxWarnings.length > 0 ? [...st.uxWarnings] : undefined,
    error: st.status === "failed" ? (st.error || st.message || "Không thành công") : undefined,
    screenshotUrl: st.screenshotUrl || undefined,
    screenshots: Array.isArray(st.screenshots)
      ? st.screenshots.map((s) => ({ ...s }))
      : st.screenshotUrl
        ? [{ url: st.screenshotUrl, type: "after", label: "Ảnh chụp màn hình" }]
        : [],
  }));
}

export class BatchRunnerService {
  constructor(
    stepPlanner = stepPlannerService,
    engine = microAgentRunnerService,
    history = historyService,
    projects = projectsService,
    lock = runnerLock,
    cache = stepCacheService
  ) {
    this.stepPlanner = stepPlanner;
    this.engine = engine;
    this.history = history;
    this.projects = projects;
    this.lock = lock;
    this.cache = cache;
    this._activeBatchId = null;
  }

  get activeBatchId() {
    return this._activeBatchId || this.lock.status?.batchId || null;
  }

  async _resolveFeatures({ projectId, projectName, features, featureIds }) {
    const project = projectId ? await this.projects.getById(projectId) : null;
    const projectFeatureMap = new Map((project?.features || []).map((f) => [f.id, f]));

    let rawList = [];
    if (Array.isArray(features) && features.length > 0) {
      rawList = features;
    } else if (Array.isArray(featureIds) && featureIds.length > 0) {
      if (!project) {
        throw new NotFoundError(`Không tìm thấy dự án với ID: ${projectId}`);
      }
      rawList = featureIds
        .map((fid) => projectFeatureMap.get(String(fid)))
        .filter(Boolean);
    }

    if (rawList.length === 0) {
      throw new BadRequestError("Danh sách tính năng cần chạy không được để trống.");
    }

    const resolvedFeatures = rawList.map((f, idx) => {
      const fid = String(f.id || `feat_${idx + 1}`);
      const fromProj = projectFeatureMap.get(fid);
      const rawSteps =
        Array.isArray(f.steps) && f.steps.length > 0
          ? f.steps
          : Array.isArray(fromProj?.steps)
            ? fromProj.steps
            : [];
      return {
        id: fid,
        name: String(f.name || fromProj?.name || `Tính năng ${idx + 1}`),
        steps: rawSteps.map((s) => String(s ?? "").trim()).filter(Boolean),
        sessionMode: f.sessionMode || fromProj?.sessionMode || "inherit",
      };
    });

    return {
      resolvedProjectId: projectId || project?.id || "default",
      resolvedProjectName: projectName || project?.name || "Dự án kiểm thử",
      resolvedFeatures,
    };
  }

  /**
   * Khởi tạo đợt chạy ở Backend:
   * - Chiếm runnerLock ngay lập tức (ném 409 nếu đang bận)
   * - Ghi batch trạng thái "Đang chạy" vào SQLite
   * - Trả về batchId / batch ngay lập tức (HTTP 202), tự điều phối vòng lặp ở BE
   */
  async startBatch({
    projectId,
    projectName,
    features,
    featureIds,
    name,
    notes = "",
    variables,
    ownerToken = null,
  }) {
    assertConfigReady();

    const { resolvedProjectId, resolvedProjectName, resolvedFeatures } = await this._resolveFeatures({
      projectId,
      projectName,
      features,
      featureIds,
    });

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = new Date().toISOString();
    const batchName = String(name || "").trim() || generateBatchName(new Date(startedAt));

    const initialBatch = {
      id: batchId,
      projectId: resolvedProjectId,
      projectName: resolvedProjectName,
      name: batchName,
      notes: String(notes || ""),
      timestamp: startedAt,
      startedAt,
      finishedAt: null,
      duration: 0,
      durationMs: 0,
      status: "Đang chạy",
      ownerToken: ownerToken || null,
      features: resolvedFeatures.map((f) => ({
        id: f.id,
        name: f.name,
        steps: [...f.steps],
        stepResults: [],
        status: "PENDING",
        durationMs: 0,
        error: null,
      })),
    };

    const abortController = new AbortController();

    return await this.lock.startBackgroundExclusive({
      metadata: {
        batchId,
        name: batchName,
        projectId: resolvedProjectId,
        featureCount: resolvedFeatures.length,
        ownerToken: ownerToken || null,
        dryRun: false,
      },
      conflictMessage: "Đang có lần chạy khác, thử lại sau",
      abortController,
      maxDurationMs: Math.max(60 * 60 * 1000, resolvedFeatures.length * 15 * 60 * 1000),
      onSetup: async () => {
        this._activeBatchId = batchId;
        const saved = await this.history.saveRun(initialBatch);
        logger.info(
          `[Batch Orchestrator] Khởi tạo đợt chạy ${batchId} ("${batchName}") gồm ${resolvedFeatures.length} tính năng [Owner: ${ownerToken || "local"}]`
        );
        return { batchId, batch: saved };
      },
      onBackground: async () => {
        await this._executeBatchLoop(initialBatch, resolvedFeatures, {
          variables,
          abortController,
        });
      },
      onBackgroundError: (err) => {
        logger.error(`[Batch Orchestrator] Lỗi ngoại lệ không mong muốn ở batch ${batchId}:`, err);
      },
    });
  }

  async _executeBatchLoop(batchState, resolvedFeatures, { variables, abortController }) {
    const signal = abortController.signal;
    const batchStartMs = Date.now();
    let persistChain = Promise.resolve();

    const saveProgress = () => {
      const snapshot = {
        ...batchState,
        features: batchState.features.map((f) => ({
          ...f,
          steps: [...(f.steps || [])],
          stepResults: Array.isArray(f.stepResults) ? f.stepResults.map((s) => ({ ...s })) : [],
        })),
      };
      persistChain = persistChain
        .then(() => this.history.saveRun(snapshot))
        .catch((err) => {
          logger.warn(`[Batch Orchestrator] Lỗi cập nhật tiến độ batch ${batchState.id}: ${err.message}`);
        });
      return persistChain;
    };

    try {
      for (let i = 0; i < resolvedFeatures.length; i++) {
        if (signal.aborted) {
          for (let j = i; j < batchState.features.length; j++) {
            const slot = batchState.features[j];
            if (slot.status === "PENDING" || slot.status === "RUNNING") {
              slot.status = "SKIPPED";
              slot.error = slot.error || "Đã hủy";
            }
          }
          break;
        }

        this.lock.touch();
        const feat = resolvedFeatures[i];
        const featSlot = batchState.features[i];
        const featStartMs = Date.now();

        featSlot.status = "RUNNING";
        await saveProgress();

        const descText = feat.steps.length > 0 ? feat.steps.join("\n") : feat.name;
        const screenshotDirId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        featSlot.screenshotDir = screenshotDirId;

        try {
          const plan = await this.stepPlanner.prepareExecutionPlan(
            descText,
            signal,
            feat.steps.length > 0 ? feat.steps : null
          );

          if (signal.aborted) {
            featSlot.status = "SKIPPED";
            featSlot.durationMs = Math.max(0, Date.now() - featStartMs);
            featSlot.error = "Đã hủy";
            break;
          }

          const runResult = {
            id: screenshotDirId,
            batchId: batchState.id,
            status: "running",
            startedAt: new Date().toISOString(),
            finishedAt: null,
            projectId: batchState.projectId,
            projectName: batchState.projectName,
            featureId: feat.id,
            featureName: feat.name,
            description: descText,
            plan: plan.steps,
            planNotes: plan.notes,
            steps: [],
            error: null,
          };

          const execCtx = await this.projects.getExecutionContext(
            batchState.projectId,
            feat.sessionMode,
            variables
          );

          await this.engine.runSteps(plan.steps, execCtx.mergedVars, runResult, signal, {
            batchId: batchState.id,
            featureIndex: i,
            persistSession: execCtx.persistSession,
            storageStatePath: execCtx.storageStatePath,
            secretKeys: execCtx.secretKeys,
            onActivity: () => this.lock.touch(),
            onStepComplete: async () => {
              this.lock.touch();
              if (!signal.aborted) {
                featSlot.stepResults = normalizeStepResults(runResult.steps);
                await saveProgress();
              }
            },
          });

          const featDuration = Math.max(0, Date.now() - featStartMs);
          featSlot.durationMs = featDuration;
          const formattedSteps = normalizeStepResults(runResult.steps);

          if (signal.aborted || runResult.failureType === "CANCELLED") {
            featSlot.stepResults = formattedSteps;
            featSlot.status = "SKIPPED";
            featSlot.error = "Đã hủy";
            for (let j = i + 1; j < batchState.features.length; j++) {
              if (batchState.features[j].status === "PENDING") {
                batchState.features[j].status = "SKIPPED";
                batchState.features[j].error = "Đã hủy";
              }
            }
            break;
          }

          const isPassed = runResult.status === "passed";
          if (formattedSteps.length > 0) {
            featSlot.stepResults = formattedSteps;
            featSlot.steps = formattedSteps.map((s) => s.text);
          } else {
            featSlot.stepResults = (feat.steps || []).map((s) => ({
              text: s,
              status: isPassed ? "passed" : "failed",
              error: !isPassed ? (runResult.error || "Không thành công") : undefined,
            }));
          }

          featSlot.status = isPassed ? "PASSED" : "FAILED";
          featSlot.verdict = runResult.verdict || (isPassed ? "PASSED" : "FAILED");
          featSlot.assertionSummary = runResult.assertionSummary || null;
          featSlot.error = isPassed ? null : (runResult.error || "Không thành công");
        } catch (err) {
          const featDuration = Math.max(0, Date.now() - featStartMs);
          featSlot.durationMs = featDuration;

          if (signal.aborted || err.name === "AbortError") {
            featSlot.status = "SKIPPED";
            featSlot.error = "Đã hủy";
            for (let j = i + 1; j < batchState.features.length; j++) {
              if (batchState.features[j].status === "PENDING") {
                batchState.features[j].status = "SKIPPED";
                batchState.features[j].error = "Đã hủy";
              }
            }
            break;
          }

          featSlot.status = "ERROR";
          featSlot.error = err.message || "Lỗi thực thi";
          if (!Array.isArray(featSlot.stepResults) || featSlot.stepResults.length === 0) {
            featSlot.stepResults = (feat.steps || []).map((s, sIdx) => ({
              text: s,
              status: "failed",
              error: sIdx === 0 ? featSlot.error : undefined,
            }));
          }
        }

        await saveProgress();
      }
    } finally {
      const totalDuration = Math.max(0, Date.now() - batchStartMs);
      batchState.status = "Kết thúc";
      batchState.finishedAt = new Date().toISOString();
      batchState.duration = totalDuration;
      batchState.durationMs = totalDuration;
      batchState.features = batchState.features.map((f) =>
        f.status === "PENDING" || f.status === "RUNNING"
          ? { ...f, status: "SKIPPED", error: f.error || (signal.aborted ? "Đã hủy" : "Không hoàn tất") }
          : f
      );

      await saveProgress();
      this._activeBatchId = null;
      logger.info(
        `[Batch Orchestrator] Kết thúc đợt chạy ${batchState.id} (${totalDuration}ms, aborted=${signal.aborted})`
      );
    }
  }

  /**
   * Hủy đợt chạy đồng bộ: đợi AbortController + closeInstances + cập nhật DB + nhả lock hoàn tất rồi mới trả về
   */
  async abortBatch(batchId, { ownerToken = null, force = false } = {}) {
    if (!this.lock.isBusy) {
      const existing = batchId ? await this.history.getById(batchId) : null;
      return {
        success: true,
        alreadyFinished: true,
        message: "Đợt chạy đã kết thúc trước đó",
        batch: existing,
        runner: this.lock.status,
      };
    }

    const activeId = this.activeBatchId;
    if (batchId && activeId && activeId !== batchId) {
      throw new ConflictError(`Đợt chạy đang thực thi (${activeId}) khác với đợt chạy yêu cầu hủy (${batchId}).`);
    }

    const cancelResult = await this.lock.cancelCurrentAndWait(ownerToken, force, 15000);
    if (cancelResult.forbidden) {
      return cancelResult;
    }

    const updatedBatch = batchId ? await this.history.getById(batchId) : null;
    return {
      ...cancelResult,
      batch: updatedBatch,
      runner: this.lock.status,
    };
  }

  /**
   * Trả về trạng thái Live Telemetry tổng hợp cho 1 batch (bao gồm bản ghi batch từ SQLite + engine liveRun)
   */
  async getBatchLiveStatus(batchId) {
    const batch = batchId ? await this.history.getById(batchId) : null;
    if (batchId && !batch) {
      throw new NotFoundError(`Không tìm thấy đợt chạy với id: ${batchId}`);
    }

    const rawLive = this.engine.getLiveStatus();
    const currentActiveBatchId = this.activeBatchId;
    const isThisBatchLive = Boolean(
      rawLive &&
      ((rawLive.batchId && rawLive.batchId === batchId) ||
        (!rawLive.batchId && currentActiveBatchId === batchId))
    );

    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      batchId: batchId || currentActiveBatchId,
      activeBatchId: currentActiveBatchId,
      runner: this.lock.status,
      batch,
      liveRun: isThisBatchLive ? rawLive : null,
    };
  }
}

export const batchRunnerService = new BatchRunnerService();

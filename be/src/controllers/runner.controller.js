import { runnerService } from "../services/runner.service.js";
import { batchRunnerService } from "../services/batch-runner.service.js";
import { runnerLock } from "../utils/asyncLock.js";
import { logger } from "../utils/logger.js";
import { BadRequestError } from "../errors/AppError.js";

export class RunnerController {
  constructor(service = runnerService, lock = runnerLock, batchService = batchRunnerService) {
    this.service = service;
    this.lock = lock;
    this.batchService = batchService;
  }

  /**
   * POST /run - Thực thi kịch bản kiểm thử trên Native Playwright + Micro-ReAct Engine
   */
  run = async (req, res, next) => {
    const abortController = new AbortController();

    const onClose = () => {
      if (!res.writableEnded) {
        if (req.headers["x-abort-on-disconnect"] === "true") {
          logger.warn("Client đã ngắt kết nối (yêu cầu abort-on-disconnect). Đang hủy phiên kiểm thử...");
          abortController.abort(new Error("Client disconnected"));
        } else {
          logger.info(
            "Client ngắt kết nối HTTP socket (có thể do chuyển tab/tiết kiệm RAM). Phiên kiểm thử vẫn duy trì chạy ngầm và bảo lưu kết quả vào Lịch sử."
          );
        }
      }
    };

    res.on("close", onClose);

    try {
      const {
        description,
        steps,
        variables,
        dryRun,
        projectId,
        projectName,
        featureId,
        featureName,
        ownerToken,
      } = req.body;
      const result = await this.service.execute({
        description,
        steps,
        variables,
        dryRun,
        projectId,
        projectName,
        featureId,
        featureName,
        ownerToken: ownerToken || req.headers["x-run-token"] || null,
        abortController,
        signal: abortController.signal,
      });

      if (!res.writableEnded) {
        res.status(200).json(result);
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        logger.info("Phiên kiểm thử đã được hủy thành công theo tín hiệu ngắt kết nối.");
        if (!res.writableEnded) {
          res.status(499).end();
        }
        return;
      }
      next(err);
    } finally {
      res.off("close", onClose);
    }
  };

  /**
   * POST /run/abort - Hủy phiên kiểm thử & chờ giải phóng lock + cập nhật DB hoàn tất
   */
  abort = async (req, res) => {
    const token = req.body?.ownerToken || req.headers["x-run-token"] || null;
    const force = Boolean(req.body?.force);
    const result = await this.lock.cancelCurrentAndWait(token, force, 15000);
    if (result.forbidden) {
      return res.status(403).json(result);
    }
    return res.status(200).json(result);
  };

  /**
   * GET /run/live - Theo dõi tiến độ từng bước & suy luận AI theo thời gian thực (kèm Batch nếu đang chạy Batch)
   */
  getLive = async (req, res) => {
    const activeBatchId = this.batchService.activeBatchId;
    const liveRun = this.service.getLiveStatus();
    let batch = null;
    if (activeBatchId) {
      batch = await this.service.history.getById(activeBatchId).catch(() => null);
    }
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      activeBatchId,
      runner: this.lock.status,
      batch,
      liveRun,
    });
  };

  /**
   * POST /steps/split - Tách đoạn văn bản tiếng Việt thành các bước kiểm thử tuần tự (cục bộ hoặc AI)
   */
  splitSteps = async (req, res, next) => {
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abortController.abort();
    });

    try {
      const { text, description, mode } = req.body || {};
      const inputText = String(text ?? description ?? "").trim();
      if (!inputText) {
        return next(new BadRequestError("Vui lòng nhập đoạn văn bản kịch bản cần tách bước."));
      }

      const validMode = mode === "fast" || mode === "ai" || mode === "smart" ? mode : "smart";
      const result = await this.service.stepPlanner.splitRawText(
        inputText,
        { mode: validMode },
        abortController.signal
      );

      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /cache - Liệt kê các bước đang lưu trong Step Trace Cache
   */
  listCache = async (req, res, next) => {
    try {
      const { projectId, featureId, routePath } = req.query || {};
      const entries = await this.service.cache.listEntries({
        projectId: projectId ? String(projectId) : undefined,
        featureId: featureId ? String(featureId) : undefined,
        routePath: routePath ? String(routePath) : undefined,
      });
      res.status(200).json({
        success: true,
        total: entries.length,
        entries,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * DELETE /cache - Xóa Step Trace Cache (toàn bộ, theo dự án, tính năng, routePath hoặc từng bước)
   */
  clearCache = async (req, res, next) => {
    try {
      const src = { ...(req.query || {}), ...(req.body || {}) };
      const all = src.all === true || src.all === "true";
      const result = await this.service.cache.clearCache({
        key: src.key ? String(src.key) : undefined,
        projectId: src.projectId ? String(src.projectId) : undefined,
        featureId: src.featureId ? String(src.featureId) : undefined,
        routePath: src.routePath ? String(src.routePath) : undefined,
        stepText: src.stepText ? String(src.stepText) : undefined,
        all,
      });

      res.status(200).json({
        success: true,
        ...result,
        message:
          result.deletedCount > 0
            ? `Đã xóa ${result.deletedCount} mục ghi nhớ Cache.`
            : "Không có mục Cache nào phù hợp để xóa.",
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /status hoặc /health - Trạng thái hệ thống, Local LLM, Lock & Live summary
   */
  getStatus = async (req, res) => {
    let llmStatus = "unknown";
    const { baseUrl, apiKey, model } = this.service.llm.config.llm;
    try {
      const llmUrl = `${baseUrl}/models`;
      const response = await fetch(llmUrl, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(3500),
      });
      if (response.ok) {
        llmStatus = "online";
      } else if (response.status === 401 || response.status === 403) {
        llmStatus = "auth_error";
      } else if (response.status === 404 || response.status === 405) {
        llmStatus = "online";
      } else {
        llmStatus = "error";
      }
    } catch {
      llmStatus = "offline";
    }

    const liveRun = this.service.getLiveStatus();
    const activeBatchId = this.batchService.activeBatchId;
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      llm: {
        status: llmStatus,
        model,
        baseUrl,
      },
      activeBatchId,
      runner: this.lock.status,
      liveRun: liveRun
        ? {
            runId: liveRun.runId,
            batchId: liveRun.batchId || activeBatchId || null,
            projectId: liveRun.projectId,
            featureId: liveRun.featureId,
            featureName: liveRun.featureName,
            featureIndex: liveRun.featureIndex ?? null,
            totalSteps: liveRun.totalSteps,
            currentStepIndex: liveRun.currentStepIndex,
            currentStepText: liveRun.currentStepText,
            currentLayer: liveRun.currentLayer,
            currentTurn: liveRun.currentTurn,
            maxTurns: liveRun.maxTurns,
          }
        : null,
    });
  };
}

export const runnerController = new RunnerController();

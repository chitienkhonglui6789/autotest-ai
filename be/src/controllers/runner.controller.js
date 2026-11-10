import { runnerService } from "../services/runner.service.js";
import { runnerLock } from "../utils/asyncLock.js";
import { logger } from "../utils/logger.js";

export class RunnerController {
  constructor(service = runnerService, lock = runnerLock) {
    this.service = service;
    this.lock = lock;
  }

  /**
   * POST /run - Có cơ chế nhận diện ngắt kết nối (Client Disconnect) để hủy tác vụ giải phóng tài nguyên
   */
  run = async (req, res, next) => {
    const abortController = new AbortController();

    const onClose = () => {
      if (!res.writableEnded) {
        logger.warn("Client đã ngắt kết nối (đóng tab/hủy request). Đang hủy phiên kiểm thử và thu hồi tài nguyên...");
        abortController.abort(new Error("Client disconnected"));
      }
    };

    res.on("close", onClose);

    try {
      const { description, variables, dryRun, projectId, projectName, featureId, featureName } = req.body;
      const result = await this.service.execute({
        description,
        variables,
        dryRun,
        projectId,
        projectName,
        featureId,
        featureName,
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
   * GET /status hoặc /health - Trạng thái hệ thống, Local LLM & Lock
   */
  getStatus = async (req, res) => {
    let llmStatus = "unknown";
    try {
      const { baseUrl, apiKey } = this.service.classifier.llm.config.llm;
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
        // Nhiều LLM local chỉ mở endpoint /chat/completions mà không hỗ trợ /models
        llmStatus = "online";
      } else {
        llmStatus = "error";
      }
    } catch {
      llmStatus = "offline";
    }

    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      llm: {
        status: llmStatus,
        model: this.service.classifier.llm.config.llm.model,
      },
      runner: this.lock.status,
    });
  };
}

export const runnerController = new RunnerController();


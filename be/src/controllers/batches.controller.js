import { batchRunnerService } from "../services/batch-runner.service.js";

export class BatchesController {
  constructor(service = batchRunnerService) {
    this.service = service;
  }

  /**
   * POST /batches/start (hoặc POST /run/batch)
   */
  start = async (req, res, next) => {
    try {
      const {
        projectId,
        projectName,
        features,
        featureIds,
        name,
        notes,
        variables,
        ownerToken,
      } = req.body || {};

      const result = await this.service.startBatch({
        projectId,
        projectName,
        features,
        featureIds,
        name,
        notes,
        variables,
        ownerToken: ownerToken || req.headers["x-run-token"] || null,
      });

      res.status(202).json({
        success: true,
        batchId: result.batchId,
        batch: result.batch,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /batches/:id/abort - Hủy đợt chạy và chờ nhả lock + cập nhật DB hoàn tất
   */
  abort = async (req, res, next) => {
    try {
      const { id } = req.params;
      const ownerToken = req.body?.ownerToken || req.headers["x-run-token"] || null;
      const force = Boolean(req.body?.force);

      const result = await this.service.abortBatch(id, { ownerToken, force });
      if (result.forbidden) {
        return res.status(403).json(result);
      }

      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /batches/:id/live - Lấy toàn bộ tiến độ Batch từ SQLite + Live Telemetry bước đang chạy
   */
  getLive = async (req, res, next) => {
    try {
      const { id } = req.params;
      const payload = await this.service.getBatchLiveStatus(id);
      return res.status(200).json(payload);
    } catch (err) {
      next(err);
    }
  };
}

export const batchesController = new BatchesController();

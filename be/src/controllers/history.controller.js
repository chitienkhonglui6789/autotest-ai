import { historyService } from "../services/history.service.js";
import { runnerLock } from "../utils/asyncLock.js";
import { reportService } from "../services/report.service.js";

export class HistoryController {
  constructor(service = historyService, lock = runnerLock, reporter = reportService) {
    this.service = service;
    this.lock = lock;
    this.reporter = reporter;
  }

  getAll = async (req, res, next) => {
    try {
      if (!this.lock.isBusy) {
        await this.service.finalizeStaleRunningBatches({
          isRunnerBusy: false,
          staleGraceMs: 15000,
        }).catch(() => {});
      }

      const { projectId, featureId, status, search, type, limit, offset } = req.query;
      const parsedLimit = limit !== undefined && limit !== "" ? Number(limit) : 50;
      const parsedOffset = offset !== undefined && offset !== "" ? Number(offset) : 0;

      const result = await this.service.getPaginated({
        projectId: projectId ? String(projectId) : undefined,
        featureId: featureId ? String(featureId) : undefined,
        status: status ? String(status) : undefined,
        search: search ? String(search) : undefined,
        type: type ? String(type) : "batches",
        limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50,
        offset: Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0,
      });

      res.status(200).json({
        success: true,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore,
        runs: result.runs,
      });
    } catch (err) {
      next(err);
    }
  };

  getById = async (req, res, next) => {
    try {
      const { id } = req.params;
      const run = await this.service.getById(id);

      if (!run) {
        return res.status(404).json({
          success: false,
          error: `Không tìm thấy phiên chạy với id: ${id}`,
        });
      }

      res.status(200).json({
        success: true,
        run,
      });
    } catch (err) {
      next(err);
    }
  };

  save = async (req, res, next) => {
    try {
      const body = req.body;
      if (Array.isArray(body)) {
        const saved = await this.service.saveMultipleRuns(body);
        return res.status(200).json({
          success: true,
          savedCount: saved.length,
          runs: saved,
        });
      }

      const saved = await this.service.saveRun(body);
      res.status(201).json({
        success: true,
        run: saved,
      });
    } catch (err) {
      next(err);
    }
  };

  deleteById = async (req, res, next) => {
    try {
      const { id } = req.params;
      const deleted = await this.service.deleteById(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: `Không tìm thấy hoặc không thể xóa phiên chạy: ${id}`,
        });
      }

      res.status(200).json({
        success: true,
        message: `Đã xóa thành công phiên chạy: ${id}`,
      });
    } catch (err) {
      next(err);
    }
  };

  clear = async (req, res, next) => {
    try {
      const { projectId } = req.query;
      const count = await this.service.clear({
        projectId: projectId ? String(projectId) : undefined,
      });

      res.status(200).json({
        success: true,
        message: `Đã xóa ${count} phiên chạy khỏi lịch sử`,
        count,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /history/:id/report - Trả về file HTML độc lập chứa đầy đủ thông tin và ảnh Base64
   */
  exportReport = async (req, res, next) => {
    try {
      const { id } = req.params;
      const run = await this.service.getById(id);

      if (!run) {
        return res.status(404).json({
          success: false,
          error: `Không tìm thấy phiên chạy với id: ${id}`,
        });
      }

      const html = await this.reporter.generateHtmlReport(run);
      const rawTitle = run.name || run.featureName || "test_report";
      const asciiTitle = String(rawTitle)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D");
      const safeName =
        asciiTitle
          .replace(/[^\w\s-]/gi, "")
          .trim()
          .replace(/\s+/g, "_")
          .toLowerCase() || "report";
      const filename = `report_${safeName}_${id}.html`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(html);
    } catch (err) {
      next(err);
    }
  };
}

export const historyController = new HistoryController();

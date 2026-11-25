import { logger } from "../utils/logger.js";
import { storageService } from "./storage.service.js";
import { getDatabase, runInTransaction } from "../db/database.js";
import {
  extractScreenshotsFromSteps,
  parseTimestampMs,
  safeJsonParse,
} from "../db/helpers.js";

function escapeLike(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function normalizeStepObject(st, idx) {
  const screenshots = Array.isArray(st.screenshots)
    ? st.screenshots.map((s) => ({
        type: s.type || "after",
        label: s.label || (s.type === "before" ? "Trước khi hành động" : "Sau khi hành động"),
        sublabel: s.sublabel || (s.type === "before" ? "Highlight phần tử" : "Kết quả tương tác"),
        url: s.url,
      }))
    : st.screenshotUrl
      ? [
          {
            type: "after",
            label: "Ảnh chụp",
            sublabel: "Kết quả",
            url: st.screenshotUrl,
          },
        ]
      : [];

  return {
    ...st,
    index: st.index || idx + 1,
    type: st.type || "act",
    text: st.text || st.step || "",
    isSoft: Boolean(st.isSoft),
    executionMode: st.executionMode || null,
    status: st.status === "passed" ? "passed" : "failed",
    message: st.message || st.error || null,
    error: st.error || (st.status !== "passed" ? st.message : null),
    failureType: st.failureType || null,
    detectedAlert: st.detectedAlert || null,
    actionsLog: Array.isArray(st.actionsLog) ? st.actionsLog : undefined,
    durationMs: st.durationMs || 0,
    screenshotUrl: st.screenshotUrl || null,
    screenshots,
  };
}

export class HistoryService {
  constructor(db = null, storage = storageService) {
    this._db = db;
    this._storage = storage;
    this._reconciledOnBoot = false;
  }

  _getDb() {
    const db = this._db || getDatabase();
    if (!this._reconciledOnBoot) {
      this._reconciledOnBoot = true;
      try {
        this._reconcileStaleRunningBatchesSync(db, { staleGraceMs: 0 });
      } catch (err) {
        logger.debug("[SQLite] Lỗi dọn batch kẹt khi khởi động:", err.message);
      }
    }
    return db;
  }

  _hydrateFeatureRunRow(row) {
    if (!row) return null;
    const extra = safeJsonParse(row.extra_json, {});
    return {
      ...extra,
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      featureId: row.feature_id || null,
      featureName: row.feature_name,
      name: row.feature_name,
      description: row.description || "",
      status: row.status,
      error: row.error || null,
      plan: safeJsonParse(row.plan_json, []),
      planNotes: row.plan_notes || "",
      steps: safeJsonParse(row.steps_json, []),
      totalSteps: Number(row.total_steps || 0),
      passedSteps: Number(row.passed_steps || 0),
      failedSteps: Number(row.failed_steps || 0),
      timestamp: row.timestamp,
      startedAt: row.started_at,
      finishedAt: row.finished_at || null,
      duration: Number(row.duration_ms || 0),
      durationMs: Number(row.duration_ms || 0),
    };
  }

  _hydrateBatchFeatureRow(row) {
    const extra = safeJsonParse(row.extra_json, {});
    const feature = {
      ...extra,
      id: row.feature_id,
      name: row.feature_name,
      status: row.status,
      steps: safeJsonParse(row.steps_json, []),
      stepResults: safeJsonParse(row.step_results_json, []),
      durationMs: Number(row.duration_ms || 0),
      error: row.error || null,
    };
    if (row.linked_run_id) {
      feature.runId = row.linked_run_id;
    }
    return feature;
  }

  _hydrateBatchRow(row, featureRows = []) {
    if (!row) return null;
    const extra = safeJsonParse(row.extra_json, {});
    return {
      ...extra,
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      name: row.name,
      status: row.status,
      notes: row.notes || "",
      warning: row.warning || null,
      timestamp: row.timestamp,
      startedAt: row.started_at,
      finishedAt: row.finished_at || null,
      duration: Number(row.duration_ms || 0),
      durationMs: Number(row.duration_ms || 0),
      passedCount: Number(row.passed_count || 0),
      failedCount: Number(row.failed_count || 0),
      skippedCount: Number(row.skipped_count || 0),
      totalCount: Number(row.total_count || featureRows.length),
      features: featureRows.map((fr) => this._hydrateBatchFeatureRow(fr)),
    };
  }

  _reconcileStaleRunningBatchesSync(db, { staleGraceMs = 15000 } = {}) {
    const runningBatches = db
      .prepare("SELECT id, timestamp, started_at, started_at_ms, finished_at FROM batches WHERE status = 'Đang chạy'")
      .all();
    if (runningBatches.length === 0) return 0;

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const toFinalize = runningBatches.filter((b) => {
      const startMs = b.started_at_ms || parseTimestampMs(b.started_at || b.timestamp, 0);
      if (staleGraceMs > 0 && Number.isFinite(startMs) && startMs > 0 && nowMs - startMs < staleGraceMs) {
        return false;
      }
      return true;
    });

    if (toFinalize.length === 0) return 0;

    return runInTransaction(db, () => {
      const updateBatch = db.prepare(
        `UPDATE batches
         SET status = 'Kết thúc',
             finished_at = COALESCE(finished_at, ?),
             skipped_count = (
               SELECT COUNT(*) FROM batch_features WHERE batch_id = batches.id AND status = 'SKIPPED'
             )
         WHERE id = ?`
      );
      const updateFeat = db.prepare(
        `UPDATE batch_features
         SET status = 'SKIPPED',
             error = COALESCE(NULLIF(error, ''), 'Phiên chạy đã kết thúc hoặc bị gián đoạn trước đó')
         WHERE batch_id = ? AND status IN ('RUNNING', 'PENDING')`
      );

      for (const b of toFinalize) {
        updateFeat.run(b.id);
        updateBatch.run(nowIso, b.id);
      }
      logger.info(`[SQLite] Đã tự động đóng ${toFinalize.length} phiên kiểm thử bị gián đoạn.`);
      return toFinalize.length;
    });
  }

  /**
   * Chuẩn hóa trạng thái các batch còn kẹt "Đang chạy" khi máy chủ đang rảnh
   */
  async finalizeStaleRunningBatches({ isRunnerBusy = false, staleGraceMs = 15000 } = {}) {
    if (isRunnerBusy) return 0;
    const db = this._getDb();
    return this._reconcileStaleRunningBatchesSync(db, { staleGraceMs });
  }

  /**
   * Tự động dọn dẹp thư mục screenshots cũ hoặc mồ côi dựa trên danh sách active từ SQLite
   */
  async cleanupScreenshots() {
    try {
      const db = this._getDb();
      const shotDirs = db.prepare("SELECT DISTINCT dir_name FROM run_screenshots").all();
      const runIds = db.prepare("SELECT id FROM feature_runs").all();
      const batchIds = db.prepare("SELECT id FROM batches").all();

      const activeDirs = new Set();
      for (const r of shotDirs) {
        if (r.dir_name) activeDirs.add(r.dir_name);
      }
      for (const r of runIds) {
        if (r.id) activeDirs.add(r.id);
      }
      for (const b of batchIds) {
        if (b.id) activeDirs.add(b.id);
      }

      await this._storage.cleanupRetention(activeDirs);
    } catch (cleanErr) {
      logger.debug("Lỗi trong quá trình dọn dẹp screenshots:", cleanErr.message);
    }
  }

  /**
   * Truy vấn lịch sử có phân trang và tìm kiếm trực tiếp bằng SQL.
   * @param {{ projectId?: string, featureId?: string, status?: string, search?: string, type?: "batches"|"runs", limit?: number, offset?: number }} [options]
   */
  async getPaginated({
    projectId,
    featureId,
    status,
    search,
    type = "batches",
    limit = 50,
    offset = 0,
  } = {}) {
    const db = this._getDb();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 10000));
    const safeOffset = Math.max(0, Number(offset) || 0);

    if (type === "runs") {
      return this._queryFeatureRuns(db, {
        projectId,
        featureId,
        status,
        search,
        limit: safeLimit,
        offset: safeOffset,
      });
    }

    return this._queryBatches(db, {
      projectId,
      featureId,
      status,
      search,
      limit: safeLimit,
      offset: safeOffset,
    });
  }

  _queryBatches(db, { projectId, featureId, status, search, limit, offset }) {
    const whereClauses = ["1 = 1"];
    const params = [];

    if (projectId) {
      whereClauses.push("b.project_id = ?");
      params.push(String(projectId));
    }

    if (featureId) {
      whereClauses.push(
        "EXISTS (SELECT 1 FROM batch_features bf WHERE bf.batch_id = b.id AND bf.feature_id = ?)"
      );
      params.push(String(featureId));
    }

    if (status) {
      if (status === "passed") {
        whereClauses.push("b.failed_count = 0 AND b.passed_count > 0");
      } else if (status === "failed") {
        whereClauses.push("b.failed_count > 0");
      } else {
        whereClauses.push("b.status = ?");
        params.push(String(status));
      }
    }

    if (search && typeof search === "string" && search.trim()) {
      const pattern = `%${escapeLike(search.trim())}%`;
      whereClauses.push(
        `(
          LOWER(b.name) LIKE ? ESCAPE '\\' OR
          LOWER(b.project_name) LIKE ? ESCAPE '\\' OR
          LOWER(b.notes) LIKE ? ESCAPE '\\' OR
          EXISTS (
            SELECT 1 FROM batch_features bf
            WHERE bf.batch_id = b.id AND LOWER(bf.feature_name) LIKE ? ESCAPE '\\'
          )
        )`
      );
      params.push(pattern, pattern, pattern, pattern);
    }

    const whereSql = whereClauses.join(" AND ");
    const total =
      db.prepare(`SELECT COUNT(*) AS cnt FROM batches b WHERE ${whereSql}`).get(...params)?.cnt || 0;

    const batchRows = db
      .prepare(
        `SELECT b.*
         FROM batches b
         WHERE ${whereSql}
         ORDER BY
           CASE WHEN b.status = 'Đang chạy' THEN 0 ELSE 1 END ASC,
           b.started_at_ms DESC,
           b.rowid DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    if (batchRows.length === 0) {
      return {
        runs: [],
        total,
        limit,
        offset,
        hasMore: false,
      };
    }

    const batchIds = batchRows.map((b) => b.id);
    const placeholders = batchIds.map(() => "?").join(", ");
    const featureRows = db
      .prepare(
        `SELECT * FROM batch_features
         WHERE batch_id IN (${placeholders})
         ORDER BY batch_id ASC, order_index ASC, rowid ASC`
      )
      .all(...batchIds);

    const featuresByBatch = new Map();
    for (const fr of featureRows) {
      if (!featuresByBatch.has(fr.batch_id)) {
        featuresByBatch.set(fr.batch_id, []);
      }
      featuresByBatch.get(fr.batch_id).push(fr);
    }

    const runs = batchRows.map((b) => this._hydrateBatchRow(b, featuresByBatch.get(b.id) || []));

    return {
      runs,
      total,
      limit,
      offset,
      hasMore: offset + runs.length < total,
    };
  }

  _queryFeatureRuns(db, { projectId, featureId, status, search, limit, offset }) {
    const whereClauses = ["1 = 1"];
    const params = [];

    if (projectId) {
      whereClauses.push("project_id = ?");
      params.push(String(projectId));
    }
    if (featureId) {
      whereClauses.push("feature_id = ?");
      params.push(String(featureId));
    }
    if (status && (status === "passed" || status === "failed")) {
      whereClauses.push("status = ?");
      params.push(status);
    }
    if (search && typeof search === "string" && search.trim()) {
      const pattern = `%${escapeLike(search.trim())}%`;
      whereClauses.push(
        `(
          LOWER(feature_name) LIKE ? ESCAPE '\\' OR
          LOWER(project_name) LIKE ? ESCAPE '\\' OR
          LOWER(description) LIKE ? ESCAPE '\\' OR
          LOWER(steps_json) LIKE ? ESCAPE '\\'
        )`
      );
      params.push(pattern, pattern, pattern, pattern);
    }

    const whereSql = whereClauses.join(" AND ");
    const total =
      db.prepare(`SELECT COUNT(*) AS cnt FROM feature_runs WHERE ${whereSql}`).get(...params)?.cnt || 0;

    const rows = db
      .prepare(
        `SELECT *
         FROM feature_runs
         WHERE ${whereSql}
         ORDER BY started_at_ms DESC, rowid DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    const runs = rows.map((r) => this._hydrateFeatureRunRow(r));
    return {
      runs,
      total,
      limit,
      offset,
      hasMore: offset + runs.length < total,
    };
  }

  /**
   * Lấy danh sách lịch sử với bộ lọc (giữ chữ ký tương thích ngược trả về Array)
   */
  async getAll(options = {}) {
    const { runs } = await this.getPaginated(options);
    return runs;
  }

  /**
   * Lấy chi tiết một phiên chạy (batch hoặc standalone run) theo id
   */
  async getById(id) {
    if (!id) return null;
    const db = this._getDb();

    const batchRow = db.prepare("SELECT * FROM batches WHERE id = ?").get(String(id));
    if (batchRow) {
      const featRows = db
        .prepare("SELECT * FROM batch_features WHERE batch_id = ? ORDER BY order_index ASC, rowid ASC")
        .all(String(id));
      return this._hydrateBatchRow(batchRow, featRows);
    }

    const runRow = db.prepare("SELECT * FROM feature_runs WHERE id = ?").get(String(id));
    if (runRow) {
      return this._hydrateFeatureRunRow(runRow);
    }

    return null;
  }

  _saveSingleRecordSync(db, runData) {
    if (!runData || !runData.id) {
      throw new Error("runData phải có id hợp lệ");
    }

    if (Array.isArray(runData.features)) {
      return this._saveBatchSync(db, runData);
    }
    return this._saveFeatureRunSync(db, runData);
  }

  _saveFeatureRunSync(db, runData) {
    const id = String(runData.id);
    const existingRow = db.prepare("SELECT * FROM feature_runs WHERE id = ?").get(id);
    const existing = existingRow ? this._hydrateFeatureRunRow(existingRow) : null;
    const merged = existing ? { ...existing, ...runData } : { ...runData };

    const now = new Date().toISOString();
    const timestamp = merged.timestamp || merged.startedAt || now;
    const startedAt = merged.startedAt || timestamp;
    const startedAtMs = parseTimestampMs(startedAt || timestamp, Date.now());
    const finishedAt =
      merged.status === "Đang chạy" ? (merged.finishedAt || null) : (merged.finishedAt || now);

    const steps = Array.isArray(merged.steps)
      ? merged.steps.map((st, idx) => normalizeStepObject(st, idx))
      : [];

    const passedSteps = Number.isFinite(Number(merged.passedSteps))
      ? Number(merged.passedSteps)
      : steps.filter((s) => s.status === "passed").length;
    const failedSteps = Number.isFinite(Number(merged.failedSteps))
      ? Number(merged.failedSteps)
      : steps.filter((s) => s.status !== "passed").length;
    const totalSteps = Number.isFinite(Number(merged.totalSteps))
      ? Number(merged.totalSteps)
      : steps.length;

    const {
      id: _id, projectId, projectName, featureId, featureName, name: _name,
      description, status, error, plan, planNotes, steps: _steps,
      totalSteps: _ts, passedSteps: _ps, failedSteps: _fs,
      timestamp: _t, startedAt: _sa, finishedAt: _fa, duration, durationMs,
      ...extraRun
    } = merged;

    db.prepare(
      `INSERT INTO feature_runs (
         id, project_id, project_name, feature_id, feature_name, description,
         status, error, plan_json, plan_notes, steps_json,
         total_steps, passed_steps, failed_steps,
         timestamp, started_at, started_at_ms, finished_at, duration_ms, extra_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id,
         project_name = excluded.project_name,
         feature_id = excluded.feature_id,
         feature_name = excluded.feature_name,
         description = excluded.description,
         status = excluded.status,
         error = excluded.error,
         plan_json = excluded.plan_json,
         plan_notes = excluded.plan_notes,
         steps_json = excluded.steps_json,
         total_steps = excluded.total_steps,
         passed_steps = excluded.passed_steps,
         failed_steps = excluded.failed_steps,
         finished_at = excluded.finished_at,
         duration_ms = excluded.duration_ms,
         extra_json = excluded.extra_json`
    ).run(
      id,
      String(projectId || "default"),
      String(projectName || "Dự án kiểm thử"),
      featureId ? String(featureId) : null,
      String(featureName || merged.name || "Kiểm thử tự động"),
      String(description || ""),
      String(status || "failed"),
      error ? String(error) : null,
      JSON.stringify(Array.isArray(plan) ? plan : []),
      String(planNotes || ""),
      JSON.stringify(steps),
      totalSteps,
      passedSteps,
      failedSteps,
      timestamp,
      startedAt,
      startedAtMs,
      finishedAt,
      Number(durationMs ?? duration ?? 0) || 0,
      JSON.stringify(extraRun || {})
    );

    db.prepare("DELETE FROM run_screenshots WHERE feature_run_id = ? AND batch_id IS NULL").run(id);
    const shots = extractScreenshotsFromSteps(steps);
    const insertShot = db.prepare(
      `INSERT INTO run_screenshots (
         batch_id, feature_run_id, feature_id, dir_name, url, type, label, sublabel, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of shots) {
      insertShot.run(
        null,
        id,
        featureId ? String(featureId) : null,
        s.dirName,
        s.url,
        s.type,
        s.label,
        s.sublabel,
        timestamp
      );
    }

    return this._hydrateFeatureRunRow(db.prepare("SELECT * FROM feature_runs WHERE id = ?").get(id));
  }

  _saveBatchSync(db, batchData) {
    const id = String(batchData.id);
    const existingRow = db.prepare("SELECT * FROM batches WHERE id = ?").get(id);
    let existing = null;
    if (existingRow) {
      const existingFeats = db
        .prepare("SELECT * FROM batch_features WHERE batch_id = ? ORDER BY order_index ASC, rowid ASC")
        .all(id);
      existing = this._hydrateBatchRow(existingRow, existingFeats);
    }

    const merged = existing ? { ...existing, ...batchData } : { ...batchData };
    const now = new Date().toISOString();
    const timestamp = merged.timestamp || merged.startedAt || now;
    const startedAt = merged.startedAt || timestamp;
    const startedAtMs = parseTimestampMs(startedAt || timestamp, Date.now());
    const status = merged.status || "Kết thúc";
    const finishedAt = status === "Đang chạy" ? (merged.finishedAt || null) : (merged.finishedAt || now);

    const features = Array.isArray(merged.features) ? merged.features : [];
    const passedCount = features.filter((f) => f?.status === "PASSED").length;
    const failedCount = features.filter((f) => f?.status === "FAILED").length;
    const skippedCount = features.filter((f) => f?.status === "SKIPPED").length;

    const {
      id: _id, projectId, projectName, name, status: _st, notes, warning,
      timestamp: _t, startedAt: _sa, finishedAt: _fa, duration, durationMs,
      features: _feats, passedCount: _pc, failedCount: _fc, skippedCount: _sc, totalCount: _tc,
      ...extraBatch
    } = merged;

    db.prepare(
      `INSERT INTO batches (
         id, project_id, project_name, name, status, notes, warning,
         timestamp, started_at, started_at_ms, finished_at, duration_ms,
         passed_count, failed_count, skipped_count, total_count, extra_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id,
         project_name = excluded.project_name,
         name = excluded.name,
         status = excluded.status,
         notes = excluded.notes,
         warning = excluded.warning,
         finished_at = excluded.finished_at,
         duration_ms = excluded.duration_ms,
         passed_count = excluded.passed_count,
         failed_count = excluded.failed_count,
         skipped_count = excluded.skipped_count,
         total_count = excluded.total_count,
         extra_json = excluded.extra_json`
    ).run(
      id,
      String(projectId || "default"),
      String(projectName || "Dự án kiểm thử"),
      String(name || merged.featureName || "Đợt chạy kiểm thử"),
      String(status),
      String(notes || ""),
      warning ? String(warning) : null,
      timestamp,
      startedAt,
      startedAtMs,
      finishedAt,
      Number(durationMs ?? duration ?? 0) || 0,
      passedCount,
      failedCount,
      skippedCount,
      features.length,
      JSON.stringify(extraBatch || {})
    );

    db.prepare("DELETE FROM batch_features WHERE batch_id = ?").run(id);
    db.prepare("DELETE FROM run_screenshots WHERE batch_id = ?").run(id);

    const checkRunExists = db.prepare("SELECT 1 FROM feature_runs WHERE id = ?");
    const insertBatchFeat = db.prepare(
      `INSERT INTO batch_features (
         id, batch_id, feature_id, feature_name, linked_run_id, order_index,
         status, steps_json, step_results_json, duration_ms, error, extra_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertShot = db.prepare(
      `INSERT INTO run_screenshots (
         batch_id, feature_run_id, feature_id, dir_name, url, type, label, sublabel, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (let idx = 0; idx < features.length; idx++) {
      const f = features[idx] || {};
      const stepResults = Array.isArray(f.stepResults)
        ? f.stepResults
        : Array.isArray(f.steps) && typeof f.steps[0] === "object"
          ? f.steps
          : [];
      const shots = extractScreenshotsFromSteps(stepResults);

      const candidateRunId = f.runId || f.linkedRunId || (shots[0]?.dirName || null);
      const linkedRunId =
        candidateRunId && checkRunExists.get(String(candidateRunId)) ? String(candidateRunId) : null;

      const {
        id: featId, name: featName, featureName, runId: _rid, linkedRunId: _lrid,
        status: fStatus, steps: fSteps, stepResults: _sr,
        duration: fDur, durationMs: fDurMs, error: fErr,
        ...extraFeat
      } = f;

      insertBatchFeat.run(
        `${id}::${idx}`,
        id,
        String(featId || `feat_${idx + 1}`),
        String(featName || featureName || `Tính năng ${idx + 1}`),
        linkedRunId,
        idx,
        String(fStatus || "PASSED"),
        JSON.stringify(Array.isArray(fSteps) ? fSteps : []),
        JSON.stringify(stepResults),
        Number(fDurMs ?? fDur ?? 0) || 0,
        fErr ? String(fErr) : null,
        JSON.stringify(extraFeat || {})
      );

      for (const s of shots) {
        insertShot.run(
          id,
          linkedRunId,
          featId ? String(featId) : null,
          s.dirName,
          s.url,
          s.type,
          s.label,
          s.sublabel,
          timestamp
        );
      }
    }

    const updatedBatch = db.prepare("SELECT * FROM batches WHERE id = ?").get(id);
    const updatedFeats = db
      .prepare("SELECT * FROM batch_features WHERE batch_id = ? ORDER BY order_index ASC, rowid ASC")
      .all(id);
    return this._hydrateBatchRow(updatedBatch, updatedFeats);
  }

  /**
   * Lưu hoặc cập nhật phiên chạy (Batch hoặc Standalone Feature Run)
   */
  async saveRun(runData) {
    if (!runData || !runData.id) {
      throw new Error("runData phải có id hợp lệ");
    }

    const db = this._getDb();
    const saved = runInTransaction(db, () => this._saveSingleRecordSync(db, runData));

    this.cleanupScreenshots().catch(() => {});
    return saved;
  }

  /**
   * Lưu nhiều phiên chạy cùng lúc trong một transaction
   */
  async saveMultipleRuns(runs) {
    if (!Array.isArray(runs) || runs.length === 0) return [];
    const db = this._getDb();
    const savedList = runInTransaction(db, () => {
      const results = [];
      for (const runData of runs) {
        if (!runData || !runData.id) continue;
        results.push(this._saveSingleRecordSync(db, runData));
      }
      return results;
    });
    return savedList;
  }

  _isScreenshotDirReferencedSync(db, dirName) {
    if (db.prepare("SELECT 1 FROM run_screenshots WHERE dir_name = ? LIMIT 1").get(dirName)) {
      return true;
    }
    if (db.prepare("SELECT 1 FROM feature_runs WHERE id = ? LIMIT 1").get(dirName)) {
      return true;
    }
    if (db.prepare("SELECT 1 FROM batches WHERE id = ? LIMIT 1").get(dirName)) {
      return true;
    }
    return false;
  }

  /**
   * Xóa một Batch hoặc Feature Run và thu hồi chính xác toàn bộ thư mục ảnh thuộc về phiên chạy đó
   */
  async deleteById(id) {
    if (!id) return false;
    const db = this._getDb();
    const targetId = String(id);

    const { deleted, dirsToDelete } = runInTransaction(db, () => {
      const candidateDirs = new Set();

      const batchRow = db.prepare("SELECT id FROM batches WHERE id = ?").get(targetId);
      if (batchRow) {
        const batchShots = db
          .prepare("SELECT DISTINCT dir_name FROM run_screenshots WHERE batch_id = ?")
          .all(targetId);
        for (const s of batchShots) {
          if (s.dir_name) candidateDirs.add(s.dir_name);
        }

        const batchFeats = db
          .prepare("SELECT linked_run_id, step_results_json, extra_json FROM batch_features WHERE batch_id = ?")
          .all(targetId);

        const linkedRunIds = new Set();
        for (const bf of batchFeats) {
          const bfExtra = safeJsonParse(bf.extra_json, {});
          if (bfExtra?.screenshotDir) {
            candidateDirs.add(String(bfExtra.screenshotDir));
          }
          const stepResults = safeJsonParse(bf.step_results_json, []);
          for (const s of extractScreenshotsFromSteps(stepResults)) {
            candidateDirs.add(s.dirName);
          }
          if (bf.linked_run_id) {
            linkedRunIds.add(bf.linked_run_id);
            candidateDirs.add(bf.linked_run_id);
            const runShots = db
              .prepare("SELECT DISTINCT dir_name FROM run_screenshots WHERE feature_run_id = ?")
              .all(bf.linked_run_id);
            for (const rs of runShots) {
              if (rs.dir_name) candidateDirs.add(rs.dir_name);
            }
          }
        }
        candidateDirs.add(targetId);

        // Xóa batch (cascade batch_features + run_screenshots WHERE batch_id = targetId)
        db.prepare("DELETE FROM batches WHERE id = ?").run(targetId);

        // Xóa luôn feature_runs mồ côi gắn với batch này (nếu không được batch khác dùng)
        const countRunRefs = db.prepare("SELECT COUNT(*) AS cnt FROM batch_features WHERE linked_run_id = ?");
        const deleteFeatureRun = db.prepare("DELETE FROM feature_runs WHERE id = ?");
        for (const runId of linkedRunIds) {
          if ((countRunRefs.get(runId)?.cnt || 0) === 0) {
            deleteFeatureRun.run(runId);
          }
        }

        const unreferenced = [];
        for (const dirName of candidateDirs) {
          if (!this._isScreenshotDirReferencedSync(db, dirName)) {
            unreferenced.push(dirName);
          }
        }
        return { deleted: true, dirsToDelete: unreferenced };
      }

      const runRow = db.prepare("SELECT id, steps_json FROM feature_runs WHERE id = ?").get(targetId);
      if (runRow) {
        const runShots = db
          .prepare("SELECT DISTINCT dir_name FROM run_screenshots WHERE feature_run_id = ?")
          .all(targetId);
        for (const s of runShots) {
          if (s.dir_name) candidateDirs.add(s.dir_name);
        }
        for (const s of extractScreenshotsFromSteps(safeJsonParse(runRow.steps_json, []))) {
          candidateDirs.add(s.dirName);
        }
        candidateDirs.add(targetId);

        db.prepare("DELETE FROM feature_runs WHERE id = ?").run(targetId);

        const unreferenced = [];
        for (const dirName of candidateDirs) {
          if (!this._isScreenshotDirReferencedSync(db, dirName)) {
            unreferenced.push(dirName);
          }
        }
        return { deleted: true, dirsToDelete: unreferenced };
      }

      return { deleted: false, dirsToDelete: [] };
    });

    if (deleted && dirsToDelete.length > 0) {
      for (const dirName of dirsToDelete) {
        await this._storage.deleteRunScreenshots(dirName);
      }
      logger.info(`[SQLite] Đã xóa phiên ${targetId} và dọn ${dirsToDelete.length} thư mục screenshots.`);
    }

    return deleted;
  }

  /**
   * Xóa toàn bộ lịch sử (hoặc theo projectId), đồng thời dọn sạch ảnh liên quan trên ổ đĩa
   */
  async clear({ projectId } = {}) {
    const db = this._getDb();

    const { deletedCount, dirsToDelete } = runInTransaction(db, () => {
      const candidateDirs = new Set();

      if (projectId) {
        const pid = String(projectId);
        const targetBatches = db.prepare("SELECT id FROM batches WHERE project_id = ?").all(pid);
        const targetRuns = db.prepare("SELECT id, steps_json FROM feature_runs WHERE project_id = ?").all(pid);

        const selectBatchShots = db.prepare("SELECT DISTINCT dir_name FROM run_screenshots WHERE batch_id = ?");
        const selectBatchFeats = db.prepare(
          "SELECT linked_run_id, step_results_json, extra_json FROM batch_features WHERE batch_id = ?"
        );

        for (const b of targetBatches) {
          candidateDirs.add(b.id);
          for (const s of selectBatchShots.all(b.id)) {
            if (s.dir_name) candidateDirs.add(s.dir_name);
          }
          for (const bf of selectBatchFeats.all(b.id)) {
            const bfExtra = safeJsonParse(bf.extra_json, {});
            if (bfExtra?.screenshotDir) candidateDirs.add(String(bfExtra.screenshotDir));
            if (bf.linked_run_id) candidateDirs.add(bf.linked_run_id);
            for (const s of extractScreenshotsFromSteps(safeJsonParse(bf.step_results_json, []))) {
              candidateDirs.add(s.dirName);
            }
          }
        }

        for (const r of targetRuns) {
          candidateDirs.add(r.id);
          for (const s of extractScreenshotsFromSteps(safeJsonParse(r.steps_json, []))) {
            candidateDirs.add(s.dirName);
          }
        }

        const delBatches = db.prepare("DELETE FROM batches WHERE project_id = ?").run(pid);
        db.prepare("DELETE FROM feature_runs WHERE project_id = ?").run(pid);

        const unreferenced = [];
        for (const dirName of candidateDirs) {
          if (!this._isScreenshotDirReferencedSync(db, dirName)) {
            unreferenced.push(dirName);
          }
        }
        return { deletedCount: delBatches.changes, dirsToDelete: unreferenced };
      }

      const allBatches = db.prepare("SELECT id FROM batches").all();
      const allRuns = db.prepare("SELECT id, steps_json FROM feature_runs").all();
      const allShots = db.prepare("SELECT DISTINCT dir_name FROM run_screenshots").all();
      const allBatchFeats = db.prepare("SELECT step_results_json, extra_json FROM batch_features").all();

      for (const s of allShots) {
        if (s.dir_name) candidateDirs.add(s.dir_name);
      }
      for (const b of allBatches) {
        candidateDirs.add(b.id);
      }
      for (const r of allRuns) {
        candidateDirs.add(r.id);
        for (const s of extractScreenshotsFromSteps(safeJsonParse(r.steps_json, []))) {
          candidateDirs.add(s.dirName);
        }
      }
      for (const bf of allBatchFeats) {
        const bfExtra = safeJsonParse(bf.extra_json, {});
        if (bfExtra?.screenshotDir) candidateDirs.add(String(bfExtra.screenshotDir));
        for (const s of extractScreenshotsFromSteps(safeJsonParse(bf.step_results_json, []))) {
          candidateDirs.add(s.dirName);
        }
      }

      db.prepare("DELETE FROM run_screenshots").run();
      db.prepare("DELETE FROM batch_features").run();
      const delBatches = db.prepare("DELETE FROM batches").run();
      db.prepare("DELETE FROM feature_runs").run();

      return { deletedCount: delBatches.changes, dirsToDelete: [...candidateDirs] };
    });

    for (const dirName of dirsToDelete) {
      await this._storage.deleteRunScreenshots(dirName);
    }

    return deletedCount;
  }
}

export const historyService = new HistoryService();

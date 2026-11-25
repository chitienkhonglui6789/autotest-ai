import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger.js";
import {
  DEFAULT_PROJECTS,
  extractScreenshotDirName,
  extractScreenshotsFromSteps,
  parseLegacyStepCacheKey,
  parseTimestampMs,
} from "./helpers.js";

function runSyncTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}

function getMetaFlag(db, key) {
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setMetaFlag(db, key, value) {
  db.prepare(
    `INSERT INTO schema_meta (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, String(value), new Date().toISOString());
}

function readJsonFileSafe(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, data: null, error: null };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw || "null");
    return { exists: true, data: parsed, error: null };
  } catch (err) {
    return { exists: true, data: null, error: err };
  }
}

function backupLegacyFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  let bakPath = `${filePath}.bak`;
  if (fs.existsSync(bakPath)) {
    bakPath = `${filePath}.bak.${Date.now()}`;
  }
  fs.renameSync(filePath, bakPath);
  return bakPath;
}

function insertProjectsAndFeatures(db, projectsList) {
  const now = new Date().toISOString();
  const upsertProject = db.prepare(
    `INSERT INTO projects (id, name, description, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       version = excluded.version,
       updated_at = excluded.updated_at`
  );
  const upsertFeature = db.prepare(
    `INSERT INTO features (id, project_id, name, description, steps_json, order_index, updated_at, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       project_id = excluded.project_id,
       name = excluded.name,
       description = excluded.description,
       steps_json = excluded.steps_json,
       order_index = excluded.order_index,
       updated_at = excluded.updated_at,
       meta_json = excluded.meta_json`
  );
  const upsertVariable = db.prepare(
    `INSERT INTO project_variables (id, project_id, key, value, is_secret, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, key) DO UPDATE SET
       value = excluded.value,
       is_secret = excluded.is_secret,
       description = excluded.description,
       updated_at = excluded.updated_at`
  );

  let featureTotal = 0;
  for (const proj of projectsList) {
    if (!proj || typeof proj !== "object") continue;
    const projectId = String(proj.id || `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    const createdAt = proj.createdAt || now;
    const updatedAt = proj.updatedAt || now;

    upsertProject.run(
      projectId,
      String(proj.name || "Dự án kiểm thử"),
      String(proj.description || ""),
      Number.isFinite(Number(proj.version)) ? Number(proj.version) : 1,
      createdAt,
      updatedAt
    );

    const features = Array.isArray(proj.features) ? proj.features : [];
    for (let idx = 0; idx < features.length; idx++) {
      const f = features[idx];
      if (!f || typeof f !== "object") continue;
      const featureId = String(f.id || `feat_${Date.now()}_${idx}`);
      const { id: _id, name, description, steps, updatedAt: fUpd, ...restMeta } = f;
      upsertFeature.run(
        featureId,
        projectId,
        String(name || `Tính năng ${idx + 1}`),
        String(description || ""),
        JSON.stringify(Array.isArray(steps) ? steps : []),
        idx,
        fUpd || updatedAt,
        JSON.stringify(restMeta || {})
      );
      featureTotal++;
    }

    if (Array.isArray(proj.variables)) {
      for (const v of proj.variables) {
        if (!v || !v.key) continue;
        upsertVariable.run(
          String(v.id || `var_${projectId}_${v.key}`),
          projectId,
          String(v.key).trim(),
          String(v.value ?? ""),
          v.isSecret || v.is_secret ? 1 : 0,
          String(v.description || ""),
          v.createdAt || now,
          v.updatedAt || now
        );
      }
    }
  }
  return featureTotal;
}

function migrateProjects(db, dataDir) {
  const existingCount = db.prepare("SELECT COUNT(*) AS cnt FROM projects").get()?.cnt || 0;
  const alreadyHandled = getMetaFlag(db, "migrated_projects") || getMetaFlag(db, "seeded_default_projects");
  if (existingCount > 0 || alreadyHandled) return;

  const projectsFile = path.join(dataDir, "projects.json");
  const readRes = readJsonFileSafe(projectsFile);

  if (readRes.exists) {
    if (readRes.error || !Array.isArray(readRes.data)) {
      logger.error(
        `[SQLite Migration] Lỗi đọc ${projectsFile} (${readRes.error?.message || "không phải Array"}). Giữ nguyên file gốc để bảo toàn dữ liệu.`
      );
      return;
    }

    let featureTotal = 0;
    runSyncTransaction(db, () => {
      featureTotal = insertProjectsAndFeatures(db, readRes.data);
      setMetaFlag(db, "migrated_projects", new Date().toISOString());
    });
    const bakPath = backupLegacyFile(projectsFile);
    logger.info(
      `[SQLite Migration] Đã migrate ${readRes.data.length} dự án (${featureTotal} tính năng) sang SQLite. Sao lưu file cũ -> ${path.basename(bakPath)}`
    );
    return;
  }

  // Không có projects.json cũ & DB đang trống -> seed mặc định
  runSyncTransaction(db, () => {
    insertProjectsAndFeatures(db, DEFAULT_PROJECTS);
    setMetaFlag(db, "seeded_default_projects", new Date().toISOString());
  });
  logger.info(`[SQLite Init] Đã khởi tạo ${DEFAULT_PROJECTS.length} dự án mẫu mặc định vào SQLite.`);
}

function migrateHistory(db, dataDir) {
  const batchCount = db.prepare("SELECT COUNT(*) AS cnt FROM batches").get()?.cnt || 0;
  const runCount = db.prepare("SELECT COUNT(*) AS cnt FROM feature_runs").get()?.cnt || 0;
  const alreadyMigrated = getMetaFlag(db, "migrated_history");
  if (batchCount > 0 || runCount > 0 || alreadyMigrated) return;

  const historyFile = path.join(dataDir, "history.json");
  const readRes = readJsonFileSafe(historyFile);
  if (!readRes.exists) return;

  if (readRes.error || !Array.isArray(readRes.data)) {
    logger.error(
      `[SQLite Migration] Lỗi đọc ${historyFile} (${readRes.error?.message || "không phải Array"}). Giữ nguyên file gốc để bảo toàn dữ liệu.`
    );
    return;
  }

  const standaloneRuns = [];
  const batchEntries = [];
  for (const item of readRes.data) {
    if (!item || typeof item !== "object" || !item.id) continue;
    if (Array.isArray(item.features)) {
      batchEntries.push(item);
    } else {
      standaloneRuns.push(item);
    }
  }

  const insertRunStmt = db.prepare(
    `INSERT INTO feature_runs (
       id, project_id, project_name, feature_id, feature_name, description,
       status, error, plan_json, plan_notes, steps_json,
       total_steps, passed_steps, failed_steps,
       timestamp, started_at, started_at_ms, finished_at, duration_ms, extra_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       error = excluded.error,
       steps_json = excluded.steps_json,
       finished_at = excluded.finished_at,
       duration_ms = excluded.duration_ms`
  );

  const insertBatchStmt = db.prepare(
    `INSERT INTO batches (
       id, project_id, project_name, name, status, notes, warning,
       timestamp, started_at, started_at_ms, finished_at, duration_ms,
       passed_count, failed_count, skipped_count, total_count, extra_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       finished_at = excluded.finished_at,
       duration_ms = excluded.duration_ms`
  );

  const insertBatchFeatureStmt = db.prepare(
    `INSERT INTO batch_features (
       id, batch_id, feature_id, feature_name, linked_run_id, order_index,
       status, steps_json, step_results_json, duration_ms, error, extra_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       step_results_json = excluded.step_results_json,
       duration_ms = excluded.duration_ms,
       error = excluded.error`
  );

  const insertScreenshotStmt = db.prepare(
    `INSERT INTO run_screenshots (
       batch_id, feature_run_id, feature_id, dir_name, url, type, label, sublabel, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const knownRunIds = new Set();

  runSyncTransaction(db, () => {
    const now = new Date().toISOString();

    for (const r of standaloneRuns) {
      const ts = r.timestamp || r.startedAt || now;
      const startedAt = r.startedAt || ts;
      const startedAtMs = parseTimestampMs(startedAt || ts, Date.now());
      const steps = Array.isArray(r.steps) ? r.steps : [];
      const {
        id, projectId, projectName, featureId, featureName, description,
        status, error, plan, planNotes, steps: _steps,
        totalSteps, passedSteps, failedSteps,
        timestamp: _ts, startedAt: _sa, finishedAt, duration, durationMs,
        ...extraRun
      } = r;

      const computedPassed = Number.isFinite(Number(passedSteps))
        ? Number(passedSteps)
        : steps.filter((s) => s?.status === "passed").length;
      const computedFailed = Number.isFinite(Number(failedSteps))
        ? Number(failedSteps)
        : steps.filter((s) => s?.status && s.status !== "passed").length;

      insertRunStmt.run(
        String(id),
        String(projectId || "default"),
        String(projectName || "Dự án kiểm thử"),
        featureId ? String(featureId) : null,
        String(featureName || r.name || "Kiểm thử tự động"),
        String(description || ""),
        String(status || "failed"),
        error ? String(error) : null,
        JSON.stringify(Array.isArray(plan) ? plan : []),
        String(planNotes || ""),
        JSON.stringify(steps),
        Number.isFinite(Number(totalSteps)) ? Number(totalSteps) : steps.length,
        computedPassed,
        computedFailed,
        ts,
        startedAt,
        startedAtMs,
        finishedAt || ts,
        Number(durationMs ?? duration ?? 0) || 0,
        JSON.stringify(extraRun || {})
      );
      knownRunIds.add(String(id));

      const shots = extractScreenshotsFromSteps(steps);
      for (const s of shots) {
        insertScreenshotStmt.run(
          null,
          String(id),
          featureId ? String(featureId) : null,
          s.dirName,
          s.url,
          s.type,
          s.label,
          s.sublabel,
          ts
        );
      }
    }

    for (const b of batchEntries) {
      const ts = b.timestamp || b.startedAt || now;
      const startedAt = b.startedAt || ts;
      const startedAtMs = parseTimestampMs(startedAt || ts, Date.now());
      const isStaleRunning = b.status === "Đang chạy";
      const normalizedStatus = isStaleRunning ? "Kết thúc" : (b.status || "Kết thúc");
      const rawFeatures = Array.isArray(b.features) ? b.features : [];

      const features = rawFeatures.map((f) => {
        if (isStaleRunning && (f.status === "RUNNING" || f.status === "PENDING")) {
          return {
            ...f,
            status: "SKIPPED",
            error: f.error || "Phiên chạy đã kết thúc hoặc bị gián đoạn trước đó",
          };
        }
        return f;
      });

      const passedCount = features.filter((f) => f?.status === "PASSED").length;
      const failedCount = features.filter((f) => f?.status === "FAILED").length;
      const skippedCount = features.filter((f) => f?.status === "SKIPPED").length;

      const {
        id, projectId, projectName, name, status: _st, notes, warning,
        timestamp: _ts, startedAt: _sa, finishedAt, duration, durationMs,
        features: _feats,
        ...extraBatch
      } = b;

      insertBatchStmt.run(
        String(id),
        String(projectId || "default"),
        String(projectName || "Dự án kiểm thử"),
        String(name || b.featureName || "Đợt chạy kiểm thử"),
        String(normalizedStatus),
        String(notes || ""),
        warning ? String(warning) : null,
        ts,
        startedAt,
        startedAtMs,
        finishedAt || (normalizedStatus === "Kết thúc" ? ts : null),
        Number(durationMs ?? duration ?? 0) || 0,
        passedCount,
        failedCount,
        skippedCount,
        features.length,
        JSON.stringify(extraBatch || {})
      );

      for (let idx = 0; idx < features.length; idx++) {
        const f = features[idx] || {};
        const stepResults = Array.isArray(f.stepResults)
          ? f.stepResults
          : (Array.isArray(f.steps) && typeof f.steps[0] === "object" ? f.steps : []);
        const shots = extractScreenshotsFromSteps(stepResults);

        let linkedRunId = null;
        if (f.runId && knownRunIds.has(String(f.runId))) {
          linkedRunId = String(f.runId);
        } else if (f.linkedRunId && knownRunIds.has(String(f.linkedRunId))) {
          linkedRunId = String(f.linkedRunId);
        } else if (shots.length > 0 && knownRunIds.has(shots[0].dirName)) {
          linkedRunId = shots[0].dirName;
        }

        const {
          id: featId, name: featName, featureName, runId: _rid, linkedRunId: _lrid,
          status: fStatus, steps: fSteps, stepResults: _sr,
          duration: fDur, durationMs: fDurMs, error: fErr,
          ...extraFeat
        } = f;

        const batchFeatId = `${String(id)}::${idx}`;
        insertBatchFeatureStmt.run(
          batchFeatId,
          String(id),
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
          insertScreenshotStmt.run(
            String(id),
            linkedRunId,
            featId ? String(featId) : null,
            s.dirName,
            s.url,
            s.type,
            s.label,
            s.sublabel,
            ts
          );
        }
      }
    }

    setMetaFlag(db, "migrated_history", now);
  });

  const bakPath = backupLegacyFile(historyFile);
  logger.info(
    `[SQLite Migration] Đã migrate ${batchEntries.length} batch + ${standaloneRuns.length} feature runs từ history.json sang SQLite. Sao lưu -> ${path.basename(bakPath)}`
  );
}

function migrateStepCache(db, dataDir) {
  const count = db.prepare("SELECT COUNT(*) AS cnt FROM step_cache").get()?.cnt || 0;
  const alreadyMigrated = getMetaFlag(db, "migrated_step_cache");
  if (count > 0 || alreadyMigrated) return;

  const cacheFile = path.join(dataDir, "step_cache.json");
  const readRes = readJsonFileSafe(cacheFile);
  if (!readRes.exists) return;

  if (readRes.error || !readRes.data || typeof readRes.data !== "object" || Array.isArray(readRes.data)) {
    logger.error(
      `[SQLite Migration] Lỗi đọc ${cacheFile} (${readRes.error?.message || "không phải Object"}). Giữ nguyên file gốc để bảo toàn dữ liệu.`
    );
    return;
  }

  const entries = Object.entries(readRes.data);
  const insertCacheStmt = db.prepare(
    `INSERT INTO step_cache (
       cache_key, project_id, feature_id, route_path, normalized_text,
       step_text, recorded_actions_json, hit_count, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       recorded_actions_json = excluded.recorded_actions_json,
       updated_at = excluded.updated_at`
  );

  let imported = 0;
  runSyncTransaction(db, () => {
    const now = new Date().toISOString();
    for (const [key, entry] of entries) {
      if (!entry || !Array.isArray(entry.recordedActions)) continue;
      const meta = parseLegacyStepCacheKey(key, entry);
      if (meta.featureId === "*" || meta.projectId === "*") continue;
      const updatedAt = entry.updatedAt || now;
      insertCacheStmt.run(
        meta.cacheKey,
        meta.projectId,
        meta.featureId,
        meta.routePath,
        meta.normalizedText,
        meta.stepText,
        JSON.stringify(entry.recordedActions),
        Number.isFinite(Number(entry.hitCount)) ? Number(entry.hitCount) : 0,
        entry.createdAt || updatedAt,
        updatedAt
      );
      imported++;
    }
    setMetaFlag(db, "migrated_step_cache", now);
  });

  const bakPath = backupLegacyFile(cacheFile);
  logger.info(
    `[SQLite Migration] Đã migrate ${imported} step_cache entries sang SQLite. Sao lưu -> ${path.basename(bakPath)}`
  );
}

/**
 * Chạy toàn bộ quá trình auto-migration an toàn khi khởi động nếu DB chưa có dữ liệu tương ứng.
 * Tuyệt đối không xóa dữ liệu cũ; chỉ đổi tên sang `.json.bak` sau khi SQLite commit thành công.
 */
export function migrateFromJsonIfNeeded(db, { dataDir }) {
  if (!dataDir || !fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  migrateProjects(db, dataDir);
  migrateHistory(db, dataDir);
  migrateStepCache(db, dataDir);
}

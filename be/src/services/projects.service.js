import { logger } from "../utils/logger.js";
import { ConflictError, NotFoundError } from "../errors/AppError.js";
import { getDatabase, runInTransaction } from "../db/database.js";
import { parseTimestampMs, safeJsonParse } from "../db/helpers.js";
import { storageService } from "./storage.service.js";

const genId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const normalizeSessionMode = (mode) => (String(mode || "").trim().toLowerCase() === "persist" ? "persist" : "fresh");

export class ProjectsService {
  constructor(db = null, storage = storageService) {
    this._db = db;
    this.storage = storage;
  }

  _getDb() {
    return this._db || getDatabase();
  }

  _hydrateFeatureRow(row) {
    const meta = safeJsonParse(row.meta_json, {});
    const feature = {
      ...meta,
      id: row.id,
      name: row.name,
      steps: safeJsonParse(row.steps_json, []),
      updatedAt: row.updated_at,
    };
    if (row.description) {
      feature.description = row.description;
    }
    return feature;
  }

  _hydrateProjectRow(projRow, featureRows = []) {
    return {
      id: projRow.id,
      name: projRow.name,
      description: projRow.description || "",
      sessionMode: normalizeSessionMode(projRow.session_mode),
      hasSavedSession: this.storage.hasProjectSessionSync(projRow.id),
      version: Number(projRow.version || 1),
      createdAt: projRow.created_at,
      updatedAt: projRow.updated_at,
      features: featureRows.map((fr) => this._hydrateFeatureRow(fr)),
    };
  }

  _getHydratedProjectSync(db, projectId) {
    const projRow = db
      .prepare(
        "SELECT id, name, description, COALESCE(session_mode, 'fresh') AS session_mode, version, created_at, updated_at FROM projects WHERE id = ?"
      )
      .get(projectId);
    if (!projRow) return null;

    const featureRows = db
      .prepare(
        `SELECT id, project_id, name, description, steps_json, order_index, updated_at, meta_json
         FROM features
         WHERE project_id = ?
         ORDER BY order_index ASC, rowid ASC`
      )
      .all(projectId);

    return this._hydrateProjectRow(projRow, featureRows);
  }

  _insertFeaturesSync(db, projectId, features, fallbackUpdatedAt) {
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

    const list = Array.isArray(features) ? features : [];
    for (let idx = 0; idx < list.length; idx++) {
      const f = list[idx];
      if (!f || typeof f !== "object") continue;
      const featureId = String(f.id || genId("feat"));
      const { id: _id, name, description, steps, updatedAt, ...restMeta } = f;
      upsertFeature.run(
        featureId,
        projectId,
        String(name || `Tính năng ${idx + 1}`),
        String(description || ""),
        JSON.stringify(Array.isArray(steps) ? steps : []),
        idx,
        updatedAt || fallbackUpdatedAt,
        JSON.stringify(restMeta || {})
      );
    }
  }

  _assertNoConflict(existingProject, incomingData) {
    if (!existingProject || !existingProject.updatedAt || !incomingData?.updatedAt) return;
    const curTime = parseTimestampMs(existingProject.updatedAt, 0);
    const incTime = parseTimestampMs(incomingData.updatedAt, 0);
    if (curTime <= incTime) return;

    const compareFeatures = Array.isArray(incomingData.features)
      ? JSON.stringify(existingProject.features || []) !== JSON.stringify(incomingData.features)
      : false;

    const isSessionModeChanged =
      incomingData.sessionMode !== undefined &&
      normalizeSessionMode(existingProject.sessionMode) !== normalizeSessionMode(incomingData.sessionMode);

    const isContentDifferent =
      existingProject.name !== incomingData.name ||
      (existingProject.description || "") !== (incomingData.description || "") ||
      isSessionModeChanged ||
      compareFeatures;

    if (isContentDifferent) {
      throw new ConflictError(
        `Dự án "${existingProject.name}" vừa được cập nhật lúc ${existingProject.updatedAt}. Vui lòng tải lại dữ liệu mới nhất để tránh mất thông tin.`
      );
    }
  }

  /**
   * GET ALL PROJECTS
   */
  async getAll() {
    const db = this._getDb();
    const projectRows = db
      .prepare(
        "SELECT id, name, description, COALESCE(session_mode, 'fresh') AS session_mode, version, created_at, updated_at FROM projects ORDER BY created_at ASC, rowid ASC"
      )
      .all();

    const featureRows = db
      .prepare(
        `SELECT id, project_id, name, description, steps_json, order_index, updated_at, meta_json
         FROM features
         ORDER BY project_id ASC, order_index ASC, rowid ASC`
      )
      .all();

    const featuresByProject = new Map();
    for (const row of featureRows) {
      const pid = row.project_id;
      if (!featuresByProject.has(pid)) {
        featuresByProject.set(pid, []);
      }
      featuresByProject.get(pid).push(row);
    }

    return projectRows.map((p) => this._hydrateProjectRow(p, featuresByProject.get(p.id) || []));
  }

  /**
   * GET SINGLE PROJECT BY ID
   */
  async getById(id) {
    if (!id) return null;
    const db = this._getDb();
    return this._getHydratedProjectSync(db, String(id));
  }

  /**
   * BULK SAVE (tương thích ngược với endpoint POST /projects/bulk)
   */
  async saveAll(incomingProjects, { force = false } = {}) {
    if (!Array.isArray(incomingProjects)) {
      throw new Error("Dữ liệu dự án gửi lên phải là một danh sách (Array)");
    }

    const db = this._getDb();
    return runInTransaction(db, () => {
      const now = new Date().toISOString();
      const existingRows = db
        .prepare("SELECT id FROM projects")
        .all();
      const currentMap = new Map();
      for (const row of existingRows) {
        currentMap.set(row.id, this._getHydratedProjectSync(db, row.id));
      }

      if (!force) {
        for (const inc of incomingProjects) {
          if (!inc?.id) continue;
          const cur = currentMap.get(inc.id);
          this._assertNoConflict(cur, inc);
        }
      }

      const incomingIds = new Set();
      const upsertProj = db.prepare(
        `INSERT INTO projects (id, name, description, session_mode, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           session_mode = excluded.session_mode,
           version = excluded.version,
           updated_at = excluded.updated_at`
      );
      const clearFeatures = db.prepare("DELETE FROM features WHERE project_id = ?");

      for (const p of incomingProjects) {
        if (!p || typeof p !== "object") continue;
        const id = String(p.id || genId("proj"));
        incomingIds.add(id);
        const cur = currentMap.get(id);

        const isCurNewer =
          cur?.updatedAt &&
          p.updatedAt &&
          parseTimestampMs(cur.updatedAt, 0) > parseTimestampMs(p.updatedAt, 0);

        const updatedAt = isCurNewer ? cur.updatedAt : now;
        const version = isCurNewer ? cur.version : Number(p.version || 1) + 1;
        const createdAt = cur?.createdAt || p.createdAt || now;
        const sessionMode =
          p.sessionMode !== undefined
            ? normalizeSessionMode(p.sessionMode)
            : normalizeSessionMode(cur?.sessionMode);

        upsertProj.run(
          id,
          String(p.name || "Dự án kiểm thử"),
          String(p.description || ""),
          sessionMode,
          version,
          createdAt,
          updatedAt
        );

        if (Array.isArray(p.features)) {
          clearFeatures.run(id);
          this._insertFeaturesSync(db, id, p.features, updatedAt);
        }
      }

      const deleteProj = db.prepare("DELETE FROM projects WHERE id = ?");
      for (const existingId of currentMap.keys()) {
        if (!incomingIds.has(existingId)) {
          deleteProj.run(existingId);
        }
      }

      const saved = [];
      for (const id of incomingIds) {
        const proj = this._getHydratedProjectSync(db, id);
        if (proj) saved.push(proj);
      }

      logger.info(`[SQLite] Đã lưu tập trung ${saved.length} dự án.`);
      return saved;
    });
  }

  /**
   * SAVE / UPDATE SINGLE PROJECT
   * Lưu ý: Nếu không truyền `features` khi cập nhật thông tin dự án, giữ nguyên toàn bộ features hiện có.
   */
  async saveProject(projectData, { force = false } = {}) {
    if (!projectData || !String(projectData.name || "").trim()) {
      throw new Error("Dự án phải có tên hợp lệ");
    }

    const db = this._getDb();
    return runInTransaction(db, () => {
      const id = String(projectData.id || genId("proj"));
      const existing = this._getHydratedProjectSync(db, id);

      if (existing && !force) {
        this._assertNoConflict(existing, projectData);
      }

      const now = new Date().toISOString();
      const createdAt = existing?.createdAt || projectData.createdAt || now;
      const version = existing ? existing.version + 1 : Number(projectData.version || 0) + 1;
      const sessionMode =
        projectData.sessionMode !== undefined
          ? normalizeSessionMode(projectData.sessionMode)
          : normalizeSessionMode(existing?.sessionMode);

      db.prepare(
        `INSERT INTO projects (id, name, description, session_mode, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           session_mode = excluded.session_mode,
           version = excluded.version,
           updated_at = excluded.updated_at`
      ).run(
        id,
        String(projectData.name).trim(),
        String(projectData.description || ""),
        sessionMode,
        version,
        createdAt,
        now
      );

      if (Array.isArray(projectData.features)) {
        db.prepare("DELETE FROM features WHERE project_id = ?").run(id);
        this._insertFeaturesSync(db, id, projectData.features, now);
      }

      const hydrated = this._getHydratedProjectSync(db, id);
      logger.info(`[SQLite] Đã lưu dự án "${hydrated.name}" (${id}).`);
      return hydrated;
    });
  }

  /**
   * DELETE SINGLE PROJECT (cascade xóa luôn features & project_variables)
   */
  async deleteProject(projectId) {
    const db = this._getDb();
    const res = runInTransaction(db, () => {
      const del = db.prepare("DELETE FROM projects WHERE id = ?").run(String(projectId));
      if (del.changes === 0) {
        throw new NotFoundError(`Không tìm thấy dự án với ID: ${projectId}`);
      }
      db.prepare("DELETE FROM step_cache WHERE project_id = ?").run(String(projectId));
      logger.info(`[SQLite] Đã xóa dự án: ${projectId}`);
      return { success: true, message: "Đã xóa dự án" };
    });
    await this.storage.clearProjectSession(projectId);
    return res;
  }

  /**
   * CREATE OR UPDATE SINGLE FEATURE TRONG DỰ ÁN
   */
  async saveFeature(projectId, featureData, { force = false } = {}) {
    if (!featureData || (!String(featureData.name || "").trim() && !Array.isArray(featureData.steps))) {
      throw new Error("Dữ liệu tính năng không hợp lệ");
    }

    const db = this._getDb();
    return runInTransaction(db, () => {
      const proj = db.prepare("SELECT id, version FROM projects WHERE id = ?").get(String(projectId));
      if (!proj) {
        throw new NotFoundError(`Không tìm thấy dự án với ID: ${projectId}`);
      }

      const featureId = String(featureData.id || genId("feat"));
      const existing = db
        .prepare("SELECT * FROM features WHERE id = ? AND project_id = ?")
        .get(featureId, String(projectId));

      if (existing && !force && featureData.updatedAt && existing.updated_at) {
        const curTime = parseTimestampMs(existing.updated_at, 0);
        const incTime = parseTimestampMs(featureData.updatedAt, 0);
        if (curTime > incTime) {
          const existingSteps = safeJsonParse(existing.steps_json, []);
          const nextSteps = Array.isArray(featureData.steps) ? featureData.steps : existingSteps;
          const isDiff =
            existing.name !== String(featureData.name || existing.name) ||
            JSON.stringify(existingSteps) !== JSON.stringify(nextSteps);
          if (isDiff) {
            throw new ConflictError(
              `Tính năng "${existing.name}" đã được cập nhật lúc ${existing.updated_at}. Vui lòng tải lại dữ liệu.`
            );
          }
        }
      }

      const now = new Date().toISOString();
      const nextOrder = existing
        ? existing.order_index
        : (db
            .prepare("SELECT COALESCE(MAX(order_index), -1) + 1 AS next_idx FROM features WHERE project_id = ?")
            .get(String(projectId))?.next_idx ?? 0);

      const { id: _id, name, description, steps, updatedAt: _u, ...restMeta } = featureData;
      const existingMeta = existing ? safeJsonParse(existing.meta_json, {}) : {};
      const mergedMeta = { ...existingMeta, ...restMeta };

      db.prepare(
        `INSERT INTO features (id, project_id, name, description, steps_json, order_index, updated_at, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           steps_json = excluded.steps_json,
           order_index = excluded.order_index,
           updated_at = excluded.updated_at,
           meta_json = excluded.meta_json`
      ).run(
        featureId,
        String(projectId),
        String(name || existing?.name || "Tính năng kiểm thử").trim(),
        String(description ?? existing?.description ?? ""),
        JSON.stringify(
          Array.isArray(steps)
            ? steps
            : (existing ? safeJsonParse(existing.steps_json, []) : [])
        ),
        Number.isFinite(Number(featureData.orderIndex)) ? Number(featureData.orderIndex) : nextOrder,
        now,
        JSON.stringify(mergedMeta)
      );

      db.prepare("UPDATE projects SET updated_at = ?, version = version + 1 WHERE id = ?").run(
        now,
        String(projectId)
      );

      const project = this._getHydratedProjectSync(db, String(projectId));
      const feature = project.features.find((f) => f.id === featureId) || null;
      return { project, feature };
    });
  }

  /**
   * REORDER FEATURES TRONG DỰ ÁN
   */
  async reorderFeatures(projectId, orderedIds) {
    if (!Array.isArray(orderedIds)) {
      throw new Error("orderedIds phải là một danh sách (Array)");
    }

    const db = this._getDb();
    return runInTransaction(db, () => {
      const proj = db.prepare("SELECT id FROM projects WHERE id = ?").get(String(projectId));
      if (!proj) {
        throw new NotFoundError(`Không tìm thấy dự án với ID: ${projectId}`);
      }

      const existingRows = db
        .prepare("SELECT id FROM features WHERE project_id = ? ORDER BY order_index ASC, rowid ASC")
        .all(String(projectId));
      const existingIds = existingRows.map((r) => r.id);
      const validSet = new Set(existingIds);

      const finalOrder = [];
      const seen = new Set();
      for (const rawId of orderedIds) {
        const id = String(rawId);
        if (validSet.has(id) && !seen.has(id)) {
          finalOrder.push(id);
          seen.add(id);
        }
      }
      for (const id of existingIds) {
        if (!seen.has(id)) finalOrder.push(id);
      }

      const updateOrder = db.prepare("UPDATE features SET order_index = ? WHERE id = ? AND project_id = ?");
      for (let idx = 0; idx < finalOrder.length; idx++) {
        updateOrder.run(idx, finalOrder[idx], String(projectId));
      }

      const now = new Date().toISOString();
      db.prepare("UPDATE projects SET updated_at = ?, version = version + 1 WHERE id = ?").run(
        now,
        String(projectId)
      );

      return this._getHydratedProjectSync(db, String(projectId));
    });
  }

  /**
   * IMPORT NHIỀU TÍNH NĂNG VÀO CUỐI DỰ ÁN
   */
  async importFeatures(projectId, featuresList) {
    if (!Array.isArray(featuresList)) {
      throw new Error("features phải là một danh sách (Array)");
    }

    const db = this._getDb();
    return runInTransaction(db, () => {
      const proj = db.prepare("SELECT id FROM projects WHERE id = ?").get(String(projectId));
      if (!proj) {
        throw new NotFoundError(`Không tìm thấy dự án với ID: ${projectId}`);
      }

      const now = new Date().toISOString();
      let nextOrder =
        db
          .prepare("SELECT COALESCE(MAX(order_index), -1) + 1 AS next_idx FROM features WHERE project_id = ?")
          .get(String(projectId))?.next_idx ?? 0;

      const existingIds = new Set(
        db.prepare("SELECT id FROM features").all().map((r) => r.id)
      );

      const insertStmt = db.prepare(
        `INSERT INTO features (id, project_id, name, description, steps_json, order_index, updated_at, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );

      let importedCount = 0;
      for (const f of featuresList) {
        if (!f || typeof f !== "object") continue;
        let featureId = f.id ? String(f.id) : genId("feat");
        if (existingIds.has(featureId)) {
          featureId = genId("feat");
        }
        existingIds.add(featureId);

        const { id: _id, name, description, steps, updatedAt, ...restMeta } = f;
        insertStmt.run(
          featureId,
          String(projectId),
          String(name || `Tính năng ${importedCount + 1}`).trim(),
          String(description || ""),
          JSON.stringify(Array.isArray(steps) ? steps : []),
          nextOrder++,
          updatedAt || now,
          JSON.stringify(restMeta || {})
        );
        importedCount++;
      }

      db.prepare("UPDATE projects SET updated_at = ?, version = version + 1 WHERE id = ?").run(
        now,
        String(projectId)
      );

      const project = this._getHydratedProjectSync(db, String(projectId));
      return { project, importedCount };
    });
  }

  /**
   * DELETE SINGLE FEATURE
   */
  async deleteFeature(projectId, featureId) {
    const db = this._getDb();
    return runInTransaction(db, () => {
      const proj = db.prepare("SELECT id FROM projects WHERE id = ?").get(String(projectId));
      if (!proj) {
        throw new NotFoundError(`Không tìm thấy dự án với ID: ${projectId}`);
      }

      const res = db
        .prepare("DELETE FROM features WHERE id = ? AND project_id = ?")
        .run(String(featureId), String(projectId));
      if (res.changes === 0) {
        throw new NotFoundError(`Không tìm thấy tính năng với ID: ${featureId}`);
      }
      db.prepare("DELETE FROM step_cache WHERE project_id = ? AND feature_id = ?").run(
        String(projectId),
        String(featureId)
      );

      const remaining = db
        .prepare("SELECT id FROM features WHERE project_id = ? ORDER BY order_index ASC, rowid ASC")
        .all(String(projectId));
      const updateOrder = db.prepare("UPDATE features SET order_index = ? WHERE id = ?");
      for (let idx = 0; idx < remaining.length; idx++) {
        updateOrder.run(idx, remaining[idx].id);
      }

      const now = new Date().toISOString();
      db.prepare("UPDATE projects SET updated_at = ?, version = version + 1 WHERE id = ?").run(
        now,
        String(projectId)
      );

      const project = this._getHydratedProjectSync(db, String(projectId));
      logger.info(`[SQLite] Đã xóa tính năng ${featureId} khỏi dự án ${projectId}`);
      return { success: true, project };
    });
  }

  /**
   * LẤY DANH SÁCH BIẾN MÔI TRƯỜNG CỦA DỰ ÁN (chuẩn bị cho Phase tiếp theo)
   */
  async getVariables(projectId) {
    const db = this._getDb();
    const proj = db.prepare("SELECT id FROM projects WHERE id = ?").get(String(projectId));
    if (!proj) {
      throw new NotFoundError(`Không tìm thấy dự án với ID: ${projectId}`);
    }

    const rows = db
      .prepare(
        `SELECT id, project_id, key, value, is_secret, description, created_at, updated_at
         FROM project_variables
         WHERE project_id = ?
         ORDER BY key ASC`
      )
      .all(String(projectId));

    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      key: r.key,
      value: r.value,
      isSecret: Boolean(r.is_secret),
      description: r.description || "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * CẬP NHẬT DANH SÁCH BIẾN MÔI TRƯỜNG CỦA DỰ ÁN
   */
  async saveVariables(projectId, variables) {
    if (!Array.isArray(variables)) {
      throw new Error("variables phải là một danh sách (Array)");
    }

    const db = this._getDb();
    return runInTransaction(db, () => {
      const proj = db.prepare("SELECT id FROM projects WHERE id = ?").get(String(projectId));
      if (!proj) {
        throw new NotFoundError(`Không tìm thấy dự án với ID: ${projectId}`);
      }

      const now = new Date().toISOString();
      db.prepare("DELETE FROM project_variables WHERE project_id = ?").run(String(projectId));

      const insertVar = db.prepare(
        `INSERT INTO project_variables (id, project_id, key, value, is_secret, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, key) DO UPDATE SET
           value = excluded.value,
           is_secret = excluded.is_secret,
           description = excluded.description,
           updated_at = excluded.updated_at`
      );

      for (const v of variables) {
        if (!v || !String(v.key || "").trim()) continue;
        insertVar.run(
          String(v.id || genId("var")),
          String(projectId),
          String(v.key).trim(),
          String(v.value ?? ""),
          v.isSecret ? 1 : 0,
          String(v.description || ""),
          v.createdAt || now,
          now
        );
      }

      return this.getVariables(projectId);
    });
  }

  /**
   * Đọc biến môi trường phục vụ thực thi test (trả về { varsMap, secretKeys }, an toàn khi projectId='default')
   */
  async getVariablesRuntime(projectId) {
    if (!projectId) {
      return { varsMap: {}, secretKeys: [] };
    }
    const db = this._getDb();
    const rows = db
      .prepare(
        `SELECT key, value, is_secret
         FROM project_variables
         WHERE project_id = ?
         ORDER BY key ASC`
      )
      .all(String(projectId));

    const varsMap = {};
    const secretKeys = [];
    for (const r of rows) {
      const key = String(r.key || "").trim();
      if (!key) continue;
      varsMap[key] = r.value ?? "";
      if (r.is_secret) {
        secretKeys.push(key);
      }
    }
    return { varsMap, secretKeys };
  }

  async getProjectSessionStatus(projectId) {
    const db = this._getDb();
    const proj = db.prepare("SELECT id, session_mode FROM projects WHERE id = ?").get(String(projectId));
    if (!proj) {
      throw new NotFoundError(`Không tìm thấy dự án với ID: ${projectId}`);
    }
    return {
      projectId: String(projectId),
      sessionMode: normalizeSessionMode(proj.session_mode),
      hasSavedSession: this.storage.hasProjectSessionSync(projectId),
    };
  }

  async clearProjectSession(projectId) {
    const db = this._getDb();
    const proj = db.prepare("SELECT id FROM projects WHERE id = ?").get(String(projectId));
    if (!proj) {
      throw new NotFoundError(`Không tìm thấy dự án với ID: ${projectId}`);
    }
    await this.storage.clearProjectSession(projectId);
    return {
      success: true,
      projectId: String(projectId),
      hasSavedSession: false,
      message: "Đã xóa phiên đăng nhập đã lưu (storageState)",
    };
  }

  /**
   * Tổng hợp biến môi trường + chế độ phiên (storageState) cho mỗi lần chạy feature/batch
   */
  async getExecutionContext(projectId, featureSessionMode = "inherit", overrideVars = null) {
    const pid = projectId ? String(projectId) : "default";
    const proj = projectId ? await this.getById(pid) : null;
    const { varsMap, secretKeys } = await this.getVariablesRuntime(pid);
    const mergedVars = {
      ...varsMap,
      ...(overrideVars && typeof overrideVars === "object" ? overrideVars : {}),
    };
    const projectSessionMode = normalizeSessionMode(proj?.sessionMode);
    const featMode = String(featureSessionMode || "inherit").trim().toLowerCase();
    const effectiveSessionMode =
      featMode === "fresh" || featMode === "persist" ? featMode : projectSessionMode;
    const persistSession = effectiveSessionMode === "persist";
    const storageStatePath = persistSession ? this.storage.getProjectSessionPath(pid) : null;

    return {
      project: proj,
      mergedVars,
      secretKeys,
      projectSessionMode,
      effectiveSessionMode,
      persistSession,
      storageStatePath,
    };
  }
}

export const projectsService = new ProjectsService();

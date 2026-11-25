import { logger } from "../../utils/logger.js";
import { getDatabase, runInTransaction } from "../../db/database.js";
import { normalizeStepText, safeJsonParse } from "../../db/helpers.js";
import { extractRoutePath, isRouteCompatible } from "../../utils/url.js";

/**
 * KHỐI 3: BỘ GHI BĂNG & PHÁT LẠI TỐC ĐỘ CAO (ROUTE-SCOPED STEP TRACE CACHE SERVICE - SQLite)
 * - Lưu trữ chuỗi nhịp thao tác nguyên tử đã kiểm chứng thành công trên trình duyệt thật.
 * - Cô lập chặt chẽ theo (projectId, featureId, routePath, normalizedText); không chia sẻ wildcard `*` giữa các tính năng/màn hình.
 */
export class StepCacheService {
  constructor(db = null) {
    this._db = db;
  }

  _getDb() {
    return this._db || getDatabase();
  }

  normalizeText(stepText) {
    return normalizeStepText(stepText);
  }

  normalizeRoute(routeOrUrl = "") {
    return extractRoutePath(routeOrUrl);
  }

  buildKey(stepText, projectId = "default", featureId = "default", routePath = "") {
    const norm = this.normalizeText(stepText);
    const pid = String(projectId || "default");
    const fid = String(featureId || "default");
    const route = this.normalizeRoute(routePath);
    const routeSuffix = route ? `@${route}` : "";
    return `${pid}::${fid}${routeSuffix}::${norm}`;
  }

  buildKeys(stepText, projectId = "default", featureId = "default", routePath = "") {
    return {
      scopedKey: this.buildKey(stepText, projectId, featureId, routePath),
    };
  }

  /**
   * Tra cứu băng ghi thao tác đã lưu cho bước kiểm thử:
   * - Khớp chặt theo (projectId, featureId, normalizedStep)
   * - Kiểm tra tương thích ngữ cảnh màn hình (route_path) nếu không phải thao tác navigate
   */
  async getTrace(stepText, projectId = "default", featureId = "default", currentUrlOrRoute = "") {
    const db = this._getDb();
    const norm = this.normalizeText(stepText);
    if (!norm) return null;

    const pid = String(projectId || "default");
    const fid = String(featureId || "default");
    if (pid === "*" || fid === "*") return null;

    const currentRoute = this.normalizeRoute(currentUrlOrRoute);

    const rows = db
      .prepare(
        `SELECT cache_key, project_id, feature_id, route_path, recorded_actions_json, updated_at
         FROM step_cache
         WHERE project_id = ? AND feature_id = ? AND normalized_text = ?
         ORDER BY updated_at DESC, rowid DESC`
      )
      .all(pid, fid, norm);

    if (rows.length === 0) return null;

    const compatibleMatches = [];
    const mismatchedRoutes = [];

    for (const row of rows) {
      const actions = safeJsonParse(row.recorded_actions_json, null);
      if (!Array.isArray(actions) || actions.length === 0) continue;

      const firstKind = String(actions[0]?.action || actions[0]?.type || "")
        .toLowerCase()
        .trim();
      const isNavigateStep = firstKind === "navigate" || firstKind === "goto";
      const savedRoute = this.normalizeRoute(row.route_path || "");
      const exactRoute = savedRoute === currentRoute;

      if (isNavigateStep || isRouteCompatible(savedRoute, currentRoute)) {
        compatibleMatches.push({ row, actions, exactRoute, isNavigateStep });
      } else {
        mismatchedRoutes.push(savedRoute || "(blank)");
      }
    }

    if (compatibleMatches.length === 0) {
      if (mismatchedRoutes.length > 0) {
        logger.info(
          `[StepCache] Bỏ qua Cache cho "${String(stepText).slice(0, 60)}" vì lệch ngữ cảnh Route (lưu ở [${mismatchedRoutes.join(", ")}], hiện tại "${currentRoute || "(blank)"}")`
        );
      }
      return null;
    }

    compatibleMatches.sort((a, b) => Number(b.exactRoute) - Number(a.exactRoute));
    const chosen = compatibleMatches[0];

    try {
      db.prepare("UPDATE step_cache SET hit_count = hit_count + 1 WHERE cache_key = ?").run(
        chosen.row.cache_key
      );
    } catch {}

    Object.defineProperty(chosen.actions, "_cacheMeta", {
      value: {
        cacheKey: chosen.row.cache_key,
        routePath: chosen.row.route_path || "",
      },
      enumerable: false,
      configurable: true,
    });

    return chosen.actions;
  }

  /**
   * Lưu băng ghi thao tác mới gắn chặt (projectId, featureId, routePath, normalizedStep)
   */
  async saveTrace(stepText, recordedActions, projectId = "default", featureId = "default", routePath = "") {
    if (!Array.isArray(recordedActions) || recordedActions.length === 0) return;

    const pid = String(projectId || "default");
    const fid = String(featureId || "default");
    if (pid === "*" || fid === "*") return;

    const db = this._getDb();
    const route = this.normalizeRoute(routePath);
    const norm = this.normalizeText(stepText);
    if (!norm) return;

    const cleanText = String(stepText || "").trim();
    const scopedKey = this.buildKey(stepText, pid, fid, route);
    const now = new Date().toISOString();
    const actionsJson = JSON.stringify(recordedActions);

    try {
      runInTransaction(db, () => {
        db.prepare(
          `INSERT INTO step_cache (
             cache_key, project_id, feature_id, route_path, normalized_text,
             step_text, recorded_actions_json, hit_count, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
           ON CONFLICT(cache_key) DO UPDATE SET
             project_id = excluded.project_id,
             feature_id = excluded.feature_id,
             route_path = excluded.route_path,
             normalized_text = excluded.normalized_text,
             step_text = excluded.step_text,
             recorded_actions_json = excluded.recorded_actions_json,
             updated_at = excluded.updated_at`
        ).run(scopedKey, pid, fid, route, norm, cleanText, actionsJson, now, now);
      });
    } catch (err) {
      logger.debug("Bỏ qua lỗi ghi step_cache SQLite:", err.message);
    }
  }

  /**
   * Xóa băng ghi của một bước khi phát hiện cần học lại (chặt theo key hoặc route hiện tại)
   */
  async invalidateTrace(
    stepText,
    projectId = "default",
    featureId = "default",
    routePath = undefined,
    exactKey = ""
  ) {
    const db = this._getDb();

    if (exactKey) {
      const res = db.prepare("DELETE FROM step_cache WHERE cache_key = ?").run(String(exactKey));
      if (res.changes > 0) return;
    }

    const norm = this.normalizeText(stepText);
    if (!norm) return;

    const pid = String(projectId || "default");
    const fid = String(featureId || "default");

    if (routePath !== undefined) {
      const route = this.normalizeRoute(routePath);
      db.prepare(
        `DELETE FROM step_cache
         WHERE project_id = ? AND feature_id = ? AND normalized_text = ? AND route_path = ?`
      ).run(pid, fid, norm, route);
      return;
    }

    db.prepare(
      `DELETE FROM step_cache
       WHERE project_id = ? AND feature_id = ? AND normalized_text = ?`
    ).run(pid, fid, norm);
  }

  /**
   * Liệt kê danh sách các bước đang được lưu trong Bộ nhớ Cache để hiển thị lên Studio UI
   * @param {{ projectId?: string, featureId?: string, routePath?: string }} [filter]
   */
  async listEntries(filter = {}) {
    const db = this._getDb();
    const { projectId, featureId, routePath } = filter || {};

    const whereClauses = ["feature_id != '*'", "project_id != '*'"];
    const params = [];

    if (projectId) {
      whereClauses.push("project_id = ?");
      params.push(String(projectId));
    }
    if (featureId) {
      whereClauses.push("feature_id = ?");
      params.push(String(featureId));
    }
    if (routePath !== undefined && routePath !== null && String(routePath).trim() !== "") {
      whereClauses.push("route_path = ?");
      params.push(this.normalizeRoute(routePath));
    }

    const rows = db
      .prepare(
        `SELECT cache_key, project_id, feature_id, route_path, normalized_text,
                step_text, recorded_actions_json, hit_count, created_at, updated_at
         FROM step_cache
         WHERE ${whereClauses.join(" AND ")}
         ORDER BY updated_at DESC, rowid DESC`
      )
      .all(...params);

    const items = [];
    for (const row of rows) {
      const actions = safeJsonParse(row.recorded_actions_json, null);
      if (!Array.isArray(actions)) continue;
      items.push({
        key: row.cache_key,
        projectId: row.project_id,
        featureId: row.feature_id,
        routePath: row.route_path || "",
        stepText: row.step_text || row.normalized_text,
        normalizedText: row.normalized_text,
        actionCount: actions.length,
        actionsSummary: actions.map((a) => a.action || a.type || "act"),
        hitCount: Number(row.hit_count || 0),
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
      });
    }

    return items;
  }

  /**
   * Xóa cache theo key cụ thể, theo (projectId, featureId, routePath, stepText) hoặc xóa toàn bộ
   * @param {{ key?: string, projectId?: string, featureId?: string, routePath?: string, stepText?: string, all?: boolean }} [options]
   */
  async clearCache(options = {}) {
    const db = this._getDb();
    const { key, projectId, featureId, routePath, stepText, all } = options || {};

    return runInTransaction(db, () => {
      let deletedCount = 0;

      if (all === true) {
        const res = db.prepare("DELETE FROM step_cache").run();
        return { deletedCount: res.changes, remainingCount: 0 };
      }

      if (key) {
        const res = db.prepare("DELETE FROM step_cache WHERE cache_key = ?").run(String(key));
        deletedCount += res.changes;
      }

      const where = [];
      const params = [];

      if (projectId) {
        where.push("project_id = ?");
        params.push(String(projectId));
      }
      if (featureId) {
        where.push("feature_id = ?");
        params.push(String(featureId));
      }
      if (routePath !== undefined && routePath !== null && String(routePath).trim() !== "") {
        where.push("route_path = ?");
        params.push(this.normalizeRoute(routePath));
      }
      if (stepText) {
        const norm = this.normalizeText(stepText);
        if (norm) {
          where.push("normalized_text = ?");
          params.push(norm);
        }
      }

      if (where.length > 0) {
        const delRes = db
          .prepare(`DELETE FROM step_cache WHERE ${where.join(" AND ")}`)
          .run(...params);
        deletedCount += delRes.changes;
      }

      const remainingCount = db
        .prepare("SELECT COUNT(*) AS cnt FROM step_cache WHERE feature_id != '*' AND project_id != '*'")
        .get()?.cnt || 0;
      return { deletedCount, remainingCount };
    });
  }
}

export const stepCacheService = new StepCacheService();

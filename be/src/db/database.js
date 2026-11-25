import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";
import { migrateFromJsonIfNeeded } from "./migrateFromJson.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BE_ROOT = path.resolve(__dirname, "../../");
export const DEFAULT_DATA_DIR = path.resolve(BE_ROOT, "data");
export const DEFAULT_DB_PATH = path.join(DEFAULT_DATA_DIR, "autotest.db");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  session_mode TEXT NOT NULL DEFAULT 'fresh',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  steps_json TEXT NOT NULL DEFAULT '[]',
  order_index INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_features_project_order
  ON features(project_id, order_index);

CREATE TABLE IF NOT EXISTS project_variables (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  is_secret INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_project_variables_project
  ON project_variables(project_id, key);

CREATE TABLE IF NOT EXISTS feature_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT 'default',
  project_name TEXT NOT NULL DEFAULT 'Dự án kiểm thử',
  feature_id TEXT,
  feature_name TEXT NOT NULL DEFAULT 'Kiểm thử tự động',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'failed',
  error TEXT,
  plan_json TEXT NOT NULL DEFAULT '[]',
  plan_notes TEXT NOT NULL DEFAULT '',
  steps_json TEXT NOT NULL DEFAULT '[]',
  total_steps INTEGER NOT NULL DEFAULT 0,
  passed_steps INTEGER NOT NULL DEFAULT 0,
  failed_steps INTEGER NOT NULL DEFAULT 0,
  timestamp TEXT NOT NULL,
  started_at TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL DEFAULT 0,
  finished_at TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_feature_runs_project_time
  ON feature_runs(project_id, started_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_feature_runs_feature
  ON feature_runs(feature_id, started_at_ms DESC);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT 'default',
  project_name TEXT NOT NULL DEFAULT 'Dự án kiểm thử',
  name TEXT NOT NULL DEFAULT 'Đợt chạy kiểm thử',
  status TEXT NOT NULL DEFAULT 'Kết thúc',
  notes TEXT NOT NULL DEFAULT '',
  warning TEXT,
  timestamp TEXT NOT NULL,
  started_at TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL DEFAULT 0,
  finished_at TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  passed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_batches_project_time
  ON batches(project_id, started_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_batches_started_at_ms
  ON batches(started_at_ms DESC);

CREATE TABLE IF NOT EXISTS batch_features (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL,
  feature_name TEXT NOT NULL DEFAULT '',
  linked_run_id TEXT REFERENCES feature_runs(id) ON DELETE SET NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  steps_json TEXT NOT NULL DEFAULT '[]',
  step_results_json TEXT NOT NULL DEFAULT '[]',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(batch_id, order_index)
);

CREATE INDEX IF NOT EXISTS idx_batch_features_batch
  ON batch_features(batch_id, order_index);

CREATE INDEX IF NOT EXISTS idx_batch_features_linked_run
  ON batch_features(linked_run_id);

CREATE INDEX IF NOT EXISTS idx_batch_features_feature_id
  ON batch_features(feature_id);

CREATE TABLE IF NOT EXISTS run_screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT REFERENCES batches(id) ON DELETE CASCADE,
  feature_run_id TEXT REFERENCES feature_runs(id) ON DELETE CASCADE,
  feature_id TEXT,
  dir_name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'after',
  label TEXT,
  sublabel TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_screenshots_batch
  ON run_screenshots(batch_id);

CREATE INDEX IF NOT EXISTS idx_run_screenshots_run
  ON run_screenshots(feature_run_id);

CREATE INDEX IF NOT EXISTS idx_run_screenshots_dir
  ON run_screenshots(dir_name);

CREATE TABLE IF NOT EXISTS step_cache (
  cache_key TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT 'default',
  feature_id TEXT NOT NULL DEFAULT 'default',
  route_path TEXT NOT NULL DEFAULT '',
  normalized_text TEXT NOT NULL,
  step_text TEXT NOT NULL,
  recorded_actions_json TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_step_cache_lookup
  ON step_cache(project_id, feature_id, normalized_text, route_path);

CREATE INDEX IF NOT EXISTS idx_step_cache_norm
  ON step_cache(normalized_text);
`;

const TX_DEPTH = Symbol("txDepth");

/**
 * Thực thi đồng bộ bên trong giao dịch SQLite (hỗ trợ nested savepoints)
 */
export function runInTransaction(db, fn) {
  const depth = db[TX_DEPTH] || 0;
  const isOuter = depth === 0;
  const savepointName = `sp_${depth}`;

  if (isOuter) {
    db.exec("BEGIN IMMEDIATE");
  } else {
    db.exec(`SAVEPOINT ${savepointName}`);
  }
  db[TX_DEPTH] = depth + 1;

  try {
    const result = fn(db);
    if (isOuter) {
      db.exec("COMMIT");
    } else {
      db.exec(`RELEASE SAVEPOINT ${savepointName}`);
    }
    return result;
  } catch (err) {
    try {
      if (isOuter) {
        db.exec("ROLLBACK");
      } else {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      }
    } catch {}
    throw err;
  } finally {
    db[TX_DEPTH] = depth;
  }
}

/**
 * Khởi tạo một kết nối SQLite mới (dùng được cho cả file thật và ":memory:" khi test)
 */
export function createDatabase({
  dbPath = DEFAULT_DB_PATH,
  dataDir = DEFAULT_DATA_DIR,
  autoMigrate = true,
} = {}) {
  const isMemory = dbPath === ":memory:";
  if (!isMemory) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store = MEMORY;
  `);

  db.exec(SCHEMA_SQL);

  // Migration an toàn cho DB autotest.db đã tồn tại trước đó: bổ sung cột session_mode nếu chưa có
  try {
    const projectCols = db.prepare("PRAGMA table_info(projects)").all();
    if (!projectCols.some((c) => c.name === "session_mode")) {
      db.exec("ALTER TABLE projects ADD COLUMN session_mode TEXT NOT NULL DEFAULT 'fresh'");
    }
  } catch (migErr) {
    logger.warn(`[SQLite] Không thể bổ sung cột session_mode: ${migErr.message}`);
  }

  if (autoMigrate) {
    migrateFromJsonIfNeeded(db, { dataDir });
  }

  // Dọn bỏ các bản ghi wildcard '*' cũ dùng chung mù quáng giữa các tính năng
  try {
    db.exec("DELETE FROM step_cache WHERE feature_id = '*' OR project_id = '*'");
  } catch {}

  return db;
}

let singletonDb = null;

/**
 * Trả về instance SQLite singleton dùng chung cho toàn bộ backend
 */
export function getDatabase() {
  if (!singletonDb) {
    const customPath = process.env.AUTOTEST_DB_PATH || DEFAULT_DB_PATH;
    const customDataDir = customPath && customPath !== DEFAULT_DB_PATH
      ? path.dirname(customPath)
      : DEFAULT_DATA_DIR;
    singletonDb = createDatabase({
      dbPath: customPath,
      dataDir: customDataDir,
      autoMigrate: true,
    });
    logger.info(`[SQLite] Đã kết nối cơ sở dữ liệu: ${customPath}`);
  }
  return singletonDb;
}

/**
 * Đóng kết nối SQLite an toàn khi shutdown server (checkpoint WAL)
 */
export function closeDatabase() {
  if (!singletonDb) return;
  try {
    try {
      singletonDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {}
    singletonDb.close();
    logger.info("[SQLite] Đã đóng kết nối cơ sở dữ liệu an toàn.");
  } catch (err) {
    logger.warn("[SQLite] Lỗi khi đóng cơ sở dữ liệu:", err.message);
  } finally {
    singletonDb = null;
  }
}

import { ConflictError } from "../errors/AppError.js";

/**
 * AsyncLock (Mutex / Concurrency Coordinator)
 * Thay thế biến cờ nguyên thủy `let busy = false` bằng một đối tượng có trạng thái,
 * metadata theo dõi, và cơ chế runExclusive an toàn với try/finally.
 */
export class AsyncLock {
  constructor(name = "resource-lock") {
    this.name = name;
    this._locked = false;
    this._currentTask = null;
    this._acquiredAt = null;
  }

  get isLocked() {
    return this._locked;
  }

  get status() {
    return {
      name: this.name,
      isBusy: this._locked,
      currentTask: this._currentTask,
      acquiredAt: this._acquiredAt,
      runningDurationMs: this._acquiredAt ? Date.now() - this._acquiredAt.getTime() : 0,
    };
  }

  /**
   * Thử chiếm quyền khóa một cách nguyên tử (non-blocking)
   * Tự động giải phóng nếu khóa bị giữ quá thời gian an toàn (Watchdog 10 phút)
   * @param {Record<string, unknown>} [metadata]
   * @param {number} [maxDurationMs]
   * @returns {boolean}
   */
  tryAcquire(metadata = null, maxDurationMs = 10 * 60 * 1000) {
    if (this._locked) {
      if (this._acquiredAt && Date.now() - this._acquiredAt.getTime() > maxDurationMs) {
        this.release();
      } else {
        return false;
      }
    }
    this._locked = true;
    this._currentTask = metadata;
    this._acquiredAt = new Date();
    return true;
  }

  /**
   * Giải phóng khóa
   */
  release() {
    this._locked = false;
    this._currentTask = null;
    this._acquiredAt = null;
  }

  /**
   * Thực thi một async function độc quyền.
   * Ném ConflictError (409) ngay nếu đang có tác vụ khác chạy.
   * Đảm bảo luôn giải phóng khóa trong block finally.
   *
   * @template T
   * @param {() => Promise<T>} taskFn
   * @param {Record<string, unknown>} [metadata]
   * @param {string} [conflictMessage]
   * @returns {Promise<T>}
   */
  async runExclusive(taskFn, metadata = null, conflictMessage = "Đang có lần chạy khác, thử lại sau") {
    if (!this.tryAcquire(metadata)) {
      throw new ConflictError(conflictMessage);
    }

    try {
      return await taskFn();
    } finally {
      this.release();
    }
  }
}

export const runnerLock = new AsyncLock("test-runner");


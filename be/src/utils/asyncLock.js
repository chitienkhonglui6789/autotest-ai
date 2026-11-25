import { ConflictError } from "../errors/AppError.js";

/**
 * AsyncLock (Mutex / Concurrency Coordinator)
 * Điều phối độc quyền phiên chạy (Single Runner / Batch Runner),
 * hỗ trợ đồng bộ Hủy tác vụ (cancelCurrentAndWait) đảm bảo tài nguyên & lock nhả hoàn toàn trước khi trả HTTP response.
 */
export class AsyncLock {
  constructor(name = "resource-lock") {
    this.name = name;
    this._locked = false;
    this._currentTask = null;
    this._acquiredAt = null;
    this._abortController = null;
    this._managedByRunExclusive = false;
    this._completionPromise = null;
    this._resolveCompletion = null;
  }

  get isLocked() {
    return this._locked;
  }

  get isBusy() {
    return this._locked;
  }

  get abortController() {
    return this._abortController;
  }

  get status() {
    return {
      name: this.name,
      isBusy: this._locked,
      currentTask: this._currentTask,
      ownerToken: this._currentTask?.ownerToken || null,
      batchId: this._currentTask?.batchId || null,
      acquiredAt: this._acquiredAt,
      runningDurationMs: this._acquiredAt ? Date.now() - this._acquiredAt.getTime() : 0,
    };
  }

  _initCompletionTracker() {
    let resolver = null;
    this._completionPromise = new Promise((resolve) => {
      resolver = resolve;
    });
    this._resolveCompletion = () => {
      const fn = resolver;
      resolver = null;
      this._completionPromise = null;
      this._resolveCompletion = null;
      if (fn) fn();
    };
  }

  /**
   * Gia hạn thời gian watchdog khi Batch đang chuyển tiếp hợp lệ sang tính năng tiếp theo
   */
  touch() {
    if (this._locked) {
      this._acquiredAt = new Date();
    }
  }

  /**
   * Thử chiếm quyền khóa một cách nguyên tử (non-blocking)
   */
  tryAcquire(metadata = null, maxDurationMs = 10 * 60 * 1000, abortController = null) {
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
    this._abortController = abortController;
    this._initCompletionTracker();
    return true;
  }

  /**
   * Gửi tín hiệu hủy (non-blocking) - giữ tương thích ngược
   */
  cancelCurrent(token = null, force = false) {
    if (!this._locked) {
      return { success: false, alreadyIdle: true, message: "Không có tác vụ nào đang chạy" };
    }
    const currentOwner = this._currentTask?.ownerToken;
    if (!force && currentOwner && currentOwner !== token) {
      return {
        success: false,
        message: "Bạn không phải người khởi chạy đợt test này. Chỉ người chạy mới có quyền dừng!",
        forbidden: true,
      };
    }
    if (this._abortController && !this._abortController.signal.aborted) {
      this._abortController.abort(new Error("User cancelled"));
    }
    if (!this._managedByRunExclusive || !this._abortController) {
      this.release();
    }
    return { success: true, message: "Đã gửi tín hiệu hủy phiên kiểm thử" };
  }

  /**
   * Hủy tác vụ đang chạy và CHỜ ĐỢI tới khi tác vụ dọn trình duyệt + lưu SQLite + giải phóng lock hoàn tất.
   * Đảm bảo không bao giờ dính 409 Conflict khi bấm Chạy lại ngay sau khi Hủy.
   */
  async cancelCurrentAndWait(token = null, force = false, timeoutMs = 15000) {
    if (!this._locked) {
      return {
        success: true,
        alreadyIdle: true,
        message: "Không có phiên chạy nào đang thực thi",
        runner: this.status,
      };
    }

    const currentOwner = this._currentTask?.ownerToken;
    if (!force && currentOwner && currentOwner !== token) {
      return {
        success: false,
        forbidden: true,
        message: "Bạn không phải người khởi chạy đợt test này. Chỉ người chạy mới có quyền dừng!",
        runner: this.status,
      };
    }

    const pendingCompletion = this._completionPromise;

    if (this._abortController && !this._abortController.signal.aborted) {
      this._abortController.abort(new Error("User cancelled"));
    }

    if (!this._managedByRunExclusive || !this._abortController) {
      this.release();
    } else if (pendingCompletion) {
      let timer = null;
      await Promise.race([
        pendingCompletion,
        new Promise((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
    }

    return {
      success: !this._locked,
      alreadyIdle: false,
      timedOut: this._locked,
      message: this._locked
        ? "Đã gửi tín hiệu hủy nhưng tiến trình dọn dẹp chưa kết thúc hoàn toàn"
        : "Đã hủy phiên kiểm thử và giải phóng khóa hoàn toàn",
      runner: this.status,
    };
  }

  /**
   * Giải phóng khóa & thông báo cho các coroutine đang chờ hủy
   */
  release() {
    this._locked = false;
    this._currentTask = null;
    this._acquiredAt = null;
    this._abortController = null;
    this._managedByRunExclusive = false;
    if (this._resolveCompletion) {
      this._resolveCompletion();
    }
  }

  /**
   * Thực thi tác vụ đồng bộ độc quyền (chờ tới khi hoàn tất)
   */
  async runExclusive(
    taskFn,
    metadata = null,
    conflictMessage = "Đang có lần chạy khác, thử lại sau",
    abortController = null,
    maxDurationMs = 10 * 60 * 1000
  ) {
    if (!this.tryAcquire(metadata, maxDurationMs, abortController)) {
      throw new ConflictError(conflictMessage);
    }
    this._managedByRunExclusive = true;

    try {
      return await taskFn();
    } finally {
      this.release();
    }
  }

  /**
   * Chiếm khóa ngay lập tức, chạy `onSetup()` (trả về dữ liệu khởi tạo cho HTTP 202),
   * sau đó chạy `onBackground()` dưới nền và tự nhả khóa khi `onBackground()` kết thúc.
   */
  async startBackgroundExclusive({
    onSetup,
    onBackground,
    metadata = null,
    conflictMessage = "Đang có lần chạy khác, thử lại sau",
    abortController = new AbortController(),
    maxDurationMs = 30 * 60 * 1000,
    onBackgroundError = null,
  }) {
    if (!this.tryAcquire(metadata, maxDurationMs, abortController)) {
      throw new ConflictError(conflictMessage);
    }
    this._managedByRunExclusive = true;

    let setupResult;
    try {
      setupResult = await onSetup();
    } catch (err) {
      this.release();
      throw err;
    }

    Promise.resolve()
      .then(() => onBackground())
      .catch((err) => {
        if (typeof onBackgroundError === "function") {
          onBackgroundError(err);
        }
      })
      .finally(() => {
        this.release();
      });

    return setupResult;
  }
}

export const runnerLock = new AsyncLock("test-runner");

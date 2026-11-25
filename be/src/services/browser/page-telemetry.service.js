const DEFAULT_MAX_BUFFER_SIZE = 100;
const MAX_BODY_BYTES = 16 * 1024;

const IGNORED_RESOURCE_TYPES = new Set([
  "image",
  "font",
  "media",
  "stylesheet",
  "websocket",
  "eventsource",
  "ping",
  "beacon",
]);

const CRITICAL_RESOURCE_TYPES = new Set(["xhr", "fetch", "document"]);

const IGNORED_URL_PATTERN =
  /(?:google-analytics|googletagmanager|gtag|sentry|hotjar|heartbeat|intercom|tawk\.to|crisp\.chat|zendesk|hubspot|livechat|subiz|datadoghq|clarity\.ms|mixpanel|segment\.io|amplitude|facebook\.com\/tr|doubleclick|(?:^|[/._?&=-])poll(?:s|ing)?(?:$|[/._?&=&#-]))/i;

const AUTH_REDIRECT_URL_PATTERN =
  /(?:^|\/)(?:login|signin|sign-in|auth|sso|oauth|keycloak|cas)(?:[/?#]|$)/i;

/**
 * Theo dõi Network in-flight, HTTP 4xx/5xx, JSON business error, Console/PageError và 401/403 Auth Signals
 * trên từng Playwright Page (hỗ trợ đa tab, bounded ring buffer, cursor slicing theo bước).
 */
export class PageTelemetryService {
  constructor({ maxBufferSize = DEFAULT_MAX_BUFFER_SIZE } = {}) {
    this.maxBufferSize = Math.max(10, Number(maxBufferSize) || DEFAULT_MAX_BUFFER_SIZE);
    this._pageBindings = new WeakMap();
    this._contextBindings = new WeakMap();
  }

  /**
   * Tạo state telemetry mới cho một session
   */
  createSessionState() {
    return {
      seqCounter: 0,
      inFlightRequests: new Map(),
      responses: [],
      pageErrors: [],
      authSignals: [],
      pendingBodyReads: new Set(),
    };
  }

  /**
   * Đảm bảo session luôn có state telemetry hợp lệ
   */
  ensureSessionState(session) {
    if (!session || typeof session !== "object") return null;
    if (!session.telemetry || typeof session.telemetry !== "object") {
      session.telemetry = this.createSessionState();
    } else {
      const t = session.telemetry;
      if (typeof t.seqCounter !== "number") t.seqCounter = 0;
      if (!(t.inFlightRequests instanceof Map)) t.inFlightRequests = new Map();
      if (!Array.isArray(t.responses)) t.responses = [];
      if (!Array.isArray(t.pageErrors)) t.pageErrors = [];
      if (!Array.isArray(t.authSignals)) t.authSignals = [];
      if (!(t.pendingBodyReads instanceof Set)) t.pendingBodyReads = new Set();
    }
    return session.telemetry;
  }

  isIgnoredResourceType(resourceType) {
    return IGNORED_RESOURCE_TYPES.has(String(resourceType || "").toLowerCase());
  }

  isIgnoredUrl(url) {
    const raw = String(url || "");
    if (!raw) return true;
    if (/^(?:data|blob|about|chrome-extension):/i.test(raw)) return true;
    return IGNORED_URL_PATTERN.test(raw);
  }

  isCriticalRequest(request) {
    if (!request) return false;
    try {
      const resourceType = String(request.resourceType?.() || "").toLowerCase();
      if (this.isIgnoredResourceType(resourceType)) return false;
      if (!CRITICAL_RESOURCE_TYPES.has(resourceType)) return false;
      const method = String(request.method?.() || "GET").toUpperCase();
      if (method === "OPTIONS") return false;
      const url = request.url?.() || "";
      if (this.isIgnoredUrl(url)) return false;
      return true;
    } catch {
      return false;
    }
  }

  _pushRing(buffer, item) {
    buffer.push(item);
    if (buffer.length > this.maxBufferSize) {
      buffer.splice(0, buffer.length - this.maxBufferSize);
    }
  }

  _inspectJsonPayload(parsed, status) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { isBusinessError: false, errorHint: null };
    }

    const statusField = typeof parsed.status === "string" ? parsed.status.toLowerCase() : null;
    const hasErrorsArray = Array.isArray(parsed.errors) && parsed.errors.length > 0;
    const hasTruthyError = Boolean(parsed.error);

    const isBusinessError =
      parsed.ok === false ||
      parsed.success === false ||
      statusField === "error" ||
      hasTruthyError ||
      hasErrorsArray;

    let errorHint = null;
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      errorHint = parsed.error.trim();
    } else if (parsed.error && typeof parsed.error === "object") {
      errorHint = parsed.error.message || parsed.error.msg || JSON.stringify(parsed.error);
    } else if (hasErrorsArray) {
      const firstErr = parsed.errors[0];
      errorHint =
        typeof firstErr === "string"
          ? firstErr
          : firstErr?.message || firstErr?.msg || JSON.stringify(firstErr);
    } else if ((isBusinessError || status >= 400) && typeof parsed.message === "string" && parsed.message.trim()) {
      errorHint = parsed.message.trim();
    } else if ((isBusinessError || status >= 400) && typeof parsed.msg === "string" && parsed.msg.trim()) {
      errorHint = parsed.msg.trim();
    }

    if (errorHint) {
      errorHint = String(errorHint).slice(0, 240);
    }

    return { isBusinessError, errorHint };
  }

  _attachContextMultiTab(page, binding) {
    try {
      const context = typeof page.context === "function" ? page.context() : null;
      if (!context || typeof context.on !== "function") return;
      const existingCtx = this._contextBindings.get(context);
      if (existingCtx) {
        existingCtx.session = binding.session;
        return;
      }
      const ctxBinding = { session: binding.session };
      this._contextBindings.set(context, ctxBinding);
      context.on("page", (newPage) => {
        try {
          this.attach(newPage, ctxBinding.session);
        } catch {}
      });
    } catch {}
  }

  /**
   * Gắn bộ lắng nghe telemetry lên Page theo cách idempotent (không trùng listener)
   */
  attach(page, session) {
    if (!page || typeof page.on !== "function") return;
    const state = this.ensureSessionState(session);
    if (!state) return;

    const existing = this._pageBindings.get(page);
    if (existing) {
      existing.session = session;
      existing.state = state;
      this._attachContextMultiTab(page, existing);
      return;
    }

    const binding = { session, state };
    this._pageBindings.set(page, binding);
    this._attachContextMultiTab(page, binding);

    page.on("request", (request) => {
      try {
        const curState = binding.state;
        const url = request.url?.() || "";
        const method = String(request.method?.() || "GET").toUpperCase();
        const resourceType = String(request.resourceType?.() || "other").toLowerCase();
        const critical = this.isCriticalRequest(request);
        curState.inFlightRequests.set(request, {
          url,
          method,
          resourceType,
          startedAt: Date.now(),
          critical,
          page,
        });
      } catch {}
    });

    page.on("requestfinished", (request) => {
      try {
        binding.state.inFlightRequests.delete(request);
      } catch {}
    });

    page.on("requestfailed", (request) => {
      try {
        const curState = binding.state;
        curState.inFlightRequests.delete(request);
        if (!this.isCriticalRequest(request)) return;
        const errorText = String(request.failure?.()?.errorText || "Request failed");
        if (errorText.includes("ERR_ABORTED") || errorText.includes("NS_BINDING_ABORTED")) {
          return;
        }
        const entry = {
          seq: ++curState.seqCounter,
          timestamp: Date.now(),
          url: request.url?.() || "",
          method: String(request.method?.() || "GET").toUpperCase(),
          status: 0,
          resourceType: String(request.resourceType?.() || "other").toLowerCase(),
          isBusinessError: false,
          failed: true,
          errorHint: errorText.slice(0, 240),
        };
        this._pushRing(curState.responses, entry);
      } catch {}
    });

    page.on("response", (response) => {
      try {
        const curState = binding.state;
        const request = response.request?.();
        if (request) {
          curState.inFlightRequests.delete(request);
        }
        const url = response.url?.() || request?.url?.() || "";
        const status = Number(response.status?.() || 0);
        const method = String(request?.method?.() || "GET").toUpperCase();
        const resourceType = String(request?.resourceType?.() || "other").toLowerCase();

        if (this.isIgnoredUrl(url) || this.isIgnoredResourceType(resourceType)) {
          if (request) curState.inFlightRequests.delete(request);
          return;
        }
        if (method === "OPTIONS" && status < 400) {
          if (request) curState.inFlightRequests.delete(request);
          return;
        }

        const headers = response.headers?.() || {};
        const location = headers["location"] || "";

        if (status >= 300 && status < 400 && location && AUTH_REDIRECT_URL_PATTERN.test(location)) {
          this._pushRing(curState.authSignals, {
            seq: ++curState.seqCounter,
            timestamp: Date.now(),
            url,
            targetUrl: location,
            method,
            status,
            resourceType,
            type: "auth_redirect",
            errorHint: `Redirect to auth: ${location}`.slice(0, 240),
          });
        } else if (
          resourceType === "document" &&
          status < 400 &&
          request?.redirectedFrom?.() &&
          AUTH_REDIRECT_URL_PATTERN.test(url)
        ) {
          this._pushRing(curState.authSignals, {
            seq: ++curState.seqCounter,
            timestamp: Date.now(),
            url,
            method,
            status,
            resourceType,
            type: "auth_redirect",
            errorHint: `Navigated to auth path: ${url}`.slice(0, 240),
          });
        }

        let authEntry = null;
        if ((status === 401 || status === 403) && (CRITICAL_RESOURCE_TYPES.has(resourceType) || /\/api\//i.test(url))) {
          authEntry = {
            seq: ++curState.seqCounter,
            timestamp: Date.now(),
            url,
            method,
            status,
            resourceType,
            type: "http_auth",
            errorHint: `HTTP ${status}`,
          };
          this._pushRing(curState.authSignals, authEntry);
        }

        if (!CRITICAL_RESOURCE_TYPES.has(resourceType) && status < 400) {
          if (request) curState.inFlightRequests.delete(request);
          return;
        }

        const entry = {
          seq: ++curState.seqCounter,
          timestamp: Date.now(),
          url,
          method,
          status,
          resourceType,
          isBusinessError: false,
          errorHint: status >= 400 ? `HTTP ${status}` : null,
        };
        this._pushRing(curState.responses, entry);

        const contentType = String(headers["content-type"] || "").toLowerCase();
        const isJson = contentType.includes("application/json") || contentType.includes("+json");
        const contentLengthRaw = headers["content-length"];
        const contentLength = contentLengthRaw !== undefined ? Number(contentLengthRaw) : null;
        const hasNoBodyStatus = status === 204 || status === 205 || status === 304 || (status >= 300 && status < 400);

        const shouldInspectBody =
          isJson &&
          !hasNoBodyStatus &&
          method !== "OPTIONS" &&
          method !== "HEAD" &&
          (status >= 400 || status === 200) &&
          (contentLength === null || (!Number.isNaN(contentLength) && contentLength < MAX_BODY_BYTES));

        if (shouldInspectBody && typeof response.text === "function") {
          const readPromise = (async () => {
            let bodyTimer = null;
            try {
              if (page.isClosed?.()) return;
              const text = await Promise.race([
                response.text(),
                new Promise((_, reject) => {
                  bodyTimer = setTimeout(() => reject(new Error("response.text timeout")), 500);
                  bodyTimer.unref?.();
                }),
              ]);
              if (!text || Buffer.byteLength(text, "utf8") >= MAX_BODY_BYTES) return;
              const parsed = JSON.parse(text);
              const { isBusinessError, errorHint } = this._inspectJsonPayload(parsed, status);
              if (isBusinessError) {
                entry.isBusinessError = true;
              }
              if (errorHint) {
                entry.errorHint = errorHint;
                if (authEntry) {
                  authEntry.errorHint = errorHint;
                }
              }
            } catch {
              // Bỏ qua lỗi đọc body khi page đóng đột ngột, body chưa được tiêu thụ, hoặc JSON không hợp lệ
            } finally {
              if (bodyTimer) clearTimeout(bodyTimer);
            }
          })();

          curState.pendingBodyReads.add(readPromise);
          readPromise.finally(() => {
            curState.pendingBodyReads.delete(readPromise);
          });
        }
      } catch {}
    });

    page.on("pageerror", (err) => {
      try {
        const curState = binding.state;
        const message = String(err?.message || err || "Uncaught pageerror").slice(0, 500);
        this._pushRing(curState.pageErrors, {
          seq: ++curState.seqCounter,
          timestamp: Date.now(),
          type: "pageerror",
          message,
        });
      } catch {}
    });

    page.on("console", (msg) => {
      try {
        if (msg?.type?.() !== "error") return;
        const text = String(msg.text?.() || "").trim();
        if (!text) return;
        if (/favicon\.ico|chrome-extension:\/\//i.test(text) || IGNORED_URL_PATTERN.test(text)) {
          return;
        }
        const curState = binding.state;
        this._pushRing(curState.pageErrors, {
          seq: ++curState.seqCounter,
          timestamp: Date.now(),
          type: "console.error",
          message: text.slice(0, 500),
        });
      } catch {}
    });

    page.on("close", () => {
      try {
        const curState = binding.state;
        for (const [req, info] of curState.inFlightRequests.entries()) {
          if (info.page === page) {
            curState.inFlightRequests.delete(req);
          }
        }
      } catch {}
    });
  }

  /**
   * Chờ các tác vụ đọc JSON body đang xử lý dở hoàn tất (hữu ích trước khi đọc delta)
   */
  async flush(session, maxWaitMs = 300) {
    const state = this.ensureSessionState(session);
    if (!state || state.pendingBodyReads.size === 0) return;
    const pending = Array.from(state.pendingBodyReads);
    let timer = null;
    try {
      await Promise.race([
        Promise.allSettled(pending),
        new Promise((resolve) => {
          timer = setTimeout(resolve, maxWaitMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Tạo con trỏ mốc thời gian cho bước/hành động mới
   */
  createCursor(session) {
    const state = this.ensureSessionState(session);
    return {
      seq: state ? state.seqCounter : 0,
      timestamp: Date.now(),
    };
  }

  /**
   * Đếm số critical request đang còn in-flight
   */
  getCriticalInFlightCount(session, sinceTimestamp = null) {
    const state = this.ensureSessionState(session);
    if (!state) return 0;
    let count = 0;
    for (const info of state.inFlightRequests.values()) {
      if (!info.critical) continue;
      if (info.page?.isClosed?.()) continue;
      if (sinceTimestamp !== null && sinceTimestamp !== undefined && info.startedAt < sinceTimestamp) {
        continue;
      }
      count++;
    }
    return count;
  }

  /**
   * Lấy lát cắt toàn bộ tín hiệu mạng/lỗi phát sinh sau cursor
   */
  getDeltaSince(session, cursor = null) {
    const state = this.ensureSessionState(session);
    if (!state) {
      return {
        criticalInFlightCount: 0,
        responses: [],
        failedResponses: [],
        businessErrorResponses: [],
        serverErrorResponses: [],
        authErrorResponses: [],
        pageErrors: [],
      };
    }

    const hasSeq = cursor && typeof cursor.seq === "number";
    const afterSeq = hasSeq ? cursor.seq : 0;
    const sinceTs = cursor && typeof cursor.timestamp === "number" ? cursor.timestamp : 0;
    const afterCursor = (item) => (hasSeq ? item.seq > afterSeq : item.timestamp >= sinceTs);

    const responses = state.responses.filter(afterCursor);
    const failedResponses = responses.filter((r) => r.status >= 400 || r.isBusinessError || r.failed);
    const businessErrorResponses = responses.filter((r) => r.isBusinessError);
    const serverErrorResponses = responses.filter((r) => r.status >= 500);
    const authErrorResponses = state.authSignals.filter(afterCursor);
    const pageErrors = state.pageErrors.filter(afterCursor);

    return {
      criticalInFlightCount: this.getCriticalInFlightCount(session),
      responses,
      failedResponses,
      businessErrorResponses,
      serverErrorResponses,
      authErrorResponses,
      pageErrors,
    };
  }
}

export const pageTelemetryService = new PageTelemetryService();

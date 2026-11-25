import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { browserLifecycleService } from "../src/services/browser/browser-lifecycle.service.js";
import { pageTelemetryService } from "../src/services/browser/page-telemetry.service.js";
import { atomicActionsService } from "../src/services/engine/atomic-actions.service.js";
import { MicroAgentRunnerService } from "../src/services/engine/micro-agent-runner.service.js";
import { evaluateCausalDiagnostics } from "../src/services/browser/diagnostics.service.js";
import {
  FAILURE_TYPES,
  VERDICT_STATUS,
  DIAGNOSTIC_STRICTNESS,
  ORACLE_SOURCES,
  classifyStepVerdict,
} from "../src/constants/stepTypes.js";

async function startVerdictTestServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");

    if (url.pathname === "/missing-page") {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>404 Not Found</h1>");
      return;
    }

    if (url.pathname === "/dashboard") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
        <html lang="vi">
        <head><meta charset="utf-8"><title>Dashboard Chuẩn Kiểm Chứng</title></head>
        <body>
          <header>
            <span id="date-label">Ngày 19/11/2026</span>
            <span id="price-hint">Giá mẫu: $15.99</span>
            <span id="cart-badge" class="shopping_cart_badge">0</span>
          </header>

          <table id="orders-table">
            <thead><tr><th>Mã đơn</th><th>Trạng thái</th><th>Tổng tiền</th></tr></thead>
            <tbody id="orders-body">
              <tr><td>DH-2026-1001</td><td>Đã hủy</td><td>12.000.000đ</td></tr>
              <tr><td>DH-2026-1002</td><td>Chờ xử lý</td><td>58.500.000đ</td></tr>
            </tbody>
          </table>

          <table id="empty-table">
            <thead><tr><th>Mã</th></tr></thead>
            <tbody id="empty-body">
              <tr><td>Không có dữ liệu</td></tr>
            </tbody>
          </table>

          <div id="chips-wrap">
            <span class="tag-chip">Ngân hàng số</span>
            <span class="tag-chip">Trí tuệ nhân tạo</span>
          </div>

          <button id="btn-checkout" disabled>Thanh toán</button>
          <input id="chk-terms" type="checkbox" checked />
          <div id="total-display">58.500.000đ</div>

          <div id="shadow-host"></div>
          <script>
            const host = document.getElementById("shadow-host");
            const sr = host.attachShadow({ mode: "open" });
            sr.innerHTML = '<input id="guid-input" type="text" value="" placeholder="GUID" />';
          </script>
        </body>
        </html>`);
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>Home</h1>");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe("Chuẩn đánh giá PASS / PASSED_WITH_WARNINGS / FAILED / BROKEN (Big Tech Verdict Standard)", () => {
  let server;
  let browser;
  let context;
  let page;
  let session;

  before(async () => {
    server = await startVerdictTestServer();
    const launched = await browserLifecycleService.launch({ browser: { headless: true } });
    browser = launched.browser;
    context = launched.context;
    page = launched.page;
    session = {
      browser,
      context,
      currentPage: page,
      vars: { tong_tien_ky_vong: "58500000" },
      dialogHistory: [],
      downloadedFiles: [],
      currentStepDownloads: [],
      prevStepDownloads: [],
      telemetry: pageTelemetryService.createSessionState(),
    };
  });

  after(async () => {
    await browserLifecycleService.destroyAll();
    if (server) await server.close();
  });

  it("1. Scoped assertText chặn 100% pass giả mù ngữ cảnh (badge giỏ hàng = 0 không khớp nhầm số 1 ở ngày/giá, dòng DH-1001 không khớp nhầm dòng DH-1002)", async () => {
    await page.goto(`${server.url}/dashboard`, { waitUntil: "domcontentloaded" });

    // 1a. Giỏ hàng đang là 0, nhưng trang có số "1" ở ngày 19/11/2026 -> Scoped assert vào #cart-badge PHẢI FAIL!
    await assert.rejects(
      () =>
        atomicActionsService.executeAction(
          {
            action: "assert",
            value: "1",
            timeoutMs: 600,
            fingerprint: { elemId: "cart-badge", tag: "span" },
          },
          session
        ),
      (err) => {
        assert.equal(err.failureType, FAILURE_TYPES.ASSERTION_FAILED);
        assert.equal(err.isProductDefect, true);
        assert.equal(err.evidence?.oracleSource, ORACLE_SOURCES.DETERMINISTIC_ASSERT);
        assert.equal(err.evidence?.passed, false);
        assert.match(err.evidence?.actual || "", /0/);
        return true;
      }
    );

    // 1b. Dòng DH-2026-1001 có trạng thái "Đã hủy" (dòng 1002 mới là "Chờ xử lý") -> Scoped containerAnchor DH-2026-1001 PHẢI FAIL!
    await assert.rejects(
      () =>
        atomicActionsService.executeAction(
          {
            action: "assert",
            value: "Chờ xử lý",
            containerAnchor: "DH-2026-1001",
            timeoutMs: 600,
          },
          session
        ),
      (err) => {
        assert.equal(err.failureType, FAILURE_TYPES.ASSERTION_FAILED);
        assert.match(err.evidence?.actual || "", /Đã hủy/);
        return true;
      }
    );

    // 1c. Dòng DH-2026-1002 thực sự có "Chờ xử lý" -> PASS kèm Evidence chuẩn!
    const okRes = await atomicActionsService.executeAction(
      {
        action: "assert",
        value: "Chờ xử lý",
        containerAnchor: "DH-2026-1002",
        timeoutMs: 1000,
      },
      session
    );
    assert.equal(okRes.success, true);
    assert.equal(okRes.evidence?.passed, true);
    assert.equal(okRes.evidence?.oracleSource, ORACLE_SOURCES.DETERMINISTIC_ASSERT);
  });

  it("2. assertUrl & assertUrlNot kiểm chứng URL chính xác kèm Expected/Actual", async () => {
    await page.goto(`${server.url}/dashboard`, { waitUntil: "domcontentloaded" });

    const okUrl = await atomicActionsService.executeAction(
      { action: "assertUrl", value: "/dashboard", timeoutMs: 800 },
      session
    );
    assert.equal(okUrl.success, true);
    assert.equal(okUrl.evidence?.assertType, "url");
    assert.match(okUrl.evidence?.actual || "", /\/dashboard/);

    await assert.rejects(
      () => atomicActionsService.executeAction({ action: "assertUrl", value: "/admin-only", timeoutMs: 500 }, session),
      (err) => {
        assert.equal(err.failureType, FAILURE_TYPES.ASSERTION_FAILED);
        assert.match(err.evidence?.expected || "", /\/admin-only/);
        assert.match(err.evidence?.actual || "", /\/dashboard/);
        return true;
      }
    );
  });

  it("3. assertState kiểm chứng disabled / checked / enabled chuẩn xác", async () => {
    await page.goto(`${server.url}/dashboard`, { waitUntil: "domcontentloaded" });

    const disabledOk = await atomicActionsService.executeAction(
      { action: "assertState", state: "disabled", fingerprint: { elemId: "btn-checkout", tag: "button" }, timeoutMs: 800 },
      session
    );
    assert.equal(disabledOk.success, true);
    assert.equal(disabledOk.evidence?.actual, "disabled");

    const checkedOk = await atomicActionsService.executeAction(
      { action: "assertState", state: "checked", fingerprint: { elemId: "chk-terms", tag: "input" }, timeoutMs: 800 },
      session
    );
    assert.equal(checkedOk.success, true);

    await assert.rejects(
      () =>
        atomicActionsService.executeAction(
          { action: "assertState", state: "enabled", fingerprint: { elemId: "btn-checkout", tag: "button" }, timeoutMs: 500 },
          session
        ),
      (err) => {
        assert.equal(err.failureType, FAILURE_TYPES.ASSERTION_FAILED);
        assert.equal(err.evidence?.expected, "enabled");
        assert.equal(err.evidence?.actual, "disabled");
        return true;
      }
    );
  });

  it("4. assertValue xuyên Shadow DOM kiểm chứng nonEmpty và giá trị chính xác", async () => {
    await page.goto(`${server.url}/dashboard`, { waitUntil: "domcontentloaded" });

    // Khi ô GUID bên trong Shadow DOM còn trống -> nonEmpty PHẢI FAIL!
    await assert.rejects(
      () =>
        atomicActionsService.executeAction(
          {
            action: "assertValue",
            nonEmpty: true,
            fingerprint: { elemId: "guid-input", tag: "input" },
            timeoutMs: 500,
          },
          session
        ),
      (err) => {
        assert.equal(err.failureType, FAILURE_TYPES.ASSERTION_FAILED);
        assert.equal(err.evidence?.actual, "(Trống)");
        return true;
      }
    );

    // Sau khi sinh mã GUID -> nonEmpty PHẢI PASS!
    await page.evaluate(() => {
      const sr = document.getElementById("shadow-host").shadowRoot;
      sr.getElementById("guid-input").value = "GUID-2026-9988";
    });
    const okVal = await atomicActionsService.executeAction(
      {
        action: "assertValue",
        nonEmpty: true,
        fingerprint: { elemId: "guid-input", tag: "input" },
        timeoutMs: 800,
      },
      session
    );
    assert.equal(okVal.success, true);
    assert.equal(okVal.evidence?.actual, "GUID-2026-9988");
  });

  it("5. assertCount đếm dòng bảng (bỏ qua dòng 'Không có dữ liệu') và đếm thẻ chip", async () => {
    await page.goto(`${server.url}/dashboard`, { waitUntil: "domcontentloaded" });

    // Bảng trống chỉ có dòng "Không có dữ liệu" -> >= 1 PHẢI FAIL!
    await assert.rejects(
      () =>
        atomicActionsService.executeAction(
          { action: "assertCount", selector: "#empty-body tr", op: ">=", count: 1, timeoutMs: 500 },
          session
        ),
      (err) => {
        assert.equal(err.failureType, FAILURE_TYPES.ASSERTION_FAILED);
        assert.match(err.evidence?.actual || "", /^0 mục/);
        return true;
      }
    );

    // Bảng đơn hàng có 2 dòng + 2 thẻ chip -> PASS!
    const rowsOk = await atomicActionsService.executeAction(
      { action: "assertCount", selector: "#orders-body tr", op: ">=", count: 1, timeoutMs: 800 },
      session
    );
    assert.equal(rowsOk.success, true);
    assert.match(rowsOk.evidence?.actual || "", /^2 mục/);

    const chipsOk = await atomicActionsService.executeAction(
      { action: "assertCount", selector: ".tag-chip", op: "==", count: 2, timeoutMs: 800 },
      session
    );
    assert.equal(chipsOk.success, true);
  });

  it("6. assertDownload kiểm tra tên tệp VÀ dung lượng > 0 bytes; assertCompare đối chiếu tiền tệ VN", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "at-dl-"));
    const emptyPath = path.join(tmpDir, "empty.pdf");
    const validPath = path.join(tmpDir, "bien_ban_nghiem_thu.pdf");
    fs.writeFileSync(emptyPath, "");
    fs.writeFileSync(validPath, "%PDF-1.4 sample content");

    try {
      // Tệp 0 bytes -> FAIL!
      session.currentStepDownloads = [{ filename: "empty.pdf", path: emptyPath }];
      await assert.rejects(
        () => atomicActionsService.executeAction({ action: "assertDownload", value: ".pdf", minBytes: 1, timeoutMs: 400 }, session),
        (err) => err.failureType === FAILURE_TYPES.ASSERTION_FAILED
      );

      // Tệp hợp lệ > 0 bytes -> PASS!
      session.currentStepDownloads = [{ filename: "bien_ban_nghiem_thu.pdf", path: validPath }];
      const dlOk = await atomicActionsService.executeAction(
        { action: "assertDownload", value: ".pdf", minBytes: 1, timeoutMs: 600 },
        session
      );
      assert.equal(dlOk.success, true);
      assert.match(dlOk.evidence?.actual || "", /bien_ban_nghiem_thu\.pdf/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // assertCompare: "58.500.000đ" == "{{tong_tien_ky_vong}}" (58500000) -> PASS!
    await page.goto(`${server.url}/dashboard`, { waitUntil: "domcontentloaded" });
    const cmpOk = await atomicActionsService.executeAction(
      {
        action: "assertCompare",
        op: "==",
        expected: "{{tong_tien_ky_vong}}",
        fingerprint: { elemId: "total-display", tag: "div" },
      },
      session
    );
    assert.equal(cmpOk.success, true);
    assert.equal(cmpOk.evidence?.passed, true);
  });

  it("7. assertVerdict: chặn rubber-stamp thiếu bằng chứng, không lưu cache mù, và ném ASSERTION_FAILED khi passed=false", async () => {
    // Thiếu actual/expected -> từ chối
    await assert.rejects(
      () => atomicActionsService.executeAction({ action: "assertVerdict", passed: true, expected: "Ok" }, session),
      (err) => err.failureType === FAILURE_TYPES.EXECUTION_ERROR
    );

    // passed: false -> ASSERTION_FAILED
    await assert.rejects(
      () =>
        atomicActionsService.executeAction(
          { action: "assertVerdict", passed: false, expected: "Có biểu đồ", actual: "Màn hình trống" },
          session
        ),
      (err) => {
        assert.equal(err.failureType, FAILURE_TYPES.ASSERTION_FAILED);
        assert.equal(err.evidence?.oracleSource, ORACLE_SOURCES.AI_JUDGE);
        return true;
      }
    );

    // passed: true có đủ expected & actual -> PASS nhưng recordedAction === null (không cache mù!)
    const judgeOk = await atomicActionsService.executeAction(
      { action: "assertVerdict", passed: true, expected: "Có 2 thẻ chip", actual: "Đang hiển thị 2 thẻ chip" },
      session
    );
    assert.equal(judgeOk.success, true);
    assert.equal(judgeOk.recordedAction, null);
  });

  it("8. Hậu kiểm cơ học navigate: HTTP 404 bị đánh FAILED (HTTP_ERROR), trừ khi bật allowHttpError", async () => {
    await assert.rejects(
      () => atomicActionsService.executeAction({ action: "navigate", value: `${server.url}/missing-page` }, session),
      (err) => {
        assert.equal(err.failureType, FAILURE_TYPES.HTTP_ERROR);
        assert.equal(err.isProductDefect, true);
        assert.match(err.evidence?.actual || "", /HTTP 404/);
        return true;
      }
    );

    const allowedOk = await atomicActionsService.executeAction(
      { action: "navigate", value: `${server.url}/missing-page`, allowHttpError: true },
      session
    );
    assert.equal(allowedOk.success, true);
  });

  it("9. Cổng Chống AI Tự Chấm Đậu (Anti-Self-Pass Gate) + 4-State Verdict Taxonomy (FAILED vs BROKEN vs Smoke Only)", async () => {
    // 9a. Kiểm tra phân loại 4 trạng thái
    assert.equal(classifyStepVerdict({ status: "passed", uxWarnings: [] }), VERDICT_STATUS.PASSED);
    assert.equal(
      classifyStepVerdict({ status: "passed", uxWarnings: ["Lưu ý phi chặn"] }),
      VERDICT_STATUS.PASSED_WITH_WARNINGS
    );
    assert.equal(
      classifyStepVerdict({ status: "failed", failureType: FAILURE_TYPES.ASSERTION_FAILED }),
      VERDICT_STATUS.FAILED
    );
    assert.equal(
      classifyStepVerdict({ status: "failed", failureType: FAILURE_TYPES.ELEMENT_NOT_FOUND }),
      VERDICT_STATUS.BROKEN
    );
    assert.equal(
      classifyStepVerdict({ status: "failed", failureType: FAILURE_TYPES.TIMEOUT }),
      VERDICT_STATUS.BROKEN
    );

    // 9b. Chạy MicroAgentRunnerService thật với Mock LLM cố tình tự chấm đậu (`actions: [], isStepComplete: true`) ở bước Kiểm tra!
    let llmTurn = 0;
    const mockLlm = {
      async chatCompletion() {
        llmTurn++;
        if (llmTurn === 1) {
          // Nhịp 1: AI cố tình tự chấm đậu không kiểm chứng!
          return JSON.stringify({
            thought: "Bảng trông có vẻ ổn rồi",
            actions: [],
            isStepComplete: true,
          });
        }
        // Nhịp 2 (sau khi bị Cổng Anti-Self-Pass từ chối): AI buộc phải gọi lệnh kiểm chứng thật
        return JSON.stringify({
          thought: "Đếm số dòng thực tế trong bảng #empty-body",
          actions: [{ action: "assertCount", selector: "#empty-body tr", op: ">=", count: 1, timeoutMs: 400 }],
          isStepComplete: true,
        });
      },
    };
    const noopCache = {
      async getTrace() { return null; },
      async saveTrace() {},
      async invalidateTrace() {},
    };
    const tempShotsDir = fs.mkdtempSync(path.join(os.tmpdir(), "at-shots-"));
    const mockStorage = {
      async getRunScreenshotsDir() { return tempShotsDir; },
    };

    const runner = new MicroAgentRunnerService(
      {
        browser: { headless: true },
        timeouts: { stepMs: 20000, runMs: 40000, gotoMs: 10000, observeTimeoutMs: 2000 },
        screenshots: { format: "jpeg", quality: 60, fullPage: false },
        diagnostics: { strictness: "balanced" },
      },
      mockStorage,
      browserLifecycleService,
      undefined,
      atomicActionsService,
      noopCache,
      mockLlm
    );

    try {
      const runResult = {
        id: "run_anti_self_pass",
        projectId: "proj_test",
        featureId: "feat_test",
        status: "running",
        steps: [],
      };
      await runner.runSteps(
        [
          { type: "goto", text: `Mở trang ${server.url}/dashboard` },
          { type: "assert", text: "Kiểm tra bảng dữ liệu hiển thị có ít nhất 1 dòng" },
        ],
        {},
        runResult
      );

      // Nhịp 1 đã bị chặn -> LLM bắt buộc phải chạy tới nhịp 2 -> đo được 0 dòng -> FAIL chuẩn FAILED!
      assert.equal(llmTurn, 2, "Expected Anti-Self-Pass Gate to reject turn 1 and force turn 2 verification");
      assert.equal(runResult.status, "failed");
      assert.equal(runResult.verdict, VERDICT_STATUS.FAILED);
      assert.equal(runResult.steps[1].failureType, FAILURE_TYPES.ASSERTION_FAILED);
      assert.equal(runResult.steps[1].verdict, VERDICT_STATUS.FAILED);
      assert.equal(runResult.assertionSummary.totalAssertions, 1);
      assert.equal(runResult.assertionSummary.failedAssertions, 1);
      assert.equal(runResult.assertionSummary.isSmokeOnly, false);

      // 9c. Kịch bản không có bước Assert nào -> PASSED + gắn nhãn isSmokeOnly === true
      const smokeResult = {
        id: "run_smoke_only",
        projectId: "proj_test",
        featureId: "feat_smoke",
        status: "running",
        steps: [],
      };
      await runner.runSteps(
        [{ type: "goto", text: `Mở trang ${server.url}/dashboard` }],
        {},
        smokeResult
      );
      assert.equal(smokeResult.status, "passed");
      assert.equal(smokeResult.verdict, VERDICT_STATUS.PASSED);
      assert.equal(smokeResult.assertionSummary.isSmokeOnly, true);
    } finally {
      fs.rmSync(tempShotsDir, { recursive: true, force: true });
    }
  });

  it("10. 3 Chế độ kiểm soát Hàng rào Nhân quả: Explicit-Only vs Balanced vs Strict", () => {
    const baseInput = {
      baseline: { routeKey: "http://app.local/login", url: "http://app.local/login" },
      postDiag: {
        newBlockingAlerts: [{ text: "Sai mật khẩu", confidence: "high", isExplicitErrorClass: true, inSubmittedForm: true }],
        newAdvisoryAlerts: [],
        staleAlertsCount: 0,
        formValidationError: null,
        serverError: null,
      },
      telemetryDelta: {
        responses: [{ url: "http://app.local/api/login", method: "POST", status: 401, resourceType: "fetch", isBusinessError: true, errorHint: "Sai mật khẩu" }],
        serverErrorResponses: [],
        authErrorResponses: [],
        pageErrors: [],
      },
      actionContext: {
        didClickOrSubmit: true,
        didSubmit: true,
        stepStartUrl: "http://app.local/login",
        stepEndUrl: "http://app.local/login",
        switchedTab: false,
      },
      stepText: 'Bấm nút "Đăng nhập"',
      remainingSteps: [{ text: 'Kiểm tra xuất hiện "Dashboard"' }],
    };

    // Explicit-Only: không đánh rớt bước click, đẩy sang advisoryWarnings để bước Assert quyết định
    const expRes = evaluateCausalDiagnostics({ ...baseInput, strictness: DIAGNOSTIC_STRICTNESS.EXPLICIT });
    assert.equal(expRes.verdict, "pass");
    assert.ok(expRes.advisoryWarnings.includes("Sai mật khẩu"));

    // Balanced: đánh rớt chuẩn xác (SILENT_FAILURE + isProductDefect=true)
    const balRes = evaluateCausalDiagnostics({ ...baseInput, strictness: DIAGNOSTIC_STRICTNESS.BALANCED });
    assert.equal(balRes.verdict, "fail");
    assert.equal(balRes.isProductDefect, true);
    assert.equal(balRes.failureType, FAILURE_TYPES.SILENT_FAILURE);

    // Strict: bắt cả uncaught JS pageerror ngay cả khi không có UI alert hay API fail
    const jsErrInput = {
      ...baseInput,
      postDiag: { newBlockingAlerts: [], newAdvisoryAlerts: [], staleAlertsCount: 0, formValidationError: null, serverError: null },
      telemetryDelta: {
        responses: [],
        serverErrorResponses: [],
        authErrorResponses: [],
        pageErrors: [{ type: "pageerror", message: "TypeError: Cannot read properties of undefined" }],
      },
    };
    const balJs = evaluateCausalDiagnostics({ ...jsErrInput, strictness: DIAGNOSTIC_STRICTNESS.BALANCED });
    assert.equal(balJs.verdict, "pass");

    const strictJs = evaluateCausalDiagnostics({ ...jsErrInput, strictness: DIAGNOSTIC_STRICTNESS.STRICT });
    assert.equal(strictJs.verdict, "fail");
    assert.match(strictJs.message || "", /Chế độ Strict.*Uncaught Error/i);
  });
});

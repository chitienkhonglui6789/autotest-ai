import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startFixtureServer } from "./helpers/fixture-server.js";
import { browserLifecycleService } from "../src/services/browser/browser-lifecycle.service.js";
import { pageTelemetryService } from "../src/services/browser/page-telemetry.service.js";
import { atomicActionsService } from "../src/services/engine/atomic-actions.service.js";
import { microAgentRunnerService } from "../src/services/engine/micro-agent-runner.service.js";
import {
  DIAGNOSTIC_SEVERITY,
  captureUiDiagnosticBaseline,
  inspectUiDiagnostics,
  evaluateCausalDiagnostics,
} from "../src/services/browser/diagnostics.service.js";
import { FAILURE_TYPES } from "../src/constants/stepTypes.js";

/**
 * Mini HTTP server mô phỏng đầy đủ các tình huống thực tế khi Đăng nhập & Chuyển trang
 */
async function startLoginTrapServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");

    if (req.method === "POST" && url.pathname === "/api/login-ok") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, success: true, message: "Đăng nhập thành công" }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login-fail") {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, success: false, message: "Tên đăng nhập hoặc mật khẩu không chính xác!" }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login-500") {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "Database connection refused" }));
      return;
    }

    if (url.pathname === "/login-with-banners") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
        <html lang="vi">
        <head><meta charset="utf-8"><title>Cổng Đăng Nhập</title></head>
        <body>
          <!-- Banner UAT có sẵn từ đầu -->
          <div id="uat-banner" role="alert" class="alert alert-warning">
            ⚠️ Cảnh báo: Bạn đang truy cập môi trường thử nghiệm (UAT). Mọi dữ liệu không đúng thực tế sẽ bị xóa định kỳ.
          </div>
          <!-- Cảnh báo trình duyệt cũ có class alert-danger nằm sẵn trên trang -->
          <div id="old-browser-notice" class="alert alert-danger">
            Hệ thống phát hiện bạn đang dùng trình duyệt không an toàn. Vui lòng cập nhật Chrome để có trải nghiệm tốt nhất.
          </div>

          <div class="card">
            <div id="loginError" class="alert alert-danger" style="display:none;"></div>
            <div id="loginSuccess" class="alert alert-success" style="display:none;"></div>
            <form id="loginForm">
              <input id="username" type="text" required value="admin" />
              <input id="password" type="password" required value="" />
              <label><input id="rememberMe" type="checkbox" /> Ghi nhớ đăng nhập</label>
              <button id="btnSubmit" type="submit">Đăng nhập</button>
            </form>
          </div>

          <!-- Form newsletter độc lập ở cuối trang có trường required trống -->
          <footer>
            <form id="newsletterForm">
              <input id="newsletterEmail" type="email" required value="" />
              <button type="submit">Đăng ký nhận tin</button>
            </form>
          </footer>

          <script>
            const form = document.getElementById("loginForm");
            form.addEventListener("submit", async (e) => {
              e.preventDefault();
              const pwd = document.getElementById("password").value;
              const errBox = document.getElementById("loginError");
              errBox.style.display = "none";

              if (pwd === "123456") {
                const res = await fetch("/api/login-ok", { method: "POST" });
                const data = await res.json();
                if (data.success) {
                  window.location.href = "/dashboard";
                }
              } else if (pwd === "123456_spa_chat") {
                const res = await fetch("/api/login-ok", { method: "POST" });
                const data = await res.json();
                if (data.success) {
                  document.getElementById("loginSuccess").textContent = "Đăng nhập thành công!";
                  document.getElementById("loginSuccess").style.display = "block";
                  // Widget chat chạy ngầm bất ngờ văng toast lỗi
                  const chatToast = document.createElement("div");
                  chatToast.setAttribute("role", "alert");
                  chatToast.className = "toast-error";
                  chatToast.textContent = "Không thể kết nối máy chủ hỗ trợ trực tuyến";
                  document.body.appendChild(chatToast);
                }
              } else if (pwd === "123456_tab") {
                const res = await fetch("/api/login-ok", { method: "POST" });
                await res.json();
                window.open("/view-tab", "view_tab");
              } else if (pwd === "trigger_500") {
                await fetch("/api/login-500", { method: "POST" });
              } else {
                const res = await fetch("/api/login-fail", { method: "POST" });
                const data = await res.json();
                errBox.textContent = data.message;
                errBox.style.display = "block";
              }
            });
          </script>
        </body>
        </html>`);
      return;
    }

    if (url.pathname === "/dashboard") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
        <html lang="vi">
        <head><meta charset="utf-8"><title>Dashboard ERP</title></head>
        <body>
          <h1>Trang Quản Trị ERP</h1>
          <div role="alert" class="notification-error">
            Thông báo: Kế toán đang đối soát cuối tháng. Đề nghị các phòng ban không sửa đổi chứng từ.
          </div>
          <div class="alert alert-danger" id="pwd-expiry">
            Cảnh báo bảo mật: Mật khẩu của bạn đã quá hạn 90 ngày. Vui lòng đổi mật khẩu mới!
          </div>
          <p>Xin chào admin!</p>
        </body>
        </html>`);
      return;
    }

    if (url.pathname === "/view-tab") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
        <html lang="vi">
        <head><meta charset="utf-8"><title>View Tab</title></head>
        <body>
          <div id="focusBanner" class="alert alert-danger">
            ⚡ CHẾ ĐỘ GIÀNH FOCUS (TÁI HIỆN LỖI) 19s Tab View đang kích hoạt cơ chế giật tiêu điểm!
          </div>
          <h1>Báo cáo & Giám sát</h1>
        </body>
        </html>`);
      return;
    }

    if (url.pathname === "/client-only-login") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
        <html lang="vi">
        <head><meta charset="utf-8"><title>Client-Only Login (SauceDemo style)</title></head>
        <body>
          <div role="alert" class="alert alert-warning">
            Cảnh báo: Không chia sẻ mật khẩu để tránh tài khoản bị khóa.
          </div>
          <form id="sauceForm">
            <input id="u" value="standard_user" />
            <input id="p" type="password" value="wrong_pass" />
            <div class="error-message-container" id="errWrap"></div>
            <button id="loginBtn" type="submit">Login</button>
          </form>
          <script>
            document.getElementById("sauceForm").addEventListener("submit", (e) => {
              e.preventDefault();
              const wrap = document.getElementById("errWrap");
              wrap.classList.add("error");
              wrap.innerHTML = '<h3 data-test="error">Epic sadface: Username and password do not match any user in this service</h3>';
            });
          </script>
        </body>
        </html>`);
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Helper mô phỏng trọn vẹn 1 bước click + Đường ống Chẩn đoán Nhân quả 4 Lớp
 */
async function runStepWithCausalDiagnostics(page, session, { action, stepText, remainingSteps = [] }) {
  const stepStartPage = session.currentPage;
  const stepStartUrl = stepStartPage.url();
  const cursor = pageTelemetryService.createCursor(session);
  const baseline = await captureUiDiagnosticBaseline(stepStartPage);

  const actRes = await atomicActionsService.executeAction(action, session, null, null);

  // Chờ ngắn tối đa 900ms nếu có critical request in-flight
  const deadline = Date.now() + 900;
  while (Date.now() < deadline && pageTelemetryService.getCriticalInFlightCount(session) > 0) {
    await new Promise((r) => setTimeout(r, 30));
  }
  await pageTelemetryService.flush(session, 300);

  const telemetryDelta = pageTelemetryService.getDeltaSince(session, cursor);
  const stepEndUrl = session.currentPage.url();
  const switchedTab = session.currentPage !== stepStartPage;

  const actionContext = {
    executedActionKinds: new Set([String(action.action || "click").toLowerCase()]),
    didClickOrSubmit: true,
    didSubmit: Boolean(actRes?.actionMeta?.isSubmitAction),
    isFormSubmit: Boolean(actRes?.actionMeta?.isFormSubmit),
    didNavigateCommand: false,
    submittedFormKeys: actRes?.actionMeta?.formKey ? [actRes.actionMeta.formKey] : [],
    stepStartUrl,
    stepEndUrl,
    switchedTab,
  };

  const postDiag = await inspectUiDiagnostics(session.currentPage, { baseline, actionContext });
  const verdict = evaluateCausalDiagnostics({
    baseline,
    postDiag,
    telemetryDelta,
    actionContext,
    stepText,
    remainingSteps,
  });

  return { actRes, postDiag, telemetryDelta, verdict };
}

describe("4-Layer Causal Diagnostic Pipeline (Chống bắt nhầm thông báo không liên quan)", () => {
  let fixture;
  let loginServer;
  let browser;
  let context;
  let page;
  let session;

  before(async () => {
    fixture = await startFixtureServer();
    loginServer = await startLoginTrapServer();
    const launched = await browserLifecycleService.launch({ browser: { headless: true } });
    browser = launched.browser;
    context = launched.context;
    page = launched.page;
    session = {
      browser,
      context,
      currentPage: page,
      vars: {},
      dialogHistory: [],
      downloadedFiles: [],
      telemetry: pageTelemetryService.createSessionState(),
    };
    microAgentRunnerService.attachPageListeners(page, session);
    context.on("page", (newPage) => {
      microAgentRunnerService.attachPageListeners(newPage, session);
      session.currentPage = newPage;
    });
  });

  after(async () => {
    await browserLifecycleService.destroyAll();
    if (fixture) await fixture.close();
    if (loginServer) await loginServer.close();
  });

  it("TH1 & TH2: Click checkbox khi có sẵn Banner UAT/Trình duyệt cũ và ô password required trống -> PASS hoàn toàn, không báo lỗi oan", async () => {
    session.currentPage = page;
    await page.goto(`${loginServer.url}/login-with-banners`, { waitUntil: "domcontentloaded" });

    const { postDiag, verdict } = await runStepWithCausalDiagnostics(page, session, {
      action: { action: "click", fingerprint: { elemId: "rememberMe", tag: "input", type: "checkbox" } },
      stepText: 'Tick chọn ô "Ghi nhớ đăng nhập"',
      remainingSteps: [{ text: 'Nhập "123456" vào ô Mật khẩu' }, { text: 'Bấm nút "Đăng nhập"' }],
    });

    assert.equal(verdict.verdict, "pass");
    assert.equal(verdict.detectedAlert, null);
    assert.equal(postDiag.formValidationError, null);
    assert.ok(postDiag.staleAlertsCount >= 2, `Expected >= 2 stale banners ignored, got ${postDiag.staleAlertsCount}`);
  });

  it("TH3: Đăng nhập thành công chuyển sang Dashboard có thông báo đối soát & cảnh báo đổi mật khẩu -> PASS (không đánh rớt bước đăng nhập)", async () => {
    session.currentPage = page;
    await page.goto(`${loginServer.url}/login-with-banners`, { waitUntil: "domcontentloaded" });
    await page.fill("#password", "123456");

    const { verdict } = await runStepWithCausalDiagnostics(page, session, {
      action: { action: "click", fingerprint: { elemId: "btnSubmit", tag: "button", text: "Đăng nhập" } },
      stepText: 'Bấm nút "Đăng nhập"',
      remainingSteps: [{ text: 'Kiểm tra xuất hiện "Xin chào admin!"' }],
    });

    assert.match(page.url(), /\/dashboard/);
    assert.equal(verdict.verdict, "pass");
    assert.equal(verdict.detectedAlert, null);
    assert.equal(verdict.causalSummary.hasSuccessfulMutationApi, true);
    assert.equal(verdict.causalSummary.navigatedToNewRoute, true);
  });

  it("TH4: Đăng nhập thành công mở Tab mới có banner alert-danger (mô phỏng sample01 View focusBanner) -> PASS", async () => {
    session.currentPage = page;
    await page.goto(`${loginServer.url}/login-with-banners`, { waitUntil: "domcontentloaded" });
    await page.fill("#password", "123456_tab");

    const { verdict } = await runStepWithCausalDiagnostics(page, session, {
      action: { action: "click", fingerprint: { elemId: "btnSubmit", tag: "button", text: "Đăng nhập" } },
      stepText: 'Bấm nút "Đăng nhập"',
      remainingSteps: [{ text: 'Kiểm tra xuất hiện "Báo cáo & Giám sát"' }],
    });

    assert.equal(verdict.verdict, "pass");
    assert.equal(verdict.causalSummary.switchedTab, true);

    // Đóng tab phụ để dọn sạch
    if (session.currentPage !== page && !session.currentPage.isClosed()) {
      await session.currentPage.close();
      session.currentPage = page;
    }
  });

  it("TH5: Đăng nhập SPA thành công (HTTP 200 OK) dù widget chat chạy ngầm văng toast-error -> PASS nhờ Quy tắc vàng Tầng 1", async () => {
    session.currentPage = page;
    await page.goto(`${loginServer.url}/login-with-banners`, { waitUntil: "domcontentloaded" });
    await page.fill("#password", "123456_spa_chat");

    const { verdict } = await runStepWithCausalDiagnostics(page, session, {
      action: { action: "click", fingerprint: { elemId: "btnSubmit", tag: "button", text: "Đăng nhập" } },
      stepText: 'Bấm nút "Đăng nhập"',
      remainingSteps: [{ text: 'Kiểm tra xuất hiện "Đăng nhập thành công!"' }],
    });

    assert.equal(verdict.verdict, "pass");
    assert.equal(verdict.causalSummary.hasSuccessfulMutationApi, true);
    assert.ok(verdict.advisoryWarnings.some((w) => w.includes("hỗ trợ trực tuyến")));
  });

  it("TH6 (ui-traps.html?case=toast-variants): Bỏ qua stale banner, PASS trên success/info/warning toast, và FAIL đúng trên API 422 Error Toast", async () => {
    session.currentPage = page;
    await page.goto(`${fixture.url}/ui-traps.html?case=toast-variants`, { waitUntil: "domcontentloaded" });

    // 6a. Toast thành công chứa bẫy phủ định kép ("Đã lưu thành công, không có lỗi nào")
    const resSuccess = await runStepWithCausalDiagnostics(page, session, {
      action: { action: "click", fingerprint: { elemId: "btn-toast-success", tag: "button", text: "Toast Thành công" } },
      stepText: 'Bấm nút "Toast Thành công"',
    });
    assert.equal(resSuccess.verdict.verdict, "pass");
    assert.equal(resSuccess.verdict.detectedAlert, null);
    assert.ok(resSuccess.postDiag.staleAlertsCount >= 1);

    // 6b. Toast Info
    const resInfo = await runStepWithCausalDiagnostics(page, session, {
      action: { action: "click", fingerprint: { elemId: "btn-toast-info", tag: "button", text: "Toast Info" } },
      stepText: 'Bấm nút "Toast Info"',
    });
    assert.equal(resInfo.verdict.verdict, "pass");

    // 6c. Toast Warning -> PASS và đưa vào advisoryWarnings
    const resWarning = await runStepWithCausalDiagnostics(page, session, {
      action: { action: "click", fingerprint: { elemId: "btn-toast-warning", tag: "button", text: "Toast Warning" } },
      stepText: 'Bấm nút "Toast Warning"',
    });
    assert.equal(resWarning.verdict.verdict, "pass");
    assert.ok(resWarning.verdict.advisoryWarnings.some((w) => w.includes("Cảnh báo nhẹ")));

    // 6d. API 422 Error Toast -> FAIL (SILENT_FAILURE) có đối soát API 422 + toast-error mới
    const resErr422 = await runStepWithCausalDiagnostics(page, session, {
      action: { action: "click", fingerprint: { elemId: "btn-toast-error-422", tag: "button", text: "API 422 Error Toast" } },
      stepText: 'Bấm nút "API 422 Error Toast"',
    });
    assert.equal(resErr422.verdict.verdict, "fail");
    assert.equal(resErr422.verdict.failureType, FAILURE_TYPES.SILENT_FAILURE);
    assert.match(resErr422.verdict.message, /Lỗi 422|không hợp lệ/i);
    assert.doesNotMatch(resErr422.verdict.message, /Cảnh báo cũ/);
  });

  it("TH7: Lỗi đăng nhập THẬT qua API (401 + alert-danger mới) vẫn bị bắt chuẩn 100% và KHÔNG báo nhầm banner UAT", async () => {
    session.currentPage = page;
    await page.goto(`${loginServer.url}/login-with-banners`, { waitUntil: "domcontentloaded" });
    await page.fill("#password", "sai_mat_khau");

    const { verdict } = await runStepWithCausalDiagnostics(page, session, {
      action: { action: "click", fingerprint: { elemId: "btnSubmit", tag: "button", text: "Đăng nhập" } },
      stepText: 'Bấm nút "Đăng nhập"',
      remainingSteps: [{ text: 'Kiểm tra xuất hiện "Trang Quản Trị ERP"' }],
    });

    assert.equal(verdict.verdict, "fail");
    assert.equal(verdict.failureType, FAILURE_TYPES.SILENT_FAILURE);
    assert.match(verdict.message, /Tên đăng nhập hoặc mật khẩu không chính xác/);
    assert.doesNotMatch(verdict.message, /UAT|trình duyệt không an toàn/i);
  });

  it("TH8: Lỗi đăng nhập THẬT thuần Client-Side (kiểu SauceDemo, không gọi API) vẫn bị bắt chuẩn 100%", async () => {
    session.currentPage = page;
    await page.goto(`${loginServer.url}/client-only-login`, { waitUntil: "domcontentloaded" });

    const { verdict } = await runStepWithCausalDiagnostics(page, session, {
      action: { action: "click", fingerprint: { elemId: "loginBtn", tag: "button", text: "Login" } },
      stepText: 'Bấm nút "Login"',
      remainingSteps: [{ text: 'Kiểm tra xuất hiện "Products"' }],
    });

    assert.equal(verdict.verdict, "fail");
    assert.equal(verdict.failureType, FAILURE_TYPES.SILENT_FAILURE);
    assert.match(verdict.message, /Epic sadface: Username and password do not match/);
  });

  it("TH9: Form Validation thật khi bấm Submit biểu mẫu bỏ trống mật khẩu -> FAIL đúng biểu mẫu vừa submit", async () => {
    session.currentPage = page;
    await page.goto(`${loginServer.url}/login-with-banners`, { waitUntil: "domcontentloaded" });
    // Để trống #password (required) và bấm Submit thật
    const { verdict } = await runStepWithCausalDiagnostics(page, session, {
      action: { action: "click", fingerprint: { elemId: "btnSubmit", tag: "button", text: "Đăng nhập" } },
      stepText: 'Bấm nút "Đăng nhập"',
      remainingSteps: [{ text: 'Kiểm tra xuất hiện "Xin chào admin!"' }],
    });

    assert.equal(verdict.verdict, "fail");
    assert.equal(verdict.failureType, FAILURE_TYPES.SILENT_FAILURE);
    assert.match(verdict.message, /Form Validation/i);
  });

  it("TH10: Kịch bản kiểm thử âm tính (Negative Test có bước kiểm tra lỗi phía sau) -> KHÔNG đánh rớt bước bấm nút", async () => {
    session.currentPage = page;
    await page.goto(`${loginServer.url}/login-with-banners`, { waitUntil: "domcontentloaded" });
    await page.fill("#password", "sai_mat_khau");

    const { verdict } = await runStepWithCausalDiagnostics(page, session, {
      action: { action: "click", fingerprint: { elemId: "btnSubmit", tag: "button", text: "Đăng nhập" } },
      stepText: 'Bấm nút "Đăng nhập"',
      remainingSteps: [{ text: 'Kiểm tra xuất hiện thông báo lỗi "Tên đăng nhập hoặc mật khẩu không chính xác!"' }],
    });

    assert.equal(verdict.verdict, "pass");
    assert.match(verdict.detectedAlert || "", /Tên đăng nhập hoặc mật khẩu không chính xác/);
  });

  it("TH11: Lỗi máy chủ HTTP 500 từ API -> FAIL ngay lập tức với EXECUTION_ERROR (FATAL)", async () => {
    session.currentPage = page;
    await page.goto(`${loginServer.url}/login-with-banners`, { waitUntil: "domcontentloaded" });
    await page.fill("#password", "trigger_500");

    const { verdict } = await runStepWithCausalDiagnostics(page, session, {
      action: { action: "click", fingerprint: { elemId: "btnSubmit", tag: "button", text: "Đăng nhập" } },
      stepText: 'Bấm nút "Đăng nhập"',
      remainingSteps: [{ text: 'Kiểm tra xuất hiện "Trang Quản Trị ERP"' }],
    });

    assert.equal(verdict.verdict, "fail");
    assert.equal(verdict.severity, DIAGNOSTIC_SEVERITY.FATAL);
    assert.equal(verdict.failureType, FAILURE_TYPES.EXECUTION_ERROR);
    assert.match(verdict.message, /HTTP 500/);
  });

  it("TH12: Khử phủ định thành công ('Đăng nhập không thành công') không bị hiểu nhầm là thành công", async () => {
    const cleanPage = await context.newPage();
    try {
      await cleanPage.setContent(`
        <form id="f" data-at-form-key="fk_1">
          <div role="alert" class="alert alert-danger">Đăng nhập không thành công, vui lòng kiểm tra lại!</div>
        </form>
      `);
      const diag = await inspectUiDiagnostics(cleanPage, {
        actionContext: { didSubmit: true, isFormSubmit: true, submittedFormKeys: ["fk_1"] },
      });
      assert.equal(diag.isErrorAlert, true);
      assert.equal(diag.newBlockingAlerts.length, 1);
      assert.match(diag.newBlockingAlerts[0].text, /không thành công/i);
    } finally {
      await cleanPage.close();
    }
  });
});

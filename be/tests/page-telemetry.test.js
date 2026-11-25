import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startFixtureServer } from "./helpers/fixture-server.js";
import { browserLifecycleService } from "../src/services/browser/browser-lifecycle.service.js";
import { PageTelemetryService, pageTelemetryService } from "../src/services/browser/page-telemetry.service.js";
import { microAgentRunnerService } from "../src/services/engine/micro-agent-runner.service.js";

describe("Phase 1 - PageTelemetryService", () => {
  let fixture;

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    await browserLifecycleService.destroyAll();
    if (fixture) {
      await fixture.close();
    }
  });

  it("phát hiện request in-flight khi gọi /api/save-slow và trở về 0 khi hoàn tất", async () => {
    const { browser, context, page } = await browserLifecycleService.launch({
      browser: { headless: true },
    });

    try {
      const session = { telemetry: pageTelemetryService.createSessionState() };
      pageTelemetryService.attach(page, session);
      await page.goto(`${fixture.url}/ui-traps.html`, { waitUntil: "domcontentloaded" });

      assert.equal(pageTelemetryService.getCriticalInFlightCount(session), 0);

      const fetchPromise = page.evaluate(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/save-slow?delayMs=400`, { method: "POST" });
        return res.status;
      }, fixture.url);

      // Chờ ngắn để request kịp phát đi từ browser
      let observedInFlight = 0;
      const deadline = Date.now() + 350;
      while (Date.now() < deadline) {
        observedInFlight = pageTelemetryService.getCriticalInFlightCount(session);
        if (observedInFlight > 0) break;
        await new Promise((r) => setTimeout(r, 15));
      }

      assert.equal(observedInFlight, 1, "Expected 1 critical in-flight request during /api/save-slow");

      const status = await fetchPromise;
      assert.equal(status, 200);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(pageTelemetryService.getCriticalInFlightCount(session), 0);
    } finally {
      await browserLifecycleService.closeInstances(context, browser);
    }
  });

  it("bắt đúng HTTP 200 JSON business error (/api/save-http200-error), HTTP 500 (/api/save-500) và HTTP 401 (/api/auth-401)", async () => {
    const { browser, context, page } = await browserLifecycleService.launch({
      browser: { headless: true },
    });

    try {
      const session = {};
      microAgentRunnerService.attachPageListeners(page, session);
      await page.goto(`${fixture.url}/ui-traps.html`, { waitUntil: "domcontentloaded" });

      const cursor = pageTelemetryService.createCursor(session);

      await page.evaluate(async (baseUrl) => {
        await fetch(`${baseUrl}/api/save-http200-error`, { method: "POST" }).then((r) => r.json());
        await fetch(`${baseUrl}/api/save-500`, { method: "POST" }).then((r) => r.json());
        await fetch(`${baseUrl}/api/auth-401`).then((r) => r.json());
      }, fixture.url);

      await pageTelemetryService.flush(session);
      const delta = pageTelemetryService.getDeltaSince(session, cursor);

      assert.equal(delta.criticalInFlightCount, 0);
      assert.equal(delta.responses.length, 3);
      assert.equal(delta.failedResponses.length, 3);

      assert.equal(delta.businessErrorResponses.length, 3);
      const http200Err = delta.responses.find((r) => r.url.includes("/api/save-http200-error"));
      assert.ok(http200Err);
      assert.equal(http200Err.status, 200);
      assert.equal(http200Err.isBusinessError, true);
      assert.equal(http200Err.errorHint, "Dữ liệu không hợp lệ");

      assert.equal(delta.serverErrorResponses.length, 1);
      assert.equal(delta.serverErrorResponses[0].status, 500);
      assert.match(delta.serverErrorResponses[0].url, /\/api\/save-500/);

      assert.equal(delta.authErrorResponses.length, 1);
      assert.equal(delta.authErrorResponses[0].status, 401);
      assert.match(delta.authErrorResponses[0].url, /\/api\/auth-401/);
    } finally {
      await browserLifecycleService.closeInstances(context, browser);
    }
  });

  it("getDeltaSince(cursor) tách biệt hoàn toàn lỗi giữa bước trước và bước sau", async () => {
    const { browser, context, page } = await browserLifecycleService.launch({
      browser: { headless: true },
    });

    try {
      const session = {
        dialogHistory: [],
        downloadedFiles: [],
        telemetry: pageTelemetryService.createSessionState(),
      };
      // Gắn nhiều lần để kiểm tra idempotent
      pageTelemetryService.attach(page, session);
      pageTelemetryService.attach(page, session);
      microAgentRunnerService.attachPageListeners(page, session);

      await page.goto(`${fixture.url}/ui-traps.html`, { waitUntil: "domcontentloaded" });

      // Bước 1: phát sinh lỗi 500, console.error và uncaught pageerror
      const step1Cursor = pageTelemetryService.createCursor(session);
      await page.evaluate(async (baseUrl) => {
        await fetch(`${baseUrl}/api/save-500`, { method: "POST" });
        console.error("Lỗi console bước 1");
        setTimeout(() => {
          throw new Error("Uncaught step 1 error");
        }, 0);
      }, fixture.url);

      await new Promise((r) => setTimeout(r, 50));
      await pageTelemetryService.flush(session);

      const step1Delta = pageTelemetryService.getDeltaSince(session, step1Cursor);
      assert.equal(step1Delta.serverErrorResponses.length, 1);
      assert.ok(
        step1Delta.pageErrors.some((e) => e.type === "console.error" && e.message.includes("Lỗi console bước 1"))
      );
      assert.ok(
        step1Delta.pageErrors.some((e) => e.type === "pageerror" && e.message.includes("Uncaught step 1 error"))
      );

      // Bước 2: chạy API thành công -> không bị dính lỗi từ bước 1
      const step2Cursor = pageTelemetryService.createCursor(session);
      await page.evaluate(async (baseUrl) => {
        await fetch(`${baseUrl}/api/save-ok`, { method: "POST" }).then((r) => r.json());
      }, fixture.url);

      await pageTelemetryService.flush(session);
      const step2Delta = pageTelemetryService.getDeltaSince(session, step2Cursor);

      assert.equal(step2Delta.responses.length, 1);
      assert.equal(step2Delta.responses[0].status, 200);
      assert.equal(step2Delta.responses[0].isBusinessError, false);
      assert.equal(step2Delta.failedResponses.length, 0);
      assert.equal(step2Delta.businessErrorResponses.length, 0);
      assert.equal(step2Delta.serverErrorResponses.length, 0);
      assert.equal(step2Delta.authErrorResponses.length, 0);
      assert.equal(step2Delta.pageErrors.length, 0);
    } finally {
      await browserLifecycleService.closeInstances(context, browser);
    }
  });

  it("xử lý an toàn 204, preflight OPTIONS, trang đóng đột ngột, analytics URL, redirect login và đa tab", async () => {
    const telemetry = new PageTelemetryService({ maxBufferSize: 100 });
    const { browser, context, page } = await browserLifecycleService.launch({
      browser: { headless: true },
    });

    try {
      const session = { telemetry: telemetry.createSessionState() };
      telemetry.attach(page, session);
      await page.goto(`${fixture.url}/ui-traps.html`, { waitUntil: "domcontentloaded" });

      const cursor = telemetry.createCursor(session);

      // 204 & OPTIONS preflight
      await page.evaluate(async (baseUrl) => {
        await fetch(`${baseUrl}/api/204`, { method: "POST" });
        await fetch(`${baseUrl}/api/save-ok`, { method: "OPTIONS" });
      }, fixture.url);

      // Redirect tới /login (server 302 thực)
      const redirectServer = http.createServer((req, res) => {
        res.writeHead(302, { Location: `${fixture.url}/login` });
        res.end();
      });
      await new Promise((resolve) => redirectServer.listen(0, "127.0.0.1", resolve));
      const redirectUrl = `http://127.0.0.1:${redirectServer.address().port}/protected`;
      try {
        await page.goto(redirectUrl, { waitUntil: "domcontentloaded" });
      } finally {
        await new Promise((resolve) => redirectServer.close(resolve));
      }

      await telemetry.flush(session);
      const delta = telemetry.getDeltaSince(session, cursor);
      assert.ok(delta.responses.some((r) => r.status === 204));
      assert.equal(delta.failedResponses.length, 0);
      assert.ok(
        delta.authErrorResponses.some((a) => a.type === "auth_redirect" && a.targetUrl?.includes("/login"))
      );

      // Bỏ qua tài nguyên analytics/heartbeat/poll khỏi criticalInFlightCount
      await page.route("**/heartbeat**", async (route) => {
        await new Promise((r) => setTimeout(r, 150));
        await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      });
      const hbPromise = page.evaluate((baseUrl) => fetch(`${baseUrl}/heartbeat`).then((r) => r.status), fixture.url);
      await new Promise((r) => setTimeout(r, 25));
      assert.equal(telemetry.getCriticalInFlightCount(session), 0);
      assert.equal(await hbPromise, 200);

      // Đa tab: tab mới tự động được gắn telemetry
      const tab2Cursor = telemetry.createCursor(session);
      const page2 = await context.newPage();
      await page2.goto(`${fixture.url}/ui-traps.html`, { waitUntil: "domcontentloaded" });
      await page2.evaluate(async (baseUrl) => {
        await fetch(`${baseUrl}/api/save-500`, { method: "POST" });
      }, fixture.url);
      await telemetry.flush(session);
      const tab2Delta = telemetry.getDeltaSince(session, tab2Cursor);
      assert.equal(tab2Delta.serverErrorResponses.length, 1);

      // Đóng tab đột ngột khi request chậm đang chạy không ném lỗi và không kẹt inFlight
      page2.evaluate((baseUrl) => fetch(`${baseUrl}/api/save-slow?delayMs=1000`, { method: "POST" }), fixture.url).catch(() => {});
      await new Promise((r) => setTimeout(r, 30));
      await page2.close();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(telemetry.getCriticalInFlightCount(session), 0);

      // Ring buffer giới hạn tối đa maxBufferSize mục
      const cappedTelemetry = new PageTelemetryService({ maxBufferSize: 15 });
      const cappedSession = { telemetry: cappedTelemetry.createSessionState() };
      cappedTelemetry.attach(page, cappedSession);
      await page.evaluate(async (baseUrl) => {
        for (let i = 0; i < 20; i++) {
          await fetch(`${baseUrl}/api/save-ok`, { method: "POST" });
        }
      }, fixture.url);
      await cappedTelemetry.flush(cappedSession);
      assert.equal(cappedSession.telemetry.responses.length, 15);
    } finally {
      await browserLifecycleService.closeInstances(context, browser);
    }
  });
});

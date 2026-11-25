import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixtureServer } from "./helpers/fixture-server.js";
import { browserLifecycleService } from "../src/services/browser/browser-lifecycle.service.js";
import { pageTelemetryService } from "../src/services/browser/page-telemetry.service.js";
import { readinessGateService } from "../src/services/engine/readiness-gate.service.js";

function createTestSession(page) {
  return {
    currentPage: page,
    pages: [page],
    vars: {},
    dialogHistory: [],
    downloadedFiles: [],
  };
}

describe("Phase 1 ReadinessGateService", () => {
  let fixture;
  let browser;
  let context;
  let page;

  before(async () => {
    fixture = await startFixtureServer();
    const launched = await browserLifecycleService.launch({
      browser: { headless: true },
    });
    browser = launched.browser;
    context = launched.context;
    page = launched.page;
  });

  after(async () => {
    await browserLifecycleService.destroyAll();
    if (fixture) {
      await fixture.close();
    }
  });

  it("sticky-header-overlap: scrollIntoSafeViewport đưa nút ra khỏi sticky header và probeHitTest trả obstructed: false", async () => {
    await page.goto(`${fixture.url}/ui-traps.html?case=sticky-header-overlap`, {
      waitUntil: "domcontentloaded",
    });

    const btn = page.locator("#btn-sticky-target");

    // Mô phỏng cuộn thô đưa nút vào đúng vùng bị sticky header (90px) đè lên
    await btn.evaluate((el) => {
      el.scrollIntoView({ block: "start", behavior: "instant" });
    });

    const obstructedProbe = await readinessGateService.probeHitTest(btn);
    assert.equal(obstructedProbe.obstructed, true);
    assert.equal(obstructedProbe.occluder.isStickyBar, true);
    assert.equal(obstructedProbe.occluder.category, "sticky_bar");

    // Cuộn an toàn tránh sticky header
    const scrollRes = await readinessGateService.scrollIntoSafeViewport(btn);
    assert.equal(scrollRes.scrolled, true);
    assert.equal(scrollRes.inSafeBand, true);
    assert.ok(scrollRes.topInset >= 90, `Expected topInset >= 90, got ${scrollRes.topInset}`);

    const cleanProbe = await readinessGateService.probeHitTest(btn);
    assert.equal(cleanProbe.obstructed, false);
    assert.ok(cleanProbe.safePoint && cleanProbe.safePoint.y > 90);

    await page.mouse.click(cleanProbe.safePoint.x, cleanProbe.safePoint.y);
    assert.equal(await page.textContent("#sticky-result"), "Đã bấm nút cuối trang");
  });

  it("multi-select-overlap: ensureActionable phát hiện ngay obstructed với occluder.isFloatingPopup === true (không đợi timeout 4s)", async () => {
    await page.goto(`${fixture.url}/ui-traps.html?case=multi-select-overlap`, {
      waitUntil: "domcontentloaded",
    });
    const session = createTestSession(page);
    pageTelemetryService.attach(page, session);

    await page.click("#multi-select-trigger");
    await page.check("#ms-opt-a");

    const btnContinue = page.locator("#btn-continue");
    const started = Date.now();
    const res = await readinessGateService.ensureActionable(page, btnContinue, session, {
      profile: "click",
      timeoutMs: 4000,
    });
    const elapsed = Date.now() - started;

    assert.equal(res.ready, false);
    assert.ok(res.occluder, "Expected occluder metadata");
    assert.equal(res.occluder.isFloatingPopup, true);
    assert.equal(res.occluder.category, "floating_popup");
    assert.ok(elapsed < 500, `Expected fail-early < 500ms, got ${elapsed}ms`);
  });

  it("transient-animation-and-mask: waitForElementStability đợi nút trượt 350ms ổn định xong mới báo stable", async () => {
    await page.goto(`${fixture.url}/ui-traps.html?case=transient-animation-and-mask`, {
      waitUntil: "domcontentloaded",
    });

    const slidingBtn = page.locator("#btn-sliding-target");
    await page.click("#btn-start-slide");

    const stability = await readinessGateService.waitForElementStability(slidingBtn, {
      frames: 2,
      maxWaitMs: 1000,
    });

    assert.equal(stability.stable, true);
    assert.equal(stability.moved, true);
    assert.ok(stability.elapsedMs >= 250, `Expected stability wait >= 250ms for 350ms animation, got ${stability.elapsedMs}ms`);

    const probe = await readinessGateService.probeHitTest(slidingBtn);
    assert.equal(probe.obstructed, false);
    await page.mouse.click(probe.safePoint.x, probe.safePoint.y);
    assert.equal(await page.textContent("#sliding-result"), "Đã bấm nút trượt");
  });

  it("overlay-and-modal: loading mask tự tắt sau 500ms -> ensureActionable đợi rồi trả ready: true; cookie/modal tĩnh trả sớm ready: false", async () => {
    await page.goto(`${fixture.url}/ui-traps.html?case=overlay-and-modal`, {
      waitUntil: "domcontentloaded",
    });
    const session = createTestSession(page);
    pageTelemetryService.attach(page, session);

    // 1. Cookie banner tĩnh -> fail-early ngay không đợi 4s
    const cookieStart = Date.now();
    const cookieRes = await readinessGateService.ensureActionable(
      page,
      page.locator("#btn-cookie-target"),
      session,
      { timeoutMs: 4000 }
    );
    const cookieElapsed = Date.now() - cookieStart;
    assert.equal(cookieRes.ready, false);
    assert.equal(cookieRes.occluder.isCookieBanner, true);
    assert.equal(cookieRes.occluder.category, "cookie_banner");
    assert.ok(cookieElapsed < 500, `Expected fail-early on cookie banner < 500ms, got ${cookieElapsed}ms`);

    // 2. Loading mask tự tắt sau 500ms -> đợi rồi trả ready: true
    await page.click("#btn-trigger-loading");
    const loadingRes = await readinessGateService.ensureActionable(
      page,
      page.locator("#btn-loading-target"),
      session,
      { timeoutMs: 4000 }
    );
    assert.equal(loadingRes.ready, true);
    assert.ok(loadingRes.safePoint);

    // 3. Modal nghiệp vụ tĩnh -> fail-early ngay với isModal === true
    await page.click("#btn-open-modal");
    const modalStart = Date.now();
    const modalRes = await readinessGateService.ensureActionable(
      page,
      page.locator("#btn-modal-target"),
      session,
      { timeoutMs: 4000 }
    );
    const modalElapsed = Date.now() - modalStart;
    assert.equal(modalRes.ready, false);
    assert.equal(modalRes.occluder.isModal, true);
    assert.equal(modalRes.occluder.category, "modal");
    assert.ok(modalElapsed < 500, `Expected fail-early on modal < 500ms, got ${modalElapsed}ms`);
  });

  it("nested-scrollable-and-footer: scrollIntoSafeViewport cuộn container lồng nhau và tránh thanh sticky/fixed footer", async () => {
    await page.setContent(`
      <!doctype html>
      <html>
        <body style="margin:0; height: 2200px;">
          <div style="position:fixed; top:0; left:0; right:0; height:70px; background:#111; z-index:50;">Top Bar</div>
          <div style="height: 200px;"></div>
          <div id="nested-box" style="height: 260px; overflow-y: auto; border: 1px solid #ccc; margin: 16px;">
            <div style="height: 600px;">Spacer top</div>
            <button id="nested-btn" style="padding:10px 16px;">Nút trong container</button>
            <div style="height: 600px;">Spacer bottom</div>
          </div>
          <div style="position:fixed; bottom:0; left:0; right:0; height:80px; background:#222; z-index:50;">Bottom Bar</div>
        </body>
      </html>
    `);

    const nestedBtn = page.locator("#nested-btn");
    const scrollRes = await readinessGateService.scrollIntoSafeViewport(nestedBtn);
    assert.equal(scrollRes.scrolled, true);
    assert.equal(scrollRes.inSafeBand, true);
    assert.ok(scrollRes.topInset >= 70);
    assert.ok(scrollRes.bottomInset >= 80);

    const probe = await readinessGateService.probeHitTest(nestedBtn);
    assert.equal(probe.obstructed, false);
    assert.ok(probe.safePoint.y > 70 && probe.safePoint.y < 800 - 80);
  });

  it("waitForPageQuiescence hoàn tất <= 180ms khi trang tĩnh và đợi xong khi có API chậm", async () => {
    await page.goto(`${fixture.url}/ui-traps.html?case=multi-select-overlap`, {
      waitUntil: "load",
    });
    const session = createTestSession(page);
    pageTelemetryService.attach(page, session);

    const idleRes = await readinessGateService.waitForPageQuiescence(page, session);
    assert.equal(idleRes.quiet, true);
    assert.equal(idleRes.criticalInFlightCount, 0);
    assert.ok(idleRes.elapsedMs <= 180, `Expected quiescence <= 180ms when idle, got ${idleRes.elapsedMs}ms`);

    // Kích hoạt request chậm 400ms và kiểm tra waitForPageQuiescence đợi xong
    const slowFetchPromise = page.evaluate(() => fetch("/api/save-slow", { method: "POST" }).then((r) => r.status));
    await new Promise((r) => setTimeout(r, 40));
    const slowRes = await readinessGateService.waitForPageQuiescence(page, session, {
      softNetworkWaitMs: 1800,
      maxWaitMs: 2500,
    });
    const fetchStatus = await slowFetchPromise;
    assert.equal(fetchStatus, 200);
    assert.equal(slowRes.quiet, true);
    assert.equal(slowRes.criticalInFlightCount, 0);
    assert.ok(slowRes.elapsedMs >= 250, `Expected waitForPageQuiescence to wait for slow API, got ${slowRes.elapsedMs}ms`);
  });

  it("Performance: ensureActionable trên nút tĩnh bình thường mất < 100ms", async () => {
    await page.goto(`${fixture.url}/ui-traps.html?case=transient-animation-and-mask`, {
      waitUntil: "load",
    });
    const session = createTestSession(page);
    pageTelemetryService.attach(page, session);

    const staticBtn = page.locator("#btn-start-slide");
    // Khởi động Playwright InjectedScript trên frame mới (mô phỏng trạng thái sau bước resolveLocator/inspect)
    await staticBtn.waitFor({ state: "visible" });
    await readinessGateService.ensureActionable(page, staticBtn, session);

    const samples = [];
    for (let i = 0; i < 5; i++) {
      const started = Date.now();
      const res = await readinessGateService.ensureActionable(page, staticBtn, session);
      const elapsed = Date.now() - started;
      assert.equal(res.ready, true);
      assert.ok(res.safePoint);
      samples.push(elapsed);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[2];
    assert.ok(median < 100, `Expected median ensureActionable on static button < 100ms, got ${median}ms (samples: ${samples.join(", ")})`);
  });
});

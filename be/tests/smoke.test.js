import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixtureServer } from "./helpers/fixture-server.js";
import { browserLifecycleService } from "../src/services/browser/browser-lifecycle.service.js";

describe("Phase 0 Smoke Test: Fixture Server & Playwright Browser", () => {
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

  it("phục vụ đầy đủ mock API endpoints trên 127.0.0.1 với port động", async () => {
    assert.ok(fixture.port > 0);
    assert.match(fixture.url, /^http:\/\/127\.0\.0\.1:\d+$/);

    const okRes = await fetch(`${fixture.url}/api/save-ok`, { method: "POST" });
    assert.equal(okRes.status, 200);
    assert.deepEqual(await okRes.json(), {
      ok: true,
      success: true,
      message: "Đã lưu thành công",
    });

    const slowStart = Date.now();
    const slowRes = await fetch(`${fixture.url}/api/save-slow`, { method: "POST" });
    const slowElapsed = Date.now() - slowStart;
    assert.equal(slowRes.status, 200);
    assert.ok(slowElapsed >= 350, `Expected >= 350ms delay, got ${slowElapsed}ms`);

    const http200ErrRes = await fetch(`${fixture.url}/api/save-http200-error`, { method: "POST" });
    assert.equal(http200ErrRes.status, 200);
    assert.deepEqual(await http200ErrRes.json(), {
      ok: false,
      error: "Dữ liệu không hợp lệ",
    });

    const err422Res = await fetch(`${fixture.url}/api/save-422`, { method: "POST" });
    assert.equal(err422Res.status, 422);

    const err500Res = await fetch(`${fixture.url}/api/save-500`, { method: "POST" });
    assert.equal(err500Res.status, 500);

    const auth401Res = await fetch(`${fixture.url}/api/auth-401`);
    assert.equal(auth401Res.status, 401);

    const rollbackRes = await fetch(`${fixture.url}/api/optimistic-rollback`, { method: "POST" });
    assert.equal(rollbackRes.status, 500);
  });

  it("mở ui-traps.html bằng browserLifecycleService ở chế độ headless và đóng sạch sẽ", async () => {
    const { browser, context, page } = await browserLifecycleService.launch({
      browser: { headless: true },
    });

    try {
      await page.goto(`${fixture.url}/ui-traps.html?case=multi-select-overlap`, {
        waitUntil: "domcontentloaded",
      });

      const title = await page.title();
      assert.equal(title, "AutoTest-Core-v9 UI Trap Fixtures");

      await page.click("#multi-select-trigger");
      const expanded = await page.getAttribute("#multi-select-trigger", "aria-expanded");
      assert.equal(expanded, "true");

      await page.check("#ms-opt-a");
      const isMenuVisible = await page.isVisible("#multi-select-menu");
      assert.equal(isMenuVisible, true);
      assert.equal(await page.isChecked("#ms-opt-a"), true);

      // Verify dropdown overlaps #btn-continue at its center
      const overlapHitId = await page.evaluate(() => {
        const btn = document.getElementById("btn-continue");
        const rect = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit?.closest("#multi-select-menu")?.id || hit?.id || "";
      });
      assert.equal(overlapHitId, "multi-select-menu");

      // Verify other ?case= views render cleanly
      for (const caseName of [
        "toast-variants",
        "sticky-header-overlap",
        "overlay-and-modal",
        "transient-animation-and-mask",
        "native-dialogs",
      ]) {
        await page.goto(`${fixture.url}/ui-traps.html?case=${caseName}`, {
          waitUntil: "domcontentloaded",
        });
        const visible = await page.isVisible(`section[data-case="${caseName}"]`);
        assert.equal(visible, true, `Section ${caseName} should be visible`);
      }
    } finally {
      await browserLifecycleService.closeInstances(context, browser);
    }

    assert.equal(browserLifecycleService.activeBrowsers.size, 0);
  });
});

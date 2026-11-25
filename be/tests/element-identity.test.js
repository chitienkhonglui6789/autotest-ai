import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { browserLifecycleService } from "../src/services/browser/browser-lifecycle.service.js";
import { domInspectorService, cleanSemanticLabel } from "../src/services/engine/dom-inspector.service.js";
import { atomicActionsService } from "../src/services/engine/atomic-actions.service.js";
import { pageTelemetryService } from "../src/services/browser/page-telemetry.service.js";

const AVATAR_SVG_DATA_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><circle cx="18" cy="18" r="16" fill="#4f46e5"/></svg>'
  );

async function startElementIdentityFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

    if (url.pathname === "/t1-input-priority") {
      res.end(`<!doctype html>
        <html lang="vi">
        <head><meta charset="utf-8"><title>T1 Input Priority</title></head>
        <body>
          <form id="login-form">
            <div class="row">
              <label id="lbl-user" for="u">Tên đăng nhập <span class="req">*</span>:</label>
              <input id="u" data-test-key="target-user" name="username" placeholder="điền username" />
            </div>
            <div class="row">
              <label for="other">Ghi chú phụ:</label>
              <input id="other" data-test-key="distractor-input" name="note" placeholder="nhập ghi chú" />
            </div>
          </form>
        </body>
        </html>`);
      return;
    }

    if (url.pathname === "/t2-sibling-and-zero-label") {
      res.end(`<!doctype html>
        <html lang="vi">
        <head>
          <meta charset="utf-8"><title>T2 Sibling & Zero Label</title>
          <style>
            .flex-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
            .grid-row { display: grid; grid-template-columns: 140px 240px; gap: 8px; margin-bottom: 12px; }
            .solo-wrap { margin-top: 16px; }
          </style>
        </head>
        <body>
          <div class="flex-row">
            <span>Mã nhân viên *</span>
            <input data-test-key="emp-code" type="text" placeholder="Nhập mã" />
          </div>
          <div class="grid-row">
            <div>Phòng ban (bắt buộc):</div>
            <div><input data-test-key="dept-input" type="text" placeholder="Nhập phòng ban" /></div>
          </div>
          <div class="solo-wrap">
            <input data-test-key="zero-label-input" type="text" placeholder="điền username" />
          </div>
        </body>
        </html>`);
      return;
    }

    if (url.pathname === "/t3-custom-combobox") {
      res.end(`<!doctype html>
        <html lang="vi">
        <head>
          <meta charset="utf-8"><title>T3 Custom Combobox</title>
          <style>
            .ant-form-item { margin-bottom: 16px; }
            .ant-select-selector { display: inline-block; min-width: 180px; padding: 6px 10px; border: 1px solid #ccc; cursor: pointer; }
          </style>
        </head>
        <body>
          <div class="ant-form-item">
            <label>Tỉnh/Thành phố *</label>
            <div role="combobox" class="ant-select-selector" data-test-key="province-combo">Chọn tỉnh...</div>
          </div>

          <div class="ant-form-item">
            <div class="ant-form-item-label"><label>Quận/Huyện (bắt buộc):</label></div>
            <div class="ant-form-item-control">
              <div class="ant-select">
                <div role="combobox" class="ant-select-selector" aria-placeholder="Chọn quận..." data-test-key="district-combo">
                  <span class="ant-select-selection-placeholder">Chọn quận...</span>
                </div>
              </div>
            </div>
          </div>
        </body>
        </html>`);
      return;
    }

    if (url.pathname === "/t4-choice-groups-switch") {
      res.end(`<!doctype html>
        <html lang="vi">
        <head>
          <meta charset="utf-8"><title>T4 Choice Groups & Toggle Switch</title>
          <style>
            .switch-row { display: flex; align-items: center; gap: 10px; margin: 12px 0; }
            button[role="switch"] { width: 44px; height: 24px; border-radius: 12px; border: 1px solid #999; background: #eee; cursor: pointer; }
            button[role="switch"][aria-checked="true"] { background: #10b981; }
          </style>
        </head>
        <body>
          <fieldset>
            <legend>Giới tính *</legend>
            <label><input type="radio" name="gender" value="nam" data-test-key="gender-nam" /> Nam</label>
            <label><input type="radio" name="gender" value="nu" data-test-key="gender-nu" /> Nữ</label>
            <label><input type="radio" name="gender" value="khac" data-test-key="gender-khac" /> Khác</label>
          </fieldset>

          <div role="radiogroup" aria-label="Trạng thái">
            <label><input type="radio" name="status" value="active" data-test-key="status-active" /> Hoạt động</label>
            <label><input type="radio" name="status" value="locked" data-test-key="status-locked" /> Khóa</label>
          </div>

          <div class="form-group">
            <label class="form-label">Nguồn khách:</label>
            <div class="opts">
              <label><input type="radio" name="source" value="web" data-test-key="source-web" /> Website</label>
              <label><input type="radio" name="source" value="khac" data-test-key="source-khac" /> Khác</label>
            </div>
          </div>

          <div class="switch-row">
            <button
              type="button"
              role="switch"
              aria-checked="false"
              data-test-key="switch-activate"
              onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked') === 'true' ? 'false' : 'true')"
            ></button>
            <span>Kích hoạt tài khoản</span>
          </div>

          <div class="form-group">
            <label>Nhận thông báo email</label>
            <button
              type="button"
              role="switch"
              aria-checked="false"
              data-test-key="switch-email"
              onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked') === 'true' ? 'false' : 'true')"
            ></button>
          </div>

          <div class="ant-form-item">
            <div class="ant-form-item-label"><label>Tự động gia hạn *</label></div>
            <div class="ant-form-item-control">
              <button
                type="button"
                role="switch"
                aria-checked="false"
                data-test-key="switch-autorenew"
                onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked') === 'true' ? 'false' : 'true')"
              ></button>
            </div>
          </div>
        </body>
        </html>`);
      return;
    }

    if (url.pathname === "/t5-dynamic-badge") {
      res.end(`<!doctype html>
        <html lang="vi">
        <head><meta charset="utf-8"><title>T5 Dynamic Badge Button</title></head>
        <body>
          <button data-test-key="btn-cart">Giỏ hàng <span class="badge">(0)</span></button>
          <button data-test-key="btn-noti">Thông báo 12</button>
          <a href="#messages" data-test-key="link-msg">Tin nhắn [5]</a>
        </body>
        </html>`);
      return;
    }

    if (url.pathname === "/t6-repeated-and-table") {
      res.end(`<!doctype html>
        <html lang="vi">
        <head>
          <meta charset="utf-8"><title>T6 Repeated & Table Rows</title>
          <style>
            .avatars img { width: 36px; height: 36px; cursor: pointer; margin-right: 8px; }
          </style>
        </head>
        <body>
          <div class="bulk-actions">
            <button data-test-key="del-0">Xóa</button>
            <button data-test-key="del-1">Xóa</button>
            <button data-test-key="del-2">Xóa</button>
          </div>

          <div class="avatars">
            <img data-test-key="ava-0" alt="Avatar" src="${AVATAR_SVG_DATA_URI}" />
            <img data-test-key="ava-1" alt="Avatar" src="${AVATAR_SVG_DATA_URI}" />
            <img data-test-key="ava-2" alt="Avatar" src="${AVATAR_SVG_DATA_URI}" />
          </div>

          <table id="orders-table">
            <thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Thao tác</th></tr></thead>
            <tbody>
              <tr>
                <td>DH-1001</td>
                <td>Nguyễn Văn A</td>
                <td><button data-test-key="row-del-1001">Xóa</button></td>
              </tr>
              <tr>
                <td>DH-1002</td>
                <td>Trần Thị B</td>
                <td><button data-test-key="row-del-1002">Xóa</button></td>
              </tr>
            </tbody>
          </table>
        </body>
        </html>`);
      return;
    }

    if (url.pathname === "/t7-section-and-landmarks") {
      res.end(`<!doctype html>
        <html lang="vi">
        <head><meta charset="utf-8"><title>T7 Section & Landmarks</title></head>
        <body>
          <header>
            <button data-test-key="header-search">Tìm kiếm</button>
          </header>

          <nav aria-label="Menu chính">
            <a href="#dashboard" data-test-key="nav-home">Tổng quan</a>
          </nav>

          <main>
            <button data-test-key="main-search">Tìm kiếm</button>

            <fieldset>
              <legend>Thông tin người mua</legend>
              <label>Số điện thoại <input type="tel" data-test-key="buyer-phone" placeholder="Nhập SĐT" /></label>
            </fieldset>

            <fieldset>
              <legend>Thông tin người nhận</legend>
              <label>Số điện thoại <input type="tel" data-test-key="receiver-phone" placeholder="Nhập SĐT" /></label>
            </fieldset>
          </main>

          <footer>
            <a href="#policy" data-test-key="footer-policy">Chính sách bảo mật</a>
          </footer>
        </body>
        </html>`);
      return;
    }

    if (url.pathname === "/t8-legacy-compat") {
      res.end(`<!doctype html>
        <html lang="vi">
        <head><meta charset="utf-8"><title>T8 Legacy Compatibility</title></head>
        <body>
          <form>
            <label for="legacy-fullname">Họ và tên *</label>
            <input id="legacy-fullname" data-test-key="legacy-name" type="text" placeholder="Nhập họ tên" />
            <button type="button" data-test-key="legacy-save">Lưu lại</button>
            <button type="button" title="Đóng bảng" data-test-key="legacy-close">×</button>
          </form>
          <table>
            <tbody>
              <tr><td>DH-2001</td><td><button data-test-key="legacy-row-1">Xóa</button></td></tr>
              <tr><td>DH-2002</td><td><button data-test-key="legacy-row-2">Xóa</button></td></tr>
            </tbody>
          </table>
        </body>
        </html>`);
      return;
    }

    res.end("<h1>Element Identity Test Server</h1>");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function getTestKey(locator) {
  return await locator.getAttribute("data-test-key");
}

async function findMetaByTestKey(page, snapshot, testKey) {
  const targetAtId = await page.locator(`[data-test-key="${testKey}"]`).first().getAttribute("data-at-id");
  assert.ok(targetAtId, `Expected element [data-test-key="${testKey}"] to be collected and assigned data-at-id`);
  const meta = snapshot.elementMap.get(Number(targetAtId));
  assert.ok(meta, `Expected snapshot.elementMap to contain id=${targetAtId} for "${testKey}"`);
  return meta;
}

describe("5-Dimensional Unified Element Identity Model (Inspector + Locator E2E)", () => {
  let server;
  let browser;
  let context;
  let page;
  let session;

  before(async () => {
    server = await startElementIdentityFixtureServer();
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
      currentStepDownloads: [],
      prevStepDownloads: [],
      telemetry: pageTelemetryService.createSessionState(),
    };
  });

  after(async () => {
    await browserLifecycleService.destroyAll();
    if (server) await server.close();
  });

  it("T1: Input Label vs Placeholder vs Name — cleanLabel, snapshot formatting, Label > Placeholder priority & fallback", async () => {
    assert.equal(cleanSemanticLabel("Tên đăng nhập *:"), "Tên đăng nhập");
    assert.equal(cleanSemanticLabel("* Email (bắt buộc) :"), "Email");
    assert.equal(cleanSemanticLabel("Số điện thoại (required)"), "Số điện thoại");
    assert.equal(cleanSemanticLabel("Ghi chú (optional) •"), "Ghi chú");

    await page.goto(`${server.url}/t1-input-priority`, { waitUntil: "domcontentloaded" });
    const snapshot = await domInspectorService.inspect(page, session);
    const llmText = domInspectorService.formatSnapshotForLlm(snapshot, session);

    const userMeta = await findMetaByTestKey(page, snapshot, "target-user");
    assert.equal(userMeta.cleanLabel, "Tên đăng nhập");
    assert.equal(userMeta.placeholder, "điền username");
    assert.equal(userMeta.name, "username");

    // Snapshot phải phát đủ cả 3 manh mối: label=, placeholder=, name=
    assert.match(llmText, /label="Tên đăng nhập"/);
    assert.match(llmText, /placeholder="điền username"/);
    assert.match(llmText, /name="username"/);

    const fullFp = atomicActionsService.extractFingerprint(userMeta);
    assert.equal(fullFp.cleanLabel, "Tên đăng nhập");
    assert.equal(fullFp.placeholder, "điền username");
    assert.equal(fullFp.name, "username");

    // Chứng minh Label > Placeholder priority: bỏ elemId khỏi fp để không bị Tier 1 #id short-circuit,
    // đổi placeholder của ô chính thành chữ mới VÀ gán placeholder cũ ("điền username") sang ô nhiễu!
    await page.evaluate(() => {
      document.querySelector('[data-test-key="target-user"]').setAttribute("placeholder", "Nhập email hoặc SĐT");
      document.querySelector('[data-test-key="distractor-input"]').setAttribute("placeholder", "điền username");
    });

    const semanticOnlyFp = { ...fullFp, elemId: "" };
    const resolvedByLabel = await atomicActionsService.resolveLocator(page, {
      action: "fill",
      fingerprint: semanticOnlyFp,
      replayTimeoutMs: 600,
    });
    assert.equal(
      await getTestKey(resolvedByLabel.locator),
      "target-user",
      "Label (Tier 2) must win over Placeholder (Tier 3) even when another input now owns the old placeholder"
    );

    // Chứng minh Placeholder fallback khi Label biến mất/đổi hoàn toàn:
    await page.evaluate(() => {
      document.getElementById("lbl-user").textContent = "Mã định danh khác";
      document.querySelector('[data-test-key="target-user"]').setAttribute("placeholder", "điền username");
      document.querySelector('[data-test-key="distractor-input"]').setAttribute("placeholder", "nhập ghi chú");
    });
    const resolvedByPlaceholder = await atomicActionsService.resolveLocator(page, {
      action: "fill",
      fingerprint: semanticOnlyFp,
      replayTimeoutMs: 600,
    });
    assert.equal(
      await getTestKey(resolvedByPlaceholder.locator),
      "target-user",
      "Placeholder (Tier 3) must act as fallback when Label changes"
    );

    // Chứng minh Name fallback khi CẢ Label lẫn Placeholder biến mất:
    await page.evaluate(() => {
      document.getElementById("lbl-user").remove();
      document.querySelector('[data-test-key="target-user"]').removeAttribute("placeholder");
    });
    const resolvedByName = await atomicActionsService.resolveLocator(page, {
      action: "fill",
      fingerprint: semanticOnlyFp,
      replayTimeoutMs: 600,
    });
    assert.equal(
      await getTestKey(resolvedByName.locator),
      "target-user",
      "Name attribute (Tier 4) must act as fallback when both Label and Placeholder disappear"
    );
  });

  it("T2: Sibling Label (flex/grid row without for/id or .form-group) & Zero-Label Input", async () => {
    await page.goto(`${server.url}/t2-sibling-and-zero-label`, { waitUntil: "domcontentloaded" });
    const snapshot = await domInspectorService.inspect(page, session);
    const llmText = domInspectorService.formatSnapshotForLlm(snapshot, session);

    const empMeta = await findMetaByTestKey(page, snapshot, "emp-code");
    assert.equal(empMeta.cleanLabel, "Mã nhân viên");
    assert.equal(empMeta.placeholder, "Nhập mã");

    const deptMeta = await findMetaByTestKey(page, snapshot, "dept-input");
    assert.equal(deptMeta.cleanLabel, "Phòng ban");
    assert.equal(deptMeta.placeholder, "Nhập phòng ban");

    const zeroMeta = await findMetaByTestKey(page, snapshot, "zero-label-input");
    assert.equal(zeroMeta.label, "");
    assert.equal(zeroMeta.cleanLabel, "");
    assert.equal(zeroMeta.placeholder, "điền username");
    assert.match(llmText, /label="Mã nhân viên"/);
    assert.match(llmText, /placeholder="điền username"/);

    const empFp = atomicActionsService.extractFingerprint(empMeta);
    const zeroFp = atomicActionsService.extractFingerprint(zeroMeta);

    // Đổi placeholder của ô Sibling Label để chứng minh Replay vẫn tìm được qua nhãn liền kề <span>
    await page.evaluate(() => {
      document.querySelector('[data-test-key="emp-code"]').setAttribute("placeholder", "VD: NV001");
    });
    const empResolved = await atomicActionsService.resolveLocator(page, {
      action: "fill",
      fingerprint: empFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(empResolved.locator), "emp-code");

    // Zero-label input Replay bằng placeholder
    const zeroResolved = await atomicActionsService.resolveLocator(page, {
      action: "fill",
      fingerprint: zeroFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(zeroResolved.locator), "zero-label-input");
  });

  it("T3: Custom Div Combobox (AntD/MUI style) — persistent cleanLabel, text==='', value/placeholder separated & Replay after value mutation", async () => {
    await page.goto(`${server.url}/t3-custom-combobox`, { waitUntil: "domcontentloaded" });
    const snapshot = await domInspectorService.inspect(page, session);
    const llmText = domInspectorService.formatSnapshotForLlm(snapshot, session);

    const provMeta = await findMetaByTestKey(page, snapshot, "province-combo");
    assert.equal(provMeta.cleanLabel, "Tỉnh/Thành phố");
    assert.equal(provMeta.text, "", "Custom combobox must NOT dump displayed value into text");
    assert.equal(provMeta.value, "Chọn tỉnh...");
    assert.equal(provMeta.containerAnchor, "", ".ant-form-item must NOT leak into containerAnchor");

    const distMeta = await findMetaByTestKey(page, snapshot, "district-combo");
    assert.equal(distMeta.cleanLabel, "Quận/Huyện");
    assert.equal(distMeta.text, "", "Nested AntD combobox must NOT dump displayed text into text");
    assert.equal(distMeta.value, "", "Placeholder-marked combobox should keep value empty");
    assert.equal(distMeta.placeholder, "Chọn quận...");
    assert.match(llmText, /label="Tỉnh\/Thành phố"/);
    assert.match(llmText, /label="Quận\/Huyện".*placeholder="Chọn quận\.\.\."/);

    const provFp = atomicActionsService.extractFingerprint(provMeta);
    const distFp = atomicActionsService.extractFingerprint(distMeta);

    // Đột biến giá trị đang hiển thị sang "Hà Nội" và "Hoàn Kiếm" — Replay PHẢI vẫn định vị đúng bằng nhãn bền vững!
    await page.evaluate(() => {
      document.querySelector('[data-test-key="province-combo"]').textContent = "Hà Nội";
      document.querySelector('[data-test-key="district-combo"]').innerHTML =
        '<span class="ant-select-selection-item">Hoàn Kiếm</span>';
    });

    const provResolved = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: provFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(provResolved.locator), "province-combo");

    const distResolved = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: distFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(distResolved.locator), "district-combo");
  });

  it("T4: Checkbox / Radio Group / Toggle Switch (2-tier labels) — groupLabel separation & duplicate option disambiguation", async () => {
    await page.goto(`${server.url}/t4-choice-groups-switch`, { waitUntil: "domcontentloaded" });
    const snapshot = await domInspectorService.inspect(page, session);
    const llmText = domInspectorService.formatSnapshotForLlm(snapshot, session);

    const genderNam = await findMetaByTestKey(page, snapshot, "gender-nam");
    const genderKhac = await findMetaByTestKey(page, snapshot, "gender-khac");
    const statusActive = await findMetaByTestKey(page, snapshot, "status-active");
    const sourceKhac = await findMetaByTestKey(page, snapshot, "source-khac");
    const swActivate = await findMetaByTestKey(page, snapshot, "switch-activate");
    const swEmail = await findMetaByTestKey(page, snapshot, "switch-email");
    const swAutoRenew = await findMetaByTestKey(page, snapshot, "switch-autorenew");

    assert.equal(genderNam.cleanLabel, "Nam");
    assert.equal(genderNam.groupLabel, "Giới tính");
    assert.equal(genderKhac.cleanLabel, "Khác");
    assert.equal(genderKhac.groupLabel, "Giới tính");

    assert.equal(statusActive.cleanLabel, "Hoạt động");
    assert.equal(statusActive.groupLabel, "Trạng thái");

    assert.equal(sourceKhac.cleanLabel, "Khác");
    assert.equal(sourceKhac.groupLabel, "Nguồn khách");

    assert.equal(swActivate.cleanLabel, "Kích hoạt tài khoản");
    assert.equal(swActivate.groupLabel, "");

    assert.equal(
      swEmail.cleanLabel,
      "Nhận thông báo email",
      "Single toggle switch inside .form-group should extract its own label so Replay has semantic identity"
    );
    assert.equal(swEmail.groupLabel, "");

    assert.equal(
      swAutoRenew.cleanLabel,
      "Tự động gia hạn",
      "Single toggle switch inside nested .ant-form-item should extract its own label"
    );
    assert.equal(swAutoRenew.groupLabel, "");

    assert.match(llmText, /label="Nam"\s+group="Giới tính"/);
    assert.match(llmText, /label="Khác"\s+group="Giới tính"/);
    assert.match(llmText, /label="Khác"\s+group="Nguồn khách"/);
    assert.match(llmText, /label="Hoạt động"\s+group="Trạng thái"/);
    assert.match(llmText, /role="switch".*label="Kích hoạt tài khoản"/);

    // Replay phân biệt 2 lựa chọn trùng nhãn "Khác" ở 2 nhóm khác nhau (ép occurrenceIndex=0 để chứng minh groupLabel thực sự khoanh vùng!)
    const genderKhacFp = { ...atomicActionsService.extractFingerprint(genderKhac), occurrenceIndex: 0 };
    const sourceKhacFp = { ...atomicActionsService.extractFingerprint(sourceKhac), occurrenceIndex: 0 };

    const resGenderKhac = await atomicActionsService.resolveLocator(page, {
      action: "setCheck",
      fingerprint: genderKhacFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(resGenderKhac.locator), "gender-khac");

    const resSourceKhac = await atomicActionsService.resolveLocator(page, {
      action: "setCheck",
      fingerprint: sourceKhacFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(resSourceKhac.locator), "source-khac");

    // Replay thực thi setCheck thật trên [role="switch"]
    const swActivateFp = atomicActionsService.extractFingerprint(swActivate);
    const swRes = await atomicActionsService.executeAction(
      { action: "setCheck", value: "true", fingerprint: swActivateFp, replayTimeoutMs: 600 },
      session
    );
    assert.equal(swRes.success, true);
    assert.equal(await page.locator('[data-test-key="switch-activate"]').getAttribute("aria-checked"), "true");

    const swEmailFp = atomicActionsService.extractFingerprint(swEmail);
    const swEmailRes = await atomicActionsService.resolveLocator(page, {
      action: "setCheck",
      fingerprint: swEmailFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(swEmailRes.locator), "switch-email");

    const swAutoRenewFp = atomicActionsService.extractFingerprint(swAutoRenew);
    const swAutoRenewRes = await atomicActionsService.resolveLocator(page, {
      action: "setCheck",
      fingerprint: swAutoRenewFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(swAutoRenewRes.locator), "switch-autorenew");
  });

  it("T5: Dynamic Badge Button — cleanLabel strips counter while text preserves raw, Replay survives DOM mutation (0) -> (5)", async () => {
    await page.goto(`${server.url}/t5-dynamic-badge`, { waitUntil: "domcontentloaded" });
    const snapshot = await domInspectorService.inspect(page, session);
    const llmText = domInspectorService.formatSnapshotForLlm(snapshot, session);

    const cartMeta = await findMetaByTestKey(page, snapshot, "btn-cart");
    assert.equal(cartMeta.text, "Giỏ hàng (0)");
    assert.equal(cartMeta.cleanLabel, "Giỏ hàng");

    const notiMeta = await findMetaByTestKey(page, snapshot, "btn-noti");
    assert.equal(notiMeta.text, "Thông báo 12");
    assert.equal(notiMeta.cleanLabel, "Thông báo");

    const msgMeta = await findMetaByTestKey(page, snapshot, "link-msg");
    assert.equal(msgMeta.text, "Tin nhắn [5]");
    assert.equal(msgMeta.cleanLabel, "Tin nhắn");

    assert.match(llmText, /text="Giỏ hàng \(0\)"\s+label="Giỏ hàng"/);

    const cartFp = atomicActionsService.extractFingerprint(cartMeta);
    const notiFp = atomicActionsService.extractFingerprint(notiMeta);
    const msgFp = atomicActionsService.extractFingerprint(msgMeta);

    // Đột biến số đếm động trên DOM: (0) -> (5), 12 -> 99+, [5] -> [0]
    await page.evaluate(() => {
      document.querySelector('[data-test-key="btn-cart"] .badge').textContent = "(5)";
      document.querySelector('[data-test-key="btn-noti"]').textContent = "Thông báo 99+";
      document.querySelector('[data-test-key="link-msg"]').textContent = "Tin nhắn [0]";
    });

    const cartRes = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: cartFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(cartRes.locator), "btn-cart");

    const notiRes = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: notiFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(notiRes.locator), "btn-noti");

    const msgRes = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: msgFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(msgRes.locator), "link-msg");
  });

  it("T6: Repeated Elements (#1/N, #2/N, clickable img[alt]) & Table Rows (containerAnchor scoping)", async () => {
    await page.goto(`${server.url}/t6-repeated-and-table`, { waitUntil: "domcontentloaded" });
    const snapshot = await domInspectorService.inspect(page, session);
    const llmText = domInspectorService.formatSnapshotForLlm(snapshot, session);

    // Part A: 3 nút "Xóa" giống nhau ngoài table row + 3 <img alt="Avatar">
    const del0 = await findMetaByTestKey(page, snapshot, "del-0");
    const del1 = await findMetaByTestKey(page, snapshot, "del-1");
    const del2 = await findMetaByTestKey(page, snapshot, "del-2");

    assert.equal(del0.occurrenceIndex, 0);
    assert.equal(del0.occurrenceTotal, 3);
    assert.equal(del1.occurrenceIndex, 1);
    assert.equal(del1.occurrenceTotal, 3);
    assert.equal(del2.occurrenceIndex, 2);
    assert.equal(del2.occurrenceTotal, 3);

    const ava0 = await findMetaByTestKey(page, snapshot, "ava-0");
    const ava1 = await findMetaByTestKey(page, snapshot, "ava-1");
    const ava2 = await findMetaByTestKey(page, snapshot, "ava-2");

    assert.equal(ava0.alt, "Avatar");
    assert.equal(ava0.occurrenceIndex, 0);
    assert.equal(ava0.occurrenceTotal, 3);
    assert.equal(ava1.occurrenceIndex, 1);
    assert.equal(ava1.occurrenceTotal, 3);
    assert.equal(ava2.occurrenceIndex, 2);
    assert.equal(ava2.occurrenceTotal, 3);

    assert.match(llmText, /text="Xóa".*\(#1\/3\)/);
    assert.match(llmText, /text="Xóa".*\(#2\/3\)/);
    assert.match(llmText, /text="Xóa".*\(#3\/3\)/);
    assert.match(llmText, /alt="Avatar".*\(#1\/3\)/);
    assert.match(llmText, /alt="Avatar".*\(#2\/3\)/);
    assert.match(llmText, /alt="Avatar".*\(#3\/3\)/);

    // Replay với occurrenceIndex: 1 PHẢI trỏ đúng nút "Xóa" thứ 2 (del-1), KHÔNG được chọn del-0!
    const del1Fp = atomicActionsService.extractFingerprint(del1);
    assert.equal(del1Fp.occurrenceIndex, 1);
    const del1Res = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: del1Fp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(del1Res.locator), "del-1");

    // Replay ảnh Avatar thứ 3 (occurrenceIndex: 2)
    const ava2Fp = atomicActionsService.extractFingerprint(ava2);
    const ava2Res = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: ava2Fp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(ava2Res.locator), "ava-2");

    // Part B: 2 dòng bảng (DH-1001, DH-1002) mỗi dòng có 1 nút "Xóa"
    const row1Del = await findMetaByTestKey(page, snapshot, "row-del-1001");
    const row2Del = await findMetaByTestKey(page, snapshot, "row-del-1002");

    assert.equal(row1Del.containerAnchor, "DH-1001");
    assert.equal(row1Del.occurrenceIndex, 0);
    assert.equal(row1Del.occurrenceTotal, 1);

    assert.equal(row2Del.containerAnchor, "DH-1002");
    assert.equal(row2Del.occurrenceIndex, 0);
    assert.equal(row2Del.occurrenceTotal, 1);

    assert.match(llmText, /\(Thuộc dòng\/khung: "DH-1001"\)/);
    assert.match(llmText, /\(Thuộc dòng\/khung: "DH-1002"\)/);

    const row1Res = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: atomicActionsService.extractFingerprint(row1Del),
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(row1Res.locator), "row-del-1001");

    const row2Res = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: atomicActionsService.extractFingerprint(row2Del),
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(row2Res.locator), "row-del-1002");
  });

  it("T7: Section (<fieldset>) & Landmark (<header>/<main>/<nav>/<footer>) Disambiguation", async () => {
    await page.goto(`${server.url}/t7-section-and-landmarks`, { waitUntil: "domcontentloaded" });
    const snapshot = await domInspectorService.inspect(page, session);
    const llmText = domInspectorService.formatSnapshotForLlm(snapshot, session);

    const buyerPhone = await findMetaByTestKey(page, snapshot, "buyer-phone");
    const receiverPhone = await findMetaByTestKey(page, snapshot, "receiver-phone");
    const headerSearch = await findMetaByTestKey(page, snapshot, "header-search");
    const mainSearch = await findMetaByTestKey(page, snapshot, "main-search");
    const navHome = await findMetaByTestKey(page, snapshot, "nav-home");
    const footerPolicy = await findMetaByTestKey(page, snapshot, "footer-policy");

    assert.equal(buyerPhone.cleanLabel, "Số điện thoại");
    assert.equal(buyerPhone.sectionAnchor, "Thông tin người mua");
    assert.equal(receiverPhone.cleanLabel, "Số điện thoại");
    assert.equal(receiverPhone.sectionAnchor, "Thông tin người nhận");

    assert.equal(headerSearch.region, "header");
    assert.equal(mainSearch.region, "main");
    assert.equal(navHome.region, "nav");
    assert.equal(footerPolicy.region, "footer");

    assert.match(llmText, /\[HEADER\].*text="Tìm kiếm"/);
    assert.match(llmText, /\[SIDEBAR\].*text="Tổng quan"/);
    assert.match(llmText, /\[FOOTER\].*text="Chính sách bảo mật"/);
    assert.match(llmText, /\(Khối: "Thông tin người mua"\)/);
    assert.match(llmText, /\(Khối: "Thông tin người nhận"\)/);

    // Ép occurrenceIndex = 0 để chứng minh sectionAnchor & region thực sự khoanh vùng chính xác!
    const buyerFp = { ...atomicActionsService.extractFingerprint(buyerPhone), occurrenceIndex: 0 };
    const receiverFp = { ...atomicActionsService.extractFingerprint(receiverPhone), occurrenceIndex: 0 };

    const buyerRes = await atomicActionsService.resolveLocator(page, {
      action: "fill",
      fingerprint: buyerFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(buyerRes.locator), "buyer-phone");

    const receiverRes = await atomicActionsService.resolveLocator(page, {
      action: "fill",
      fingerprint: receiverFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(receiverRes.locator), "receiver-phone");

    const headerFp = { ...atomicActionsService.extractFingerprint(headerSearch), occurrenceIndex: 0 };
    const mainFp = { ...atomicActionsService.extractFingerprint(mainSearch), occurrenceIndex: 0 };

    const headerRes = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: headerFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(headerRes.locator), "header-search");

    const mainRes = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: mainFp,
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(mainRes.locator), "main-search");
  });

  it("T8: Backwards Compatibility — legacy SQLite fingerprints without cleanLabel/groupLabel/sectionAnchor/region still resolve", async () => {
    await page.goto(`${server.url}/t8-legacy-compat`, { waitUntil: "domcontentloaded" });

    // Legacy fingerprint không có cleanLabel, groupLabel, sectionAnchor, region, inModal, occurrenceTotal
    const legacyInputRes = await atomicActionsService.resolveLocator(page, {
      action: "fill",
      fingerprint: {
        frameIndex: 0,
        tag: "input",
        type: "text",
        label: "Họ và tên",
        placeholder: "Nhập họ tên",
      },
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(legacyInputRes.locator), "legacy-name");

    const legacyBtnRes = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: {
        frameIndex: 0,
        tag: "button",
        text: "Lưu lại",
      },
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(legacyBtnRes.locator), "legacy-save");

    const legacyTitleBtnRes = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: {
        frameIndex: 0,
        tag: "button",
        title: "Đóng bảng",
      },
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(legacyTitleBtnRes.locator), "legacy-close");

    const legacyRowBtnRes = await atomicActionsService.resolveLocator(page, {
      action: "click",
      fingerprint: {
        frameIndex: 0,
        tag: "button",
        text: "Xóa",
        containerAnchor: "DH-2002",
      },
      replayTimeoutMs: 600,
    });
    assert.equal(await getTestKey(legacyRowBtnRes.locator), "legacy-row-2");
  });
});

import { config } from "../../config/env.js";
import {
  FAILURE_TYPES,
  VERDICT_STATUS,
  DIAGNOSTIC_STRICTNESS,
  ORACLE_SOURCES,
  classifyStepVerdict,
  inferDisplayStepType,
  normalizeStrictnessMode,
} from "../../constants/stepTypes.js";
import { logger } from "../../utils/logger.js";
import { toUrl, extractRoutePath } from "../../utils/url.js";
import { llmService } from "../llm.service.js";
import { storageService } from "../storage.service.js";
import { browserLifecycleService } from "../browser/browser-lifecycle.service.js";
import { takeScreenshot } from "../browser/screenshot.service.js";
import {
  captureUiDiagnosticBaseline,
  inspectUiDiagnostics,
  evaluateCausalDiagnostics,
} from "../browser/diagnostics.service.js";
import { pageTelemetryService } from "../browser/page-telemetry.service.js";
import { domInspectorService } from "./dom-inspector.service.js";
import { atomicActionsService } from "./atomic-actions.service.js";
import { stepCacheService } from "./step-cache.service.js";

const ASSERT_ACTION_KINDS = new Set([
  "assert",
  "verify",
  "observe",
  "asserttext",
  "asserthidden",
  "assertnotexists",
  "assertnotvisible",
  "verifyhidden",
  "verifynotexists",
  "asserturl",
  "verifyurl",
  "asserturlnot",
  "assertstate",
  "verifystate",
  "assertvalue",
  "verifyvalue",
  "assertcount",
  "verifycount",
  "assertdownload",
  "verifydownload",
  "assertcompare",
  "assertmath",
  "verifycompare",
  "assertverdict",
  "judgeverdict",
]);

const MICRO_AGENT_SYSTEM_PROMPT = `Bạn là Trái Tim Điều Khiển Kiểm Thử Tự Động (Micro-ReAct Browser Agent) chạy trên Playwright gốc.
Nhiệm vụ của bạn: Thực hiện chính xác "YÊU CẦU CỦA BƯỚC HIỆN TẠI" dựa trên "TRẠNG THÁI TRÌNH DUYỆT HIỆN TẠI".

QUY TẮC CỐT LÕI:
1. Định vị Phần tử Đa Phương Thức (CHỈ chọn phần tử có thật trong [DANH SÁCH PHẦN TỬ TƯƠNG TÁC ĐÁNH SỐ] bằng con số "targetId", ví dụ: "targetId": 5; TUYỆT ĐỐI không tự bịa ra XPath hay CSS selector):
   - Ô nhập liệu (Input / Textarea / Search / OTP / Date): Đối chiếu yêu cầu người dùng xuyên suốt CẢ 4 manh mối: label="..." (nhãn sạch) → placeholder="..." (chữ gợi ý, ví dụ 'điền username') → name="..." / id="#..." (tên trường kỹ thuật như username) → title="...". Dù kịch bản gọi theo Nhãn hiển thị, Placeholder hay tên trường kỹ thuật đều chọn đúng "targetId" của ô đó. Nếu có nhiều ô cùng nhãn trên trang (vd 2 ô "Số điện thoại"), đối chiếu (Khối: "...") hoặc [TRONG MODAL].
   - Hộp chọn (Native Select & Custom Dropdown/Combobox): Nhận diện hộp mở dựa trên label="...", placeholder="..." hoặc name="...", KHÔNG bị đánh lừa bởi giá trị đang chọn sẵn value="...".
   - Checkbox / Radio / Switch (2 tầng nhãn): Đối chiếu cả nhãn lựa chọn label="..." lẫn nhãn nhóm câu hỏi group="..." (vd: group="Giới tính" label="Nam").
   - Nút bấm, Nút có số đếm động, Icon & Hình ảnh: Nút chữ hoặc nút kèm số đếm động (vd "Giỏ hàng (3)") nhận diện theo text="..." / label="..."; nút chỉ có icon dựa vào label="...", title="...", icon="...", testid="..."; thẻ ảnh/avatar dựa vào alt="...", label="...". Phân biệt vùng giao diện qua [HEADER], [SIDEBAR], [FOOTER], [TRONG MODAL].
   - Phần tử trùng lặp trong Bảng / Thẻ / Danh sách: Bắt buộc đối chiếu (Thuộc dòng/khung: "...") hoặc thứ tự (#1/N, #2/N,...) để chọn chính xác "targetId" của dòng sản phẩm/khung/nhân viên hoặc vị trí thứ k người dùng yêu cầu.
2. Xử lý Modal & Popup nổi: Nếu trên màn hình xuất hiện [MODAL ĐANG MỞ] và các phần tử có nhãn [TRONG MODAL], ưu tiên tương tác bên trong hộp thoại nổi đó trước. Tuy nhiên, nếu [MODAL ĐANG MỞ] là thông báo bất ngờ (quảng cáo, cookie, thông báo bảo trì, popup che khuất không liên quan và không chứa phần tử bước hiện tại đang cần tìm), hãy bấm nút đóng (icon="close-x", nút "Đóng"/"Hủy"/"Cancel"/"Bỏ qua") hoặc gọi "clickOutside" rồi đặt "isStepComplete": false để đóng popup trước, nhịp sau mới thực hiện yêu cầu chính.
3. Hỗ trợ Câu ghép & Vòng lặp Vi mô:
   - Nếu các thao tác trong câu yêu cầu đều đã hiển thị sẵn phần tử trên màn hình hiện tại (ví dụ: Điền ô tài khoản [1], điền ô mật khẩu [2], bấm nút đăng nhập [3]), hãy trả về mảng "actions" chứa cả 3 thao tác đó theo thứ tự và đặt "isStepComplete": true.
   - Nếu thao tác sau phụ thuộc vào thao tác trước (ví dụ: phải Click mở hộp chọn Custom Dropdown trước rồi danh sách mới xổ ra; hoặc phải Chọn Tỉnh trước rồi danh sách Quận mới tải về; hoặc phải Hover vào dòng trước thì nút 3 chấm mới hiện ra), hãy chỉ trả về thao tác mở/chọn đầu tiên và đặt "isStepComplete": false để nhịp tiếp theo quan sát lại màn hình mới!
   - Nếu bước yêu cầu tìm/chọn một mục ("Chọn sản phẩm X", "Tìm mục Y" — KHÔNG phải bước Kiểm tra/Assert) mà mục đó ĐÃ hiển thị sẵn trên màn hình trong [VĂN BẢN HIỂN THỊ] hoặc [DANH SÁCH PHẦN TỬ], TUYỆT ĐỐI KHÔNG bấm lại nút "Tìm kiếm" nhiều lần! Nếu có ô/thẻ chọn riêng thì bấm 1 lần rồi hoàn tất; nếu không có phần tử nào cần bấm riêng cho việc "chọn" đó, hãy trả về "actions": [], "isStepComplete": true.
4. Khi câu yêu cầu muốn sử dụng lại dữ liệu vừa đọc ở bước trước (ví dụ: "nhập mã đơn hàng vừa tạo", "nhập mã vừa lưu"), hãy điền chuỗi "{{LAST_EXTRACTED}}" (hoặc tên biến tương ứng trong [KHO BIẾN KỊCH BẢN]) vào trường "value".
5. Danh sách các loại "action" hợp lệ duy nhất:
   - "navigate": Mở URL (truyền URL vào "value").
   - "wait": Chờ một khoảng thời gian mili-giây (ví dụ: "value": "2000").
   - "click": Bấm chuột vào phần tử "targetId".
   - "hover": Di chuột vào phần tử "targetId" (để hiện menu ẩn / nút 3 chấm).
   - "fill": Xóa sạch chữ cũ và điền chữ "value" vào phần tử "targetId".
   - "select": Chọn mục có chữ "value" trong thẻ <select> hoặc hộp chọn "targetId".
   - "setCheck": Tick chọn ("value": "true") hoặc bỏ chọn ("value": "false") ô checkbox/radio "targetId".
   - "pressKey": Nhấn phím bàn phím như "Enter", "Tab", "Escape" ("value": "Enter", kèm "targetId" nếu nhấn trên ô cụ thể).
   - "clickOutside": Bấm chuột ra vùng trống an toàn bên ngoài để đóng bảng nổi / dropdown (không cần "targetId").
   - "uploadFile": Tải tệp lên ("value": tên tệp, kèm "targetId" nếu có).
   - "handleDialog": Quyết định xử lý hộp thoại ("value": "accept" để Đồng ý, hoặc "value": "dismiss" để Hủy bỏ; thêm "promptText": "..." nếu hộp thoại prompt yêu cầu nhập chữ).
   - "switchTab": Chuyển tab trình duyệt ("value": "latest" sang tab mới, "first" về tab đầu, "close" đóng tab hiện tại).
   - "dragAndDrop": Kéo thả từ "targetId" sang "destId".
   - "extract": Đọc nội dung của phần tử "targetId" (hoặc theo mẫu regex "pattern" như "DH-[0-9-]+") và lưu vào biến "varName" (ví dụ: "varName": "ma_don_hang").
   - BỘ NGUYÊN THỦY KIỂM CHỨNG TẤT ĐỊNH (ƯU TIÊN DÙNG CHO BƯỚC KIỂM TRA):
     + "assert": Kiểm tra chữ hiển thị ("value": chữ cần kiểm tra). NẾU kiểm tra chữ trong 1 ô/badge/dòng cụ thể (vd: số lượng giỏ hàng "1", trạng thái dòng đơn hàng "DH-1001"), BẮT BUỘC truyền thêm "targetId" hoặc "containerAnchor" để tránh khớp nhầm chữ ở nơi khác trên trang!
     + "assertHidden": Kiểm tra chữ/phần tử KHÔNG CÒN XUẤT HIỆN hoặc đã biến mất ("value": chữ không được hiển thị, có thể kèm "targetId"/"containerAnchor").
     + "assertUrl": Kiểm tra URL trang hiện tại chứa/khớp đường dẫn ("value": "/dashboard" hoặc "/users/1"). Dùng "assertUrlNot" nếu kiểm tra đã rời khỏi URL đó.
     + "assertState": Kiểm tra trạng thái phần tử "targetId" ("state": "visible"|"hidden"|"enabled"|"disabled"|"checked"|"unchecked").
     + "assertValue": Kiểm tra giá trị thực bên trong ô input/select/Shadow DOM "targetId" ("value": chuỗi kỳ vọng, hoặc "nonEmpty": true để kiểm tra đã sinh mã/khác rỗng, hoặc "empty": true để kiểm tra đã xóa trắng).
     + "assertCount": Kiểm tra số lượng dòng bảng / thẻ chip / mục đang hiển thị ("selector": vd "tbody tr" hoặc "targetId", "op": ">="|"=="|">"|"<=", "count": 1, tùy chọn "text" để lọc).
     + "assertDownload": Kiểm tra tệp tải về khớp tên/đuôi ("value": ".pdf") và dung lượng > 0 bytes ("minBytes": 1).
     + "assertCompare": Đối chiếu số học/tiền tệ/biến ("targetId" hoặc "left", "op": "=="|"!="|">"|">="|"<"|"<=", "expected": "58.500.000đ" hoặc "{{LAST_EXTRACTED}}").
     + "assertVerdict": CHỈ dùng khi yêu cầu kiểm tra ngữ nghĩa phức tạp không diễn đạt được bằng 8 lệnh trên. BẮT BUỘC truyền đầy đủ: "passed": true|false, "expected": "...", "actual": "...", "evidence": "...". Nếu điều kiện KHÔNG đạt trên màn hình, BẮT BUỘC trả "passed": false (tuyệt đối không chấm đậu giả!).
6. QUY TẮC TRỌNG TÀI NGHIÊM NGẶT CHO BƯỚC KIỂM TRA (ASSERT): Với mọi bước kiểm tra/xác nhận ("Kiểm tra...", "Xác nhận..."), TUYỆT ĐỐI KHÔNG được trả về "actions": [], "isStepComplete": true! Luôn phải gọi ít nhất 1 lệnh kiểm chứng (assert / assertHidden / assertUrl / assertState / assertValue / assertCount / assertDownload / assertCompare / assertVerdict).
7. BẮT BUỘC JSON hợp lệ: escape dấu ngoặc kép (\\") hoặc dùng dấu nháy đơn (') bên trong giá trị chuỗi (đặc biệt trong "thought"), không xuống dòng thô trong chuỗi JSON.

ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (CHỈ TRẢ VỀ ĐÚNG 1 KHỐI JSON HỢP LỆ, KHÔNG GIẢI THÍCH THÊM):
{
  "thought": "Suy luận ngắn gọn 1 câu",
  "actions": [
    { "action": "fill|click|select|assert|assertUrl|assertCount|assertValue|assertState|assertVerdict|extract|...", "targetId": 1, "value": "...", "varName": "..." }
  ],
  "isStepComplete": true
}`;

export class MicroAgentRunnerService {
  constructor(
    customConfig = config,
    storage = storageService,
    lifecycle = browserLifecycleService,
    inspector = domInspectorService,
    actions = atomicActionsService,
    cache = stepCacheService,
    llm = llmService
  ) {
    this.config = customConfig;
    this.storage = storage;
    this.lifecycle = lifecycle;
    this.inspector = inspector;
    this.actions = actions;
    this.cache = cache;
    this.llm = llm;
    this._liveState = null;
  }

  /**
   * Trả về bản sao an toàn trạng thái thực thi thời gian thực cho FE polling (GET /run/live)
   */
  getLiveStatus() {
    if (!this._liveState) return null;
    return {
      ...this._liveState,
      steps: this._liveState.steps.map((s) => ({
        ...s,
        screenshots: Array.isArray(s.screenshots) ? [...s.screenshots] : [],
      })),
    };
  }

  async destroyAll() {
    return await this.lifecycle.destroyAll();
  }

  /**
   * Trích xuất JSON an toàn từ đầu ra của mô hình LLM (hỗ trợ cả Qwen có thẻ <think> và tự phục hồi ký tự điều khiển)
   */
  parseAgentJson(rawText) {
    let clean = String(rawText || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
    if (clean.includes("<think>")) {
      clean = clean.replace(/<think>[\s\S]*?(?=\{|$)/gi, "");
    }
    clean = clean.replace(/```(?:json)?/gi, "").trim();

    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      throw new Error(`LLM không trả về đối tượng JSON hợp lệ: ${clean.slice(0, 150)}`);
    }

    const jsonSlice = clean.slice(firstBrace, lastBrace + 1).replace(/,\s*([}\]])/g, "$1");
    let parsed;
    try {
      parsed = JSON.parse(jsonSlice);
    } catch {
      // Thử thoát các ký tự xuống dòng/tab thô nằm bên trong chuỗi JSON trước khi báo lỗi
      const escapedControls = jsonSlice.replace(/"((?:[^"\\]|\\.)*)"/g, (_, inner) =>
        `"${inner.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`
      );
      parsed = JSON.parse(escapedControls);
    }
    return {
      thought: parsed.thought || "",
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      isStepComplete: parsed.isStepComplete !== false,
    };
  }

  /**
   * Đợi trang mới mở đạt domcontentloaded ngắn hạn để tránh quét DOM trắng
   */
  async _awaitPageReady(page, maxWaitMs = 1500) {
    if (!page || page.isClosed?.()) return;
    const pendingReady = page._autotestReadyPromise;
    if (pendingReady) {
      let timer = null;
      await Promise.race([
        pendingReady,
        new Promise((resolve) => {
          timer = setTimeout(resolve, maxWaitMs);
        }),
      ]).catch(() => { });
      if (timer) clearTimeout(timer);
      if (page._autotestReadyPromise === pendingReady) {
        page._autotestReadyPromise = null;
      }
    }
  }

  /**
   * Chỉ phân tích cấu hình xử lý native dialog từ đúng câu lệnh của BƯỚC HIỆN TẠI (không nhìn trộm bước kế tiếp)
   */
  _resolveStepDialogConfig(stepText, vars = {}) {
    const text = String(stepText || "");
    const dismissPattern =
      /(?:bấm\s+(?:nút\s+)?['"“]?(?:hủy|hủy bỏ|không đồng ý|từ chối|cancel|dismiss)|từ\s+chối\s+(?:hộp\s+thoại|xác\s+nhận)|(?:cancel|dismiss)\s+dialog)/i;
    const decision = dismissPattern.test(text) ? "dismiss" : "accept";

    let promptText = undefined;
    if (/(?:prompt|hộp\s+thoại|cửa\s+sổ\s+nhập)/i.test(text)) {
      const m = text.match(/(?:nhập|điền|gõ|trả\s+lời|type|enter)\s+['"“]([^'"”]+)['"”]/i);
      if (m && m[1] !== undefined) {
        promptText = this.actions.resolveVars(m[1], vars);
      }
    }

    return { decision, promptText };
  }

  /**
   * Gắn đầy đủ listener dialog/download và close failover cho cả Tab gốc và mọi Tab mới mở
   */
  _attachPageLifecycle(page, context, session, label = "tab") {
    this.attachPageListeners(page, session);
    if (!page || page._autotestCloseAttached) return;
    page._autotestCloseAttached = true;

    page.on("close", () => {
      const remaining = context.pages().filter((p) => p && !p.isClosed());
      session.pagesCount = remaining.length;
      if (remaining.length > 0 && (!session.currentPage || session.currentPage === page || session.currentPage.isClosed?.())) {
        session.currentPage = remaining[remaining.length - 1];
        logger.info(`[Multi-Tab] ${label} đã đóng. Chuyển an toàn về Tab còn lại [${remaining.length}/${remaining.length}].`);
      } else if (remaining.length === 0) {
        session.currentPage = null;
      }
    });
  }

  /**
   * Gắn bộ lắng nghe sự kiện trình duyệt gốc (Native Playwright Events) lên Page
   * Không bao giờ bị treo bởi window.alert / confirm / prompt!
   */
  attachPageListeners(page, session) {
    if (!page) return;
    // 0. Gắn bộ thu thập viễn thám mạng/lỗi (PageTelemetryService - idempotent) phục vụ Chẩn đoán Nhân quả Tầng 1
    pageTelemetryService.attach(page, session);
    if (page._autotestListenersAttached) return;
    page._autotestListenersAttached = true;

    // 1. Bắt mọi hộp thoại native (alert / confirm / prompt) trong 0.01 giây
    page.on("dialog", async (dialog) => {
      const dlgType = dialog.type();
      const dlgMsg = dialog.message();
      const decision = session?.nextDialogDecision === "dismiss" ? "dismiss" : "accept";
      const rawPrompt = session?.nextDialogPromptText;

      logger.info(
        `[Native Dialog] Bắt được [${dlgType.toUpperCase()}]: "${dlgMsg}" -> Tự động xử lý: ${decision.toUpperCase()}${dlgType === "prompt" && rawPrompt !== undefined && decision === "accept" ? ` (promptText: "${rawPrompt}")` : ""}`
      );

      const entry = {
        type: dlgType,
        message: dlgMsg,
        handledAs: decision,
        promptText: dlgType === "prompt" && decision === "accept" && rawPrompt !== undefined ? String(rawPrompt) : undefined,
        stepIndex: session?.currentStepIndex || 0,
        timestamp: Date.now(),
      };
      if (Array.isArray(session?.dialogHistory)) {
        session.dialogHistory.push(entry);
      }
      if (Array.isArray(session?.currentStepDialogs)) {
        session.currentStepDialogs.push(entry);
      }

      if (session?.currentRunningStep) {
        session.currentRunningStep.detectedAlert = dlgMsg;
      }

      try {
        if (decision === "dismiss") {
          await dialog.dismiss();
        } else if (dlgType === "prompt" && rawPrompt !== undefined) {
          await dialog.accept(String(rawPrompt));
        } else {
          await dialog.accept();
        }
      } catch (dlgErr) {
        logger.debug("Bỏ qua lỗi đóng dialog:", dlgErr.message);
      } finally {
        // Khôi phục mặc định là accept sau khi đã xử lý
        if (session) {
          session.nextDialogDecision = "accept";
          session.nextDialogPromptText = undefined;
        }
      }
    });

    // 2. Bắt sự kiện tải tệp xuống (Download)
    page.on("download", async (download) => {
      try {
        const savedInfo = await this.storage.saveDownloadedFile(download);
        const entry = {
          ...savedInfo,
          stepIndex: session?.currentStepIndex || 0,
        };
        logger.info(`[Native Download] Đã lưu tệp tải về: "${savedInfo.filename}"`);
        if (Array.isArray(session?.downloadedFiles)) {
          session.downloadedFiles.push(entry);
        }
        if (Array.isArray(session?.currentStepDownloads)) {
          session.currentStepDownloads.push(entry);
        }
      } catch (dlErr) {
        logger.debug("Bỏ qua lỗi lưu download:", dlErr.message);
      }
    });
  }

  /**
   * Kiểm tra xem bước kiểm thử có thể chạy qua Đường Tắt Tất Định (0 gọi AI) ngay lập tức không
   */
  tryBuildFastPathAction(stepObj) {
    const text = String(stepObj.text || "").trim();
    if (!text) return null;

    // Không dùng Fast-Path nếu là câu ghép nhiều việc phức tạp
    const hasCompoundConjunction = /\s+(?:và bấm|rồi bấm|sau đó|tiếp theo|đồng thời)\s+/i.test(text);

    // 1. Bước mở trang URL đơn thuần
    if (
      !hasCompoundConjunction &&
      (stepObj.type === "goto" || /^(?:vào trang|mở trang|truy cập trang|truy cập|vào địa chỉ|mở địa chỉ|go to|open)\s+/i.test(text))
    ) {
      const cleaned = text
        .replace(/^(?:vào trang|mở trang|truy cập trang|truy cập|vào địa chỉ|mở địa chỉ|go to|open)\s+/i, "")
        .trim()
        .replace(/[.。,;]+$/, "");
      if (
        /^(?:https?:\/\/|localhost|\[\:\:1\]|\d+\.\d+\.\d+\.\d+|[a-z0-9-]+(?::\d+|(?:\.[a-z0-9-]+)+))/i.test(cleaned) &&
        !cleaned.includes(" ")
      ) {
        return [{ action: "navigate", value: toUrl(cleaned) }];
      }
    }

    // 2. Bước chờ thời gian đơn thuần
    if (!hasCompoundConjunction && (stepObj.type === "wait" || /^(?:chờ|đợi|tạm dừng|wait|sleep)\s+\d+/i.test(text))) {
      const m = text.match(/(\d+(?:\.\d+)?)/);
      if (m) {
        const num = parseFloat(m[1]);
        const ms = /(?:ms|mili)/i.test(text) ? num : num * 1000;
        return [{ action: "wait", value: String(Math.min(Math.max(ms, 100), 30000)) }];
      }
    }

    // 3. Bước kiểm tra URL đơn thuần (0 gọi AI)
    if (
      !hasCompoundConjunction &&
      /^(?:kiểm tra|xác nhận|xác minh|đảm bảo)/i.test(text) &&
      /\b(?:url|đường dẫn|địa chỉ trang)\b/i.test(text)
    ) {
      const quotes = [...text.matchAll(/['"“]([^'"”]+)['"”]/g)].map((m) => m[1].trim()).filter(Boolean);
      if (quotes.length === 1) {
        const isNegUrl = /(?:không\s+(?:còn\s+)?(?:chứa|ở|khớp|là)|rời\s+khỏi|khác)/i.test(text);
        return [{ action: isNegUrl ? "assertUrlNot" : "assertUrl", value: quotes[0] }];
      }
    }

    // 3b. Bước kiểm tra tệp tải về đơn thuần (0 gọi AI)
    if (
      !hasCompoundConjunction &&
      /^(?:kiểm tra|xác nhận|xác minh|đảm bảo)/i.test(text) &&
      /(?:tải về|tải xuống|download)/i.test(text)
    ) {
      const quotes = [...text.matchAll(/['"“]([^'"”]+)['"”]/g)].map((m) => m[1].trim()).filter(Boolean);
      const extMatch = text.match(/\b(pdf|xlsx|xls|csv|docx|zip|png|jpg)\b/i);
      const expectedFile = quotes[0] || (extMatch ? `.${extMatch[1].toLowerCase()}` : "");
      return [{ action: "assertDownload", value: expectedFile, minBytes: 1 }];
    }

    // 3c. Bước kiểm tra chữ đơn thuần trên toàn trang (KHÔNG dùng đường tắt toàn trang nếu câu yêu cầu kiểm tra cục bộ trong 1 ô/dòng/giỏ hàng cụ thể!)
    const hasNarrowScopeCue =
      /(?:trong\s+(?:ô|dòng|cột|bảng|mục|thẻ|khung)|ở\s+(?:dòng|cột|ô|góc)|của\s+(?:sản phẩm|đơn hàng|dòng|mục|khách hàng)|số lượng\s+giỏ hàng|trạng thái\s+(?:nút|ô|checkbox)|bị\s+(?:vô hiệu hóa|khóa|disable)|ít nhất\s+\d+\s+dòng)/i.test(
        text
      );
    if (
      !hasCompoundConjunction &&
      !hasNarrowScopeCue &&
      /^(?:kiểm tra|xác nhận|xác minh|đảm bảo|chờ và kiểm tra)/i.test(text) &&
      !/tải về|download|bằng tổng|trừ đi|\burl\b|đường dẫn/i.test(text)
    ) {
      const quotes = [...text.matchAll(/['"“]([^'"”]+)['"”]/g)].map((m) => m[1].trim()).filter(Boolean);
      if (quotes.length === 1) {
        const isNegativeAssert =
          /(?:không\s+(?:còn\s+)?(?:xuất hiện|hiển thị|tồn tại|thấy|có)|biến mất|đã\s+bị\s+xóa|bị\s+xóa|ẩn\s+đi|disappear|not\s+exist|not\s+visible|hidden)/i.test(
            text
          );
        if (isNegativeAssert) {
          return [{ action: "assertHidden", assertType: "hidden", value: quotes[0] }];
        }
        return [{ action: "assert", assertType: "visible", value: quotes[0] }];
      }
    }

    // 4. Bước chuyển tab hoặc đóng tab đơn thuần
    if (!hasCompoundConjunction) {
      if (/^(?:chuyển\s+(?:về|sang|lại)\s+tab\s+(?:đầu|gốc|trước|1)|về\s+tab\s+đầu|switch\s+to\s+first\s+tab)/i.test(text)) {
        return [{ action: "switchTab", value: "first" }];
      }
      if (/^(?:chuyển\s+(?:sang|về|lại)\s+tab\s+(?:mới|sau|cuối|mới\s+nhất)|sang\s+tab\s+mới|switch\s+to\s+latest\s+tab|switch\s+to\s+new\s+tab)/i.test(text)) {
        return [{ action: "switchTab", value: "latest" }];
      }
      if (/^(?:đóng\s+tab\s+(?:hiện\s+tại|này)?|close\s+tab)/i.test(text)) {
        return [{ action: "switchTab", value: "close" }];
      }
    }

    // 5. Bước bấm ra ngoài vùng trống (clickOutside) hoặc nhấn phím toàn cục (Escape / Enter / Tab) đơn thuần
    if (!hasCompoundConjunction) {
      if (
        /^(?:bấm|nhấn|click)\s+(?:chuột\s+)?(?:ra\s+ngoài(?:\s+(?:vùng\s+trống|khoảng\s+trống|màn\s+hình|dropdown|bảng|menu))?|vào\s+(?:vùng\s+trống|khoảng\s+trống|nền\s+trống)|outside|blank)/i.test(
          text
        )
      ) {
        return [{ action: "clickOutside" }];
      }
      const keyMatch = text.match(
        /^(?:nhấn|bấm|gõ|press)\s+(?:phím\s+)?['"“]?(escape|esc|enter|tab)['"”]?$/i
      );
      if (keyMatch) {
        const rawKey = keyMatch[1].toLowerCase();
        const normalizedKey = rawKey === "esc" || rawKey === "escape" ? "Escape" : rawKey === "tab" ? "Tab" : "Enter";
        return [{ action: "pressKey", value: normalizedKey }];
      }
    }

    return null;
  }

  /**
   * Thực thi danh sách các bước kiểm thử với Kiến trúc Mới:
   * [Phát lại Băng ghi Cache] -> [Fast-Path Tất định] -> [Vòng lặp Vi mô ReAct với Qwen-27B / LLM]
   */
  async runSteps(steps, variables, result, signal = null, hooks = {}) {
    let browser = null;
    let context = null;
    let inactivityTimer = null;
    let maxRunTimer = null;
    let aborted = false;
    let runTimedOut = false;
    let rejectAbort = null;
    const timeoutController = new AbortController();
    const effectiveSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    const persistSession = Boolean(hooks?.persistSession);
    const storageStatePath =
      hooks?.storageStatePath ||
      (persistSession && result?.projectId ? this.storage.getProjectSessionPath(result.projectId) : null);

    const configuredRunMs = Number(this.config?.timeouts?.runMs) || 300_000;
    const stepMsBudget = Math.max(500, Number(this.config?.timeouts?.stepMs) || 60_000);
    const totalStepsCount = Math.max(1, Array.isArray(steps) ? steps.length : 1);
    const inactivityTimeoutMs = Math.max(configuredRunMs, Math.round(stepMsBudget * 1.5));
    const maxRunCeilingMs = Math.min(
      60 * 60 * 1000,
      Math.max(configuredRunMs, totalStepsCount * (stepMsBudget + 15_000) + 120_000)
    );
    let rejectRunTimeout = null;

    const triggerRunTimeout = (reason) => {
      if (aborted || runTimedOut) return;
      runTimedOut = true;
      const err = new Error(reason);
      err.name = "TimeoutError";
      timeoutController.abort(err);
      this.lifecycle.closeInstances(context, browser).catch(() => { });
      if (rejectRunTimeout) {
        rejectRunTimeout(err);
      }
    };

    const refreshRunWatchdog = (customMs = inactivityTimeoutMs) => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        triggerRunTimeout(
          `Không có tiến triển mới trong ${Math.round(customMs / 1000)}s (Inactivity Watchdog)`
        );
      }, customMs);
      if (typeof hooks?.onActivity === "function") {
        try {
          hooks.onActivity();
        } catch { }
      }
    };

    const markAbortedResult = (reason = "Phiên kiểm thử đã bị hủy") => {
      if (runTimedOut && !aborted) {
        const timeoutReason = timeoutController.signal.reason?.message || reason;
        result.status = "failed";
        result.failureType = result.failureType || FAILURE_TYPES.TIMEOUT;
        result.error = result.error || timeoutReason;
        if (Array.isArray(result.steps)) {
          for (const st of result.steps) {
            if (st && st.status === "running") {
              st.status = "failed";
              st.failureType = FAILURE_TYPES.TIMEOUT;
              st.message = st.message || timeoutReason;
            }
          }
        }
        return;
      }
      result.status = "failed";
      result.failureType = "CANCELLED";
      result.error = result.error || reason;
      if (Array.isArray(result.steps)) {
        for (const st of result.steps) {
          if (st && st.status === "running") {
            st.status = "failed";
            st.failureType = "CANCELLED";
            st.message = reason;
          }
        }
      }
    };

    const abortPromise = new Promise((_, reject) => {
      rejectAbort = reject;
    });

    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      logger.warn("Nhận tín hiệu Abort: Đang đóng trình duyệt ngay lập tức...");
      markAbortedResult("Phiên kiểm thử đã bị hủy");
      this.lifecycle.closeInstances(context, browser).catch(() => { });
      if (rejectAbort) {
        rejectAbort(new Error("Phiên kiểm thử đã bị hủy"));
      }
    };

    if (signal) {
      if (signal.aborted) {
        markAbortedResult("Phiên kiểm thử đã bị hủy");
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const runWorker = async () => {
      const launched = await this.lifecycle.launch(this.config, {
        storageStatePath,
        persistSession,
      });
      browser = launched.browser;
      context = launched.context;
      const initialPage = launched.page;

      if (aborted || effectiveSignal.aborted) {
        markAbortedResult();
        await this.lifecycle.closeInstances(context, browser);
        return;
      }

      await this.lifecycle.setupCleanSession(context, initialPage, { persistSession });
      // Sau khi khởi động trình duyệt xong, kích hoạt đồng hồ Inactivity chuẩn theo nhịp bước
      refreshRunWatchdog();

      const session = {
        browser,
        context,
        currentPage: initialPage,
        vars: { ...(variables || {}) },
        secretKeys: new Set(Array.isArray(hooks?.secretKeys) ? hooks.secretKeys : []),
        dialogHistory: [],
        downloadedFiles: [],
        currentStepDialogs: [],
        prevStepDialogs: [],
        currentStepDownloads: [],
        prevStepDownloads: [],
        currentStepIndex: 0,
        nextDialogDecision: "accept",
        nextDialogPromptText: undefined,
        pendingDialog: null,
        pagesCount: 1,
        currentRunningStep: null,
        tookBeforeShotInCurrentStep: false,
        telemetry: pageTelemetryService.createSessionState(),
      };

      this._attachPageLifecycle(initialPage, context, session, "Tab gốc");

      // Tự động theo dõi mở Tab mới (Multi-Tab) và đóng Tab phụ
      context.on("page", (newPage) => {
        logger.info(`[Multi-Tab] Phát hiện mở Tab mới. Chuyển ngữ cảnh tương tác sang Tab mới.`);
        this._attachPageLifecycle(newPage, context, session, "Tab phụ");
        newPage._autotestReadyPromise = newPage
          .waitForLoadState("domcontentloaded", { timeout: 2500 })
          .catch(() => { });
        session.currentPage = newPage;
        session.pagesCount = context.pages().filter((p) => p && !p.isClosed()).length;
      });

      const runId = result.id || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      result.id = runId;
      const runScreenshotsDir = await this.storage.getRunScreenshotsDir(runId);

      this._liveState = {
        runId,
        batchId: hooks?.batchId || result.batchId || null,
        projectId: result.projectId || "default",
        projectName: result.projectName || "Dự án kiểm thử",
        featureId: result.featureId || null,
        featureName: result.featureName || "",
        featureIndex: typeof hooks?.featureIndex === "number" ? hooks.featureIndex : null,
        startedAt: result.startedAt || new Date().toISOString(),
        totalSteps: steps.length,
        currentStepIndex: 0,
        currentStepText: "",
        currentLayer: "preparing",
        currentTurn: 0,
        maxTurns: 8,
        currentThought: "",
        steps: result.steps,
      };

      let hasSoftFailure = false;

      for (const [i, s] of steps.entries()) {
        if (aborted || effectiveSignal.aborted) {
          markAbortedResult();
          return;
        }

        const stepText = String(s.text || "").trim();
        const isSoftStep = Boolean(s.isSoft || s.optional || /\[soft\]|\[tùy chọn\]|\[optional\]/i.test(stepText));
        let shotSeq = 0;

        const step = {
          index: i + 1,
          type: s.type || "act",
          text: stepText,
          isSoft: isSoftStep,
          status: "running",
          executionMode: null,
          message: "",
          actionsLog: [],
          durationMs: 0,
          screenshots: [],
        };
        result.steps.push(step);
        session.currentRunningStep = step;
        session.tookBeforeShotInCurrentStep = false;
        session.currentStepIndex = i + 1;
        session.prevStepDialogs = session.currentStepDialogs;
        session.currentStepDialogs = [];
        session.prevStepDownloads = session.currentStepDownloads;
        session.currentStepDownloads = [];

        if (this._liveState) {
          this._liveState.currentStepIndex = i + 1;
          this._liveState.currentStepText = stepText;
          this._liveState.currentLayer = "starting";
          this._liveState.currentTurn = 0;
          this._liveState.currentThought = "";
        }

        // Chỉ phân tích xử lý native dialog / promptText từ đúng câu lệnh của BƯỚC HIỆN TẠI (không nhìn trộm bước kế tiếp)
        const stepDialogCfg = this._resolveStepDialogConfig(stepText, session.vars);
        session.nextDialogDecision = stepDialogCfg.decision;
        session.nextDialogPromptText = stepDialogCfg.promptText;

        const takeShot = async (suffix, meta = {}) => {
          await this._awaitPageReady(session.currentPage);
          const shot = await takeScreenshot(
            session.currentPage,
            runScreenshotsDir,
            runId,
            i + 1,
            suffix,
            { ...meta, shotIndex: ++shotSeq },
            this.config
          );
          if (shot) {
            step.screenshots.push(shot);
            step.screenshotUrl = shot.url;
          }
          return shot;
        };

        const t0 = Date.now();
        const stepTimeoutController = new AbortController();
        const stepSignal = AbortSignal.any([effectiveSignal, stepTimeoutController.signal]);
        let stepTimeoutTimer = null;
        let stepTimedOut = false;

        const assertNotInterrupted = () => {
          if (stepTimedOut || (stepTimeoutController.signal.aborted && !aborted && !effectiveSignal.aborted)) {
            const tErr = new Error(
              `Bước ${i + 1} vượt quá thời gian cho phép (${Math.round(stepMsBudget / 1000)}s)`
            );
            tErr.name = "StepTimeoutError";
            throw tErr;
          }
          if (aborted || effectiveSignal.aborted) {
            throw new Error("Phiên kiểm thử đã bị hủy");
          }
        };

        try {
          const strictnessMode = normalizeStrictnessMode(
            hooks?.diagnosticStrictness || this.config?.diagnostics?.strictness,
            DIAGNOSTIC_STRICTNESS.BALANCED
          );
          const isAssertStep =
            step.type === "assert" ||
            step.type === "observe" ||
            inferDisplayStepType(stepText) === "assert";
          const allowHttpErrorOnStep =
            /(?:404|403|500|502|503|không tồn tại|not found|forbidden|trang lỗi|error page)/i.test(stepText) ||
            steps.slice(i + 1).some((ns) => /(?:404|403|500|not found|forbidden|trang lỗi)/i.test(ns?.text || ""));

          const runSingleStep = async () => {
            await this._awaitPageReady(session.currentPage);
            let executedSuccessfully = false;
            let pendingCacheActions = null;
            const stepMessages = [];
            const executedActionKinds = new Set();
            let hasExecutedAssertionInStep = false;
            let stepStartPage = session.currentPage;
            let stepStartUrl = session.currentPage?.url?.() || "";
            const stepStartRoute = extractRoutePath(stepStartUrl);

            // Tầng 1 + Tầng 2 Chẩn đoán Nhân quả: tạo cursor mạng và chụp baseline thông báo CŨ trước khi thao tác
            const stepTelemetryCursor = pageTelemetryService.createCursor(session);
            let diagBaseline = await captureUiDiagnosticBaseline(session.currentPage);
            let didSubmit = false;
            let isFormSubmit = false;
            let didNavigateCommand = false;
            const submittedFormKeys = new Set();

            const resetActionTracking = () => {
              stepMessages.length = 0;
              step.actionsLog.length = 0;
              executedActionKinds.clear();
              hasExecutedAssertionInStep = false;
              step.evidence = null;
              didSubmit = false;
              isFormSubmit = false;
              didNavigateCommand = false;
              submittedFormKeys.clear();
            };

            const prepareActionPayload = (actObj, actKind) => {
              if ((actKind === "navigate" || actKind === "goto") && allowHttpErrorOnStep) {
                return { ...actObj, allowHttpError: true };
              }
              return actObj;
            };

            const recordActionTelemetry = async (actKind, actRes) => {
              executedActionKinds.add(actKind);
              if (ASSERT_ACTION_KINDS.has(actKind)) {
                hasExecutedAssertionInStep = true;
                step.isAssertionStep = true;
              }
              if (actRes?.evidence) {
                // Ưu tiên lưu bằng chứng của Assertion hơn hành động cơ học trung gian
                if (!step.evidence || ASSERT_ACTION_KINDS.has(actKind)) {
                  step.evidence = actRes.evidence;
                }
              }
              if (actKind === "navigate" || actKind === "goto") {
                session.tookBeforeShotInCurrentStep = false;
                didNavigateCommand = true;
                // Cập nhật baseline sau khi tải trang đích để hỗ trợ cả bước đơn lẫn câu ghép (mở trang + đăng nhập)
                stepStartPage = session.currentPage;
                stepStartUrl = session.currentPage?.url?.() || "";
                diagBaseline = await captureUiDiagnosticBaseline(session.currentPage);
              } else if (actKind === "click" || actKind === "presskey" || actKind === "press" || actKind === "key") {
                // Nếu đã thao tác tương tác sau khi navigate trong cùng câu ghép, tắt cờ thuần điều hướng
                didNavigateCommand = false;
              }
              if (actRes?.actionMeta?.isSubmitAction) {
                didSubmit = true;
              }
              if (actRes?.actionMeta?.isFormSubmit) {
                isFormSubmit = true;
              }
              if (actRes?.actionMeta?.formKey) {
                submittedFormKeys.add(actRes.actionMeta.formKey);
              }
              if (actRes?.extractedValue) {
                step.value = actRes.extractedValue;
              }
              if (actRes?.uxWarning) {
                if (!Array.isArray(step.uxWarnings)) step.uxWarnings = [];
                if (!step.uxWarnings.includes(actRes.uxWarning)) {
                  step.uxWarnings.push(actRes.uxWarning);
                }
              }
            };

            // =========================================================================
            // TẦNG 1: PHÁT LẠI TỪ BĂNG GHI CACHE (0 GỌI AI - TỐC ĐỘ ~0.05s)
            // =========================================================================
            const cachedTrace = await this.cache.getTrace(
              stepText,
              result.projectId,
              result.featureId,
              stepStartRoute
            );
            if (cachedTrace && cachedTrace.length > 0) {
              try {
                if (this._liveState) {
                  this._liveState.currentLayer = "cache";
                  this._liveState.currentThought = "Đang phát lại từ Băng ghi Cache (0 gọi AI)...";
                }
                logger.info(`Bước ${i + 1}: Đang phát lại từ Băng ghi Cache (${cachedTrace.length} thao tác)...`);
                for (const recAct of cachedTrace) {
                  assertNotInterrupted();
                  const actKind = String(recAct.action || recAct.type || "click").toLowerCase().trim();
                  const actRes = await this.actions.executeAction(
                    prepareActionPayload(recAct, actKind),
                    session,
                    null,
                    takeShot
                  );
                  await this._awaitPageReady(session.currentPage);
                  stepMessages.push(actRes.message);
                  step.actionsLog.push(actRes.message);
                  await recordActionTelemetry(actKind, actRes);
                }
                executedSuccessfully = true;
                step.executionMode = "cache";
                step.status = "passed";
                step.message = `${stepMessages.join(" → ")} ⚡`;
              } catch (cacheErr) {
                if (
                  aborted ||
                  stepSignal.aborted ||
                  cacheErr?.failureType === FAILURE_TYPES.HTTP_ERROR ||
                  cacheErr?.failureType === FAILURE_TYPES.ASSERTION_FAILED
                ) {
                  throw cacheErr;
                }
                logger.warn(
                  `Bước ${i + 1}: Băng ghi Cache không còn khớp (${cacheErr.message.slice(0, 120)}). Chuyển sang Vòng lặp Vi mô AI tự chữa lành...`
                );
                resetActionTracking();
                await this.cache.invalidateTrace(
                  stepText,
                  result.projectId,
                  result.featureId,
                  cachedTrace._cacheMeta?.routePath ?? stepStartRoute,
                  cachedTrace._cacheMeta?.cacheKey || ""
                );
              }
            }

            // =========================================================================
            // TẦNG 2: ĐƯỜNG TẮT TẤT ĐỊNH CHO CÁC LỆNH ĐƠN GIẢN (0 GỌI AI)
            // =========================================================================
            if (!executedSuccessfully) {
              const fastActions = this.tryBuildFastPathAction(s);
              if (fastActions && fastActions.length > 0) {
                try {
                  if (this._liveState) {
                    this._liveState.currentLayer = "fastpath";
                    this._liveState.currentThought = "Thực thi nhanh tất định (0 gọi AI)...";
                  }
                  const recordedForCache = [];
                  for (const fa of fastActions) {
                    assertNotInterrupted();
                    const actKind = String(fa.action || fa.type || "click").toLowerCase().trim();
                    const actRes = await this.actions.executeAction(
                      prepareActionPayload(fa, actKind),
                      session,
                      null,
                      takeShot
                    );
                    await this._awaitPageReady(session.currentPage);
                    stepMessages.push(actRes.message);
                    step.actionsLog.push(actRes.message);
                    await recordActionTelemetry(actKind, actRes);
                    if (actRes.recordedAction) recordedForCache.push(actRes.recordedAction);
                  }
                  executedSuccessfully = true;
                  step.executionMode = "fastpath";
                  step.status = "passed";
                  step.message = stepMessages.join(" → ");
                  if (recordedForCache.length > 0) {
                    pendingCacheActions = recordedForCache;
                  }
                } catch (fastErr) {
                  const isNavTimeout =
                    fastActions.some((fa) => fa.action === "navigate" || fa.action === "goto") &&
                    (fastErr?.name === "TimeoutError" || /Timeout/i.test(fastErr?.message || ""));
                  const isHttpFail = fastErr?.failureType === FAILURE_TYPES.HTTP_ERROR;
                  const isAssertionFail =
                    fastErr?.failureType === FAILURE_TYPES.ASSERTION_FAILED ||
                    fastActions.some((fa) =>
                      ASSERT_ACTION_KINDS.has(String(fa.action || fa.type || "").toLowerCase().trim())
                    );
                  if (aborted || stepSignal.aborted || isNavTimeout || isHttpFail || isAssertionFail) throw fastErr;
                  logger.debug(`Bước ${i + 1}: Đường tắt tất định không khớp (${fastErr.message}), chuyển sang AI...`);
                  resetActionTracking();
                }
              }
            }

            // =========================================================================
            // TẦNG 3: VÒNG LẶP TÁC TỬ VI MÔ (BOUNDED MICRO-REACT LOOP VỚI QWEN-27B / LLM)
            // =========================================================================
            if (!executedSuccessfully) {
              const maxMicroTurns = 8;
              const recordedForCache = [];
              const executedTurnsHistory = [];
              const actionRepeatCounts = new Map();
              let llmConfirmedComplete = false;
              if (this._liveState) {
                this._liveState.currentLayer = "ai";
                this._liveState.maxTurns = maxMicroTurns;
              }

              const getActionSig = (act) =>
                `${act.action || ""}:${act.targetId ?? ""}:${String(act.value ?? "").slice(0, 60)}`;

              for (let turn = 1; turn <= maxMicroTurns; turn++) {
                assertNotInterrupted();
                refreshRunWatchdog();

                if (this._liveState) {
                  this._liveState.currentTurn = turn;
                  this._liveState.currentThought = `Đang quan sát DOM & hỏi AI (Nhịp ${turn}/${maxMicroTurns})...`;
                }

                await this._awaitPageReady(session.currentPage);

                // 3.1 Quét trạng thái màn hình hiện tại (Trang chính + Iframes + Hộp thoại + Kho Biến)
                const snapshot = await this.inspector.inspect(session.currentPage, session);
                const formattedSnapshot = this.inspector.formatSnapshotForLlm(snapshot, session);

                const userPromptLines = [
                  `YÊU CẦU CỦA BƯỚC HIỆN TẠI (Bước ${i + 1}/${steps.length}): "${stepText}"`,
                ];
                if (executedTurnsHistory.length > 0) {
                  userPromptLines.push(
                    `\nCÁC NHỊP ĐÃ THỰC HIỆN TRONG BƯỚC NÀY:\n${executedTurnsHistory.map((h, idx) => `  ${idx + 1}. ${h}`).join("\n")}`
                  );
                  const repeatedSigs = [...actionRepeatCounts.entries()]
                    .filter(([, count]) => count >= 2)
                    .map(([sig, count]) => `${sig} (${count} lần)`);
                  if (repeatedSigs.length > 0) {
                    userPromptLines.push(
                      `\n⚠️ CẢNH BÁO CHỐNG LẶP VÔ HẠN: Thao tác [${repeatedSigs.join(", ")}] đã lặp lại nhiều lần. KHÔNG lặp lại nữa! Hãy chọn phần tử khác phù hợp, hoặc trả về "actions": [], "isStepComplete": true nếu mục tiêu bước đã đạt/hiển thị sẵn trên màn hình.`
                    );
                  } else {
                    userPromptLines.push(
                      `Hãy nhìn TRẠNG THÁI TRÌNH DUYỆT HIỆN TẠI bên dưới để quyết định thao tác còn thiếu tiếp theo cho đến khi hoàn tất toàn bộ yêu cầu của bước!`
                    );
                  }
                }
                userPromptLines.push(`\n${formattedSnapshot}`);

                const messages = [
                  { role: "system", content: MICRO_AGENT_SYSTEM_PROMPT },
                  { role: "user", content: userPromptLines.join("\n") },
                ];

                logger.info(`Bước ${i + 1} [Nhịp ${turn}/${maxMicroTurns}]: Đang hỏi LLM cho "${stepText.slice(0, 60)}"...`);
                let rawLlmOutput = await this.llm.chatCompletion(messages, stepSignal);
                let decision;
                try {
                  decision = this.parseAgentJson(rawLlmOutput);
                } catch (parseErr) {
                  logger.warn(`Bước ${i + 1} [Nhịp ${turn}]: Lỗi parse JSON (${parseErr.message}), thử yêu cầu AI sửa JSON...`);
                  const repairMessages = [
                    ...messages,
                    { role: "assistant", content: String(rawLlmOutput || "").slice(0, 1500) },
                    {
                      role: "user",
                      content: `Phản hồi vừa rồi bị lỗi cú pháp JSON (${parseErr.message}). Hãy trả lại DUY NHẤT 1 đối tượng JSON hợp lệ (escape dấu ngoặc kép \\" bên trong chuỗi "thought", không xuống dòng thô trong chuỗi).`,
                    },
                  ];
                  rawLlmOutput = await this.llm.chatCompletion(repairMessages, stepSignal);
                  decision = this.parseAgentJson(rawLlmOutput);
                }

                if (this._liveState) {
                  this._liveState.currentThought = decision.thought || `Nhịp ${turn}: ${decision.actions.length} thao tác`;
                }

                logger.info(
                  `Bước ${i + 1} [Nhịp ${turn}]: AI quyết định ${decision.actions.length} thao tác (isStepComplete=${decision.isStepComplete}) - "${decision.thought}"`
                );

                if (decision.actions.length === 0 && decision.isStepComplete) {
                  // CỔNG CHỐNG AI TỰ CHẤM ĐẬU (Anti-Self-Pass Gate):
                  // Ở bước Kiểm tra (Assert), CẤM AI tự cho qua mà chưa gọi bất kỳ công cụ kiểm chứng nào!
                  if (isAssertStep && !hasExecutedAssertionInStep) {
                    logger.warn(
                      `Bước ${i + 1} [Nhịp ${turn}]: Từ chối AI tự chấm đậu (actions=[]) ở bước Kiểm tra "${stepText}" -> yêu cầu gọi công cụ kiểm chứng có bằng chứng.`
                    );
                    executedTurnsHistory.push(
                      `⚠️ TỪ CHỐI TỰ CHẤM ĐẬU: Đây là bước Kiểm tra (Assert). Bạn BẮT BUỘC phải gọi ít nhất 1 lệnh kiểm chứng (assert / assertHidden / assertUrl / assertState / assertValue / assertCount / assertDownload / assertCompare / assertVerdict kèm passed: true|false, expected, actual)!`
                    );
                    continue;
                  }
                  llmConfirmedComplete = true;
                  if (stepMessages.length === 0) {
                    stepMessages.push(decision.thought || "AI xác nhận yêu cầu bước đã thỏa mãn trên màn hình");
                  }
                  break;
                }

                if (decision.actions.length === 0 && !decision.isStepComplete) {
                  if (isAssertStep) {
                    const assertFailErr = new Error(
                      `Kiểm tra không đạt: ${decision.thought || `Không thỏa mãn điều kiện "${stepText}"`}`
                    );
                    assertFailErr.failureType = FAILURE_TYPES.ASSERTION_FAILED;
                    assertFailErr.isProductDefect = true;
                    assertFailErr.evidence = {
                      oracleSource: ORACLE_SOURCES.AI_JUDGE,
                      assertType: "verdict",
                      expected: stepText,
                      actual: decision.thought || "Không đạt điều kiện trên màn hình",
                      passed: false,
                    };
                    throw assertFailErr;
                  }
                  throw new Error(`Không tìm thấy phần tử phù hợp trên màn hình để thực hiện: "${stepText}"`);
                }

                const repeatedBlocked = decision.actions.filter(
                  (act) => act.action !== "wait" && (actionRepeatCounts.get(getActionSig(act)) || 0) >= 2
                );
                if (repeatedBlocked.length > 0 && repeatedBlocked.length === decision.actions.length) {
                  const sig = getActionSig(repeatedBlocked[0]);
                  throw new Error(
                    `AI lặp lại cùng thao tác "${sig}" quá 2 lần tại bước "${stepText}". Hãy viết rõ tên nút/nhãn mục tiêu cần thao tác.`
                  );
                }

                const shotsBeforeTurn = step.screenshots.length;
                for (const actItem of decision.actions) {
                  assertNotInterrupted();
                  const sig = getActionSig(actItem);
                  actionRepeatCounts.set(sig, (actionRepeatCounts.get(sig) || 0) + 1);
                  const actKind = String(actItem.action || actItem.type || "click").toLowerCase().trim();
                  const actRes = await this.actions.executeAction(
                    prepareActionPayload(actItem, actKind),
                    session,
                    snapshot.elementMap,
                    takeShot
                  );
                  await this._awaitPageReady(session.currentPage);
                  stepMessages.push(actRes.message);
                  step.actionsLog.push(actRes.message);
                  executedTurnsHistory.push(actRes.message);
                  await recordActionTelemetry(actKind, actRes);
                  if (actRes.recordedAction) {
                    recordedForCache.push(actRes.recordedAction);
                  }
                }

                if (!decision.isStepComplete && turn < maxMicroTurns && step.screenshots.length === shotsBeforeTurn) {
                  await takeShot("progress", {
                    label: `Nhịp ${turn}`,
                    sublabel: (decision.thought || stepMessages[stepMessages.length - 1] || "Chuyển bước tiếp theo").slice(0, 80),
                  });
                }

                if (decision.isStepComplete) {
                  if (isAssertStep && !hasExecutedAssertionInStep) {
                    logger.warn(
                      `Bước ${i + 1} [Nhịp ${turn}]: Bước Kiểm tra kết thúc nhưng chưa gọi lệnh assert* -> yêu cầu AI xác minh rõ ràng.`
                    );
                    executedTurnsHistory.push(
                      `⚠️ CHƯA CÓ LỆNH KIỂM CHỨNG: Bước này yêu cầu Kiểm tra (Assert). Hãy gọi assert / assertUrl / assertState / assertValue / assertCount / assertCompare / assertVerdict để xác minh trước khi đặt isStepComplete=true.`
                    );
                    continue;
                  }
                  llmConfirmedComplete = true;
                  break;
                }
              }

              if (stepMessages.length === 0 || !llmConfirmedComplete) {
                throw new Error(
                  !llmConfirmedComplete
                    ? `AI đã chạy hết ${maxMicroTurns} nhịp nhưng chưa hoàn tất bước: "${stepText}"`
                    : `Không thể hoàn thành bước kiểm thử: "${stepText}"`
                );
              }

              executedSuccessfully = true;
              step.executionMode = "ai";
              step.status = "passed";
              step.message = stepMessages.join(" → ");

              if (recordedForCache.length > 0) {
                pendingCacheActions = recordedForCache;
              }
            }

            // =========================================================================
            // ĐƯỜNG ỐNG CHẨN ĐOÁN NHÂN QUẢ 4 LỚP (4-LAYER CAUSAL DIAGNOSTIC PIPELINE)
            // =========================================================================
            await this._awaitPageReady(session.currentPage);

            const didClickOrSubmit =
              executedActionKinds.has("click") ||
              executedActionKinds.has("presskey") ||
              executedActionKinds.has("press") ||
              executedActionKinds.has("key");

            // Nếu cú click/submit vừa kích hoạt API nhanh đang in-flight, chờ ngắn tối đa 900ms để đối soát tín hiệu mạng
            if (didClickOrSubmit && pageTelemetryService.getCriticalInFlightCount(session) > 0) {
              const netWaitDeadline = Date.now() + 900;
              while (
                Date.now() < netWaitDeadline &&
                !aborted &&
                !stepSignal.aborted &&
                pageTelemetryService.getCriticalInFlightCount(session) > 0
              ) {
                await new Promise((r) => setTimeout(r, 40));
              }
            }

            await pageTelemetryService.flush(session, 300);
            const telemetryDelta = pageTelemetryService.getDeltaSince(session, stepTelemetryCursor);
            const stepEndUrl = session.currentPage?.url?.() || "";
            const switchedTab = Boolean(stepStartPage && session.currentPage && session.currentPage !== stepStartPage);

            const actionContext = {
              executedActionKinds,
              didClickOrSubmit,
              didSubmit,
              isFormSubmit,
              didNavigateCommand,
              submittedFormKeys: Array.from(submittedFormKeys),
              stepStartUrl,
              stepEndUrl,
              switchedTab,
            };

            const postDiag = await inspectUiDiagnostics(session.currentPage, {
              baseline: diagBaseline,
              actionContext,
            });

            const remainingSteps = steps.slice(i + 1);
            const diagVerdict = evaluateCausalDiagnostics({
              baseline: diagBaseline,
              postDiag,
              telemetryDelta,
              actionContext,
              stepText,
              remainingSteps,
              strictness: strictnessMode,
            });

            if (diagVerdict.advisoryWarnings.length > 0) {
              if (!Array.isArray(step.uxWarnings)) step.uxWarnings = [];
              for (const warnText of diagVerdict.advisoryWarnings) {
                const formattedWarn = `Thông báo phi chặn trên trang: ${warnText}`;
                if (!step.uxWarnings.includes(formattedWarn)) {
                  step.uxWarnings.push(formattedWarn);
                }
              }
            }

            if (diagVerdict.detectedAlert && !step.detectedAlert) {
              step.detectedAlert = diagVerdict.detectedAlert;
            }

            if (step.status === "passed" && diagVerdict.verdict === "fail") {
              step.status = "failed";
              step.failureType = diagVerdict.failureType || FAILURE_TYPES.SILENT_FAILURE;
              step.isProductDefect = Boolean(diagVerdict.isProductDefect);
              step.message = diagVerdict.message || "Phát hiện lỗi nghiệp vụ sau thao tác";
              if (diagVerdict.evidence) {
                step.evidence = diagVerdict.evidence;
              }
            }

            step.verdict = classifyStepVerdict({
              status: step.status,
              failureType: step.failureType,
              isProductDefect: Boolean(step.isProductDefect),
              uxWarnings: step.uxWarnings,
            });

            // Chỉ lưu Step Trace Cache khi bước đã thực sự vượt qua kiểm tra chẩn đoán giao diện
            if (step.status === "passed" && pendingCacheActions && pendingCacheActions.length > 0 && !aborted && !stepSignal.aborted) {
              const firstActKind = String(pendingCacheActions[0]?.action || pendingCacheActions[0]?.type || "")
                .toLowerCase()
                .trim();
              const routeToSave =
                firstActKind === "navigate" || firstActKind === "goto"
                  ? extractRoutePath(session.currentPage?.url?.() || "") ||
                  extractRoutePath(pendingCacheActions[0]?.value || "") ||
                  stepStartRoute
                  : stepStartRoute;
              await this.cache.saveTrace(
                stepText,
                pendingCacheActions,
                result.projectId,
                result.featureId,
                routeToSave
              );
            }

            // Đảm bảo mỗi bước đều có ảnh chụp kết quả trực quan
            const hasAfterOrViewShot = step.screenshots.some((sh) => sh.type === "after" || sh.type === "view");
            if (!hasAfterOrViewShot && !aborted && !stepSignal.aborted) {
              await takeShot(step.status === "passed" ? "after" : "error", {
                label: step.status === "passed" ? "Sau khi thực hiện" : "Khi gặp lỗi",
                sublabel: (step.detectedAlert || step.message || "Giao diện đã cập nhật").slice(0, 80),
              });
            }
          };

          const stepWorkPromise = runSingleStep();
          stepWorkPromise.catch(() => { });

          const stepTimeoutPromise = new Promise((_, reject) => {
            stepTimeoutTimer = setTimeout(() => {
              stepTimedOut = true;
              const tErr = new Error(
                `Bước ${i + 1} vượt quá thời gian cho phép (${Math.round(stepMsBudget / 1000)}s)`
              );
              tErr.name = "StepTimeoutError";
              stepTimeoutController.abort(tErr);
              reject(tErr);
            }, stepMsBudget);
          });

          await Promise.race([stepWorkPromise, stepTimeoutPromise]);
          } catch (err) {
            step.status = "failed";
            const isUserAbort = aborted || Boolean(signal?.aborted);
            const isRunTimeout = runTimedOut || (timeoutController.signal.aborted && !isUserAbort);
            const isAbortErr = isUserAbort && !stepTimedOut && err.name !== "StepTimeoutError";
            const rawMsg = err.message || String(err);
            const isGotoTimeout = rawMsg.includes("Timeout") && /goto|navigate/i.test(rawMsg);
            if (err?.evidence && !step.evidence) {
              step.evidence = err.evidence;
            }
            if (stepTimedOut || err.name === "StepTimeoutError") {
              step.failureType = FAILURE_TYPES.TIMEOUT;
              step.message = rawMsg;
            } else if (isRunTimeout) {
              step.failureType = FAILURE_TYPES.TIMEOUT;
              step.message = timeoutController.signal.reason?.message || rawMsg;
            } else if (isAbortErr) {
              step.failureType = "CANCELLED";
              step.message = "Phiên kiểm thử đã bị hủy";
            } else if (isGotoTimeout) {
              step.failureType = FAILURE_TYPES.TIMEOUT;
              step.message = `Hết thời gian tải trang: ${rawMsg}`;
            } else if (err?.failureType) {
              step.failureType = err.failureType;
              step.isProductDefect = Boolean(err.isProductDefect);
              step.message = rawMsg;
            } else if (rawMsg.includes("Không tìm thấy nội dung kỳ vọng")) {
              step.failureType = FAILURE_TYPES.ASSERTION_FAILED;
              step.isProductDefect = true;
              step.message = rawMsg;
            } else if (rawMsg.includes("Không tìm thấy")) {
              step.failureType = FAILURE_TYPES.ELEMENT_NOT_FOUND;
              step.message = rawMsg;
            } else {
              step.failureType = FAILURE_TYPES.EXECUTION_ERROR;
              step.message = rawMsg;
            }

            step.verdict = classifyStepVerdict({
              status: isAbortErr ? "cancelled" : step.status,
              failureType: step.failureType,
              isProductDefect: Boolean(step.isProductDefect),
              uxWarnings: step.uxWarnings,
            });

            if (!isAbortErr && !isRunTimeout && session.currentPage && !session.currentPage.isClosed?.()) {
              // Cho phép chụp ảnh chẩn đoán nhanh mà không bị Inactivity Watchdog ngắt ngang ngay khi bước vừa timeout
              refreshRunWatchdog(Math.max(inactivityTimeoutMs, 3000));
              await takeShot("error", {
                label: "Khi gặp lỗi",
                sublabel: step.message.slice(0, 80),
                timeoutMs: stepTimedOut || isGotoTimeout ? 350 : 2500,
              });
            }
          } finally {
            if (stepTimeoutTimer) clearTimeout(stepTimeoutTimer);
          }

          step.durationMs = Date.now() - t0;

          if (aborted || signal?.aborted) {
            markAbortedResult();
            return;
          }
          if (runTimedOut || timeoutController.signal.aborted) {
            if (step.status !== "passed" && step.failureType === FAILURE_TYPES.TIMEOUT) {
              result.status = "failed";
              result.failureType = FAILURE_TYPES.TIMEOUT;
              result.error = result.error || step.message;
            } else {
              markAbortedResult();
            }
            return;
          }

          // Sau mỗi bước hoàn tất: làm mới đồng hồ Inactivity Watchdog để kịch bản dài 25-30 bước không bị ngắt ở phút thứ 5
          refreshRunWatchdog();

          if (typeof hooks?.onStepComplete === "function") {
            try {
              await hooks.onStepComplete(step, result);
            } catch { }
          }

          if (step.status !== "passed") {
            if (isSoftStep) {
              step.isSoft = true;
              hasSoftFailure = true;
              logger.warn(`Bước ${i + 1} không đạt nhưng là [Soft Assertion], tiếp tục chạy bước tiếp theo.`);
              continue;
            }
            result.status = "failed";
            result.failureType = step.failureType;
            result.error = step.message;
            return;
          }
        }

      if (aborted || effectiveSignal.aborted) {
          markAbortedResult();
        } else if (hasSoftFailure) {
          result.status = "failed";
          result.failureType = FAILURE_TYPES.ASSERTION_FAILED;
          result.error = "Kịch bản có bước Soft Assertion không đạt yêu cầu";
        } else {
          result.status = "passed";
        }
      };

      const workPromise = runWorker();
      workPromise.catch(() => { });

      const timeoutPromise = new Promise((_, reject) => {
        rejectRunTimeout = reject;
        // Cho phép khởi chạy browser tối đa min(15s) trước khi đếm inactivity từng bước
        refreshRunWatchdog(Math.max(inactivityTimeoutMs, 15_000));
        maxRunTimer = setTimeout(() => {
          triggerRunTimeout(
            `Kịch bản vượt quá tổng ngân sách thời gian tối đa ${Math.round(maxRunCeilingMs / 1000)}s`
          );
        }, maxRunCeilingMs);
      });

      try {
        await Promise.race([workPromise, timeoutPromise, abortPromise]);
      } catch (e) {
        if (aborted || signal?.aborted) {
          markAbortedResult("Phiên kiểm thử đã bị hủy");
        } else if (runTimedOut || e.name === "TimeoutError") {
          result.status = "failed";
          result.failureType = FAILURE_TYPES.TIMEOUT;
          result.error = result.error || e.message;
        } else {
          result.status = "failed";
          result.error = `${e.name}: ${e.message}`;
        }
      } finally {
        if ((aborted || signal?.aborted || result.status === "running") && !timeoutController.signal.aborted && !runTimedOut) {
          markAbortedResult();
        } else if (runTimedOut && result.status === "running") {
          markAbortedResult();
        }
        if (signal) signal.removeEventListener("abort", onAbort);
        if (inactivityTimer) clearTimeout(inactivityTimer);
        if (maxRunTimer) clearTimeout(maxRunTimer);

        if (persistSession && storageStatePath && context && !signal?.aborted && !timeoutController.signal.aborted) {
          await this.lifecycle.saveStorageState(context, storageStatePath);
        }

        await this.lifecycle.closeInstances(context, browser);

        // Tổng hợp Verdict 4 trạng thái chuẩn Big Tech (PASSED / PASSED_WITH_WARNINGS / FAILED / BROKEN / CANCELLED)
        // + Thống kê Khế ước Kiểm chứng (Assertion Coverage & Smoke Only badge)
        const finalStrictness = normalizeStrictnessMode(
          hooks?.diagnosticStrictness || this.config?.diagnostics?.strictness,
          DIAGNOSTIC_STRICTNESS.BALANCED
        );
        const allSteps = Array.isArray(result.steps) ? result.steps : [];
        let totalAssertions = 0;
        let passedAssertions = 0;
        let failedAssertions = 0;
        let warningCount = 0;
        let hasProductFailedStep = false;
        let hasBrokenStep = false;

        for (const st of allSteps) {
          if (!st.verdict) {
            st.verdict = classifyStepVerdict({
              status: st.status,
              failureType: st.failureType,
              isProductDefect: Boolean(st.isProductDefect),
              uxWarnings: st.uxWarnings,
            });
          }
          if (Array.isArray(st.uxWarnings)) {
            warningCount += st.uxWarnings.length;
          }
          const countedAsAssert =
            Boolean(st.isAssertionStep) ||
            st.type === "assert" ||
            st.type === "observe" ||
            inferDisplayStepType(st.text) === "assert";
          if (countedAsAssert) {
            totalAssertions++;
            if (st.status === "passed") passedAssertions++;
            else failedAssertions++;
          }
          if (st.verdict === VERDICT_STATUS.FAILED) hasProductFailedStep = true;
          if (st.verdict === VERDICT_STATUS.BROKEN) hasBrokenStep = true;
        }

        let scenarioVerdict = VERDICT_STATUS.PASSED;
        if (result.status === "cancelled" || result.failureType === "CANCELLED") {
          scenarioVerdict = VERDICT_STATUS.CANCELLED;
        } else if (hasProductFailedStep) {
          scenarioVerdict = VERDICT_STATUS.FAILED;
        } else if (hasBrokenStep || result.status !== "passed") {
          scenarioVerdict = classifyStepVerdict({
            status: result.status,
            failureType: result.failureType,
            isProductDefect: false,
            uxWarnings: [],
          });
        } else if (warningCount > 0) {
          scenarioVerdict = VERDICT_STATUS.PASSED_WITH_WARNINGS;
        } else {
          scenarioVerdict = VERDICT_STATUS.PASSED;
        }

        result.verdict = scenarioVerdict;
        result.assertionSummary = {
          totalAssertions,
          passedAssertions,
          failedAssertions,
          isSmokeOnly: totalAssertions === 0,
          warningCount,
          strictnessMode: finalStrictness,
        };

        result.finishedAt = new Date().toISOString();
        this._liveState = null;
      }
    }
  }

  export const microAgentRunnerService = new MicroAgentRunnerService();


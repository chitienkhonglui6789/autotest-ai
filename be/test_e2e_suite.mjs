import fs from "node:fs";
import { localBrowser, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";
import { executeStagehandLlmCall } from "./src/services/stagehand-adapter.service.js";

const config = {
  llm: {
    baseUrl: "http://127.0.0.1:4000/v1/chat",
    model: "qwen3.8-27b",
    apiKey: "test-internal-token",
  },
  timeouts: {
    llmMs: 90000,
  },
};

// Lưu trữ toàn bộ nhật ký kiểm thử
export const testReports = [];

async function runScenario(scenarioMeta, executeFn, runs = 2) {
  console.log(`\n======================================================`);
  console.log(`▶ KỊCH BẢN: [${scenarioMeta.flow.toUpperCase()}] ${scenarioMeta.name}`);
  console.log(`🌐 URL: ${scenarioMeta.url}`);
  console.log(`🔄 Số lần chạy kiểm chứng: ${runs}`);
  console.log(`======================================================`);

  for (let runIdx = 1; runIdx <= runs; runIdx++) {
    console.log(`\n--- Lần chạy #${runIdx}/${runs} ---`);
    let browser = null;
    let stagehand = null;
    const runLog = {
      flow: scenarioMeta.flow,
      scenario: scenarioMeta.name,
      runIndex: runIdx,
      status: "pending",
      repairedFields: [],
      llmCalls: [],
      error: null,
      durationMs: 0,
      details: null,
    };
    const start = Date.now();

    try {
      browser = await localBrowser.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });

      stagehand = await Stagehand.create({
        browser,
        model: {
          generate: async (params) => {
            const res = await executeStagehandLlmCall(config, params, (audit) => {
              runLog.llmCalls.push({
                name: audit.formatName || params.responseFormat?.name || "text",
                rawOutput: audit.rawText,
                processed: audit.structuredContent,
                repairs: audit.auditLog || [],
              });
              if (audit.auditLog && audit.auditLog.length > 0) {
                runLog.repairedFields.push(...audit.auditLog);
              }
            });
            return res;
          },
        },
      });

      const pages = await browser.context.pages();
      const page = pages.length > 0 ? pages[0] : await browser.context.newPage();

      await page.goto(scenarioMeta.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1000);

      // Thực thi luồng test
      const details = await executeFn(stagehand, page);
      runLog.status = "passed";
      runLog.details = details;
      console.log(`✔ Lần #${runIdx}: THÀNH CÔNG!`);
    } catch (err) {
      runLog.status = "failed";
      runLog.error = err.message || String(err);
      console.error(`✖ Lần #${runIdx}: THẤT BẠI! Lỗi:`, err.message);
    } finally {
      runLog.durationMs = Date.now() - start;
      if (stagehand) {
        try {
          await stagehand.close();
        } catch {}
      }
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
      testReports.push(runLog);
    }
  }
}

async function startSuite() {
  console.log("\n================================================================================");
  console.log("       BỘ KIỂM THỬ E2E TOÀN DIỆN QUA MOCK PROXY NỘI BỘ (127.0.0.1:4000)        ");
  console.log("================================================================================\n");

  // 1. LUỒNG ACT - Single Step (Tìm kiếm tiếng Việt)
  await runScenario(
    {
      flow: "act",
      name: "Gõ tìm kiếm 'kiểm thử tự động' trên DuckDuckGo",
      url: "https://duckduckgo.com",
    },
    async (stagehand, page) => {
      const r = await stagehand.act("Type 'kiểm thử tự động' into the search input box");
      console.log("Act Result:", r?.data ? r.data.message : r);
      return r;
    },
    2
  );

  // 2. LUỒNG ACT - TwoStep (Dropdown select trên the-internet)
  await runScenario(
    {
      flow: "act_twoStep",
      name: "Chọn 'Option 1' từ dropdown menu (<select>)",
      url: "https://the-internet.herokuapp.com/dropdown",
    },
    async (stagehand, page) => {
      const r = await stagehand.act("Select 'Option 1' from the dropdown");
      console.log("Dropdown Act Result:", r?.data ? r.data.message : r);
      return r;
    },
    2
  );

  // 3. LUỒNG OBSERVE - Quan sát phần tử trên trang tiếng Việt (VnExpress)
  await runScenario(
    {
      flow: "observe",
      name: "Quan sát các nút và chuyên mục điều hướng trên VnExpress",
      url: "https://vnexpress.net",
    },
    async (stagehand, page) => {
      const r = await stagehand.observe("Tìm các menu chuyên mục chính trên thanh điều hướng");
      console.log(`Observe Result: Tìm thấy ${r?.data?.length || 0} phần tử.`);
      return { count: r?.data?.length || 0, sample: r?.data?.slice(0, 3) };
    },
    2
  );

  // 4. LUỒNG EXTRACT - Schema đơn giản (Trích xuất form login)
  await runScenario(
    {
      flow: "extract_simple",
      name: "Trích xuất thông tin đăng nhập mẫu từ trang login",
      url: "https://the-internet.herokuapp.com/login",
    },
    async (stagehand, page) => {
      const schema = z.object({
        username: z.string().describe("Tên đăng nhập mẫu trong phần hướng dẫn"),
        password: z.string().describe("Mật khẩu mẫu trong phần hướng dẫn"),
      });
      const r = await stagehand.extract("Extract the sample username and password from the instructions on page", schema);
      console.log("Simple Extract Result:", JSON.stringify(r?.data, null, 2));
      return r?.data;
    },
    2
  );

  // 5. LUỒNG EXTRACT - Schema lồng nhau (Quotes to scrape)
  await runScenario(
    {
      flow: "extract_nested",
      name: "Trích xuất câu trích dẫn kèm tác giả và mảng tags (Nested Schema)",
      url: "https://quotes.toscrape.com",
    },
    async (stagehand, page) => {
      const nestedSchema = z.object({
        firstQuote: z.object({
          text: z.string().describe("Nội dung câu trích dẫn đầu tiên"),
          author: z.string().describe("Tên tác giả"),
        }),
        tags: z.array(z.string()).describe("Danh sách các tags của câu trích dẫn"),
      });
      const r = await stagehand.extract("Extract the first quote with author and its tags", nestedSchema);
      console.log("Nested Extract Result:", JSON.stringify(r?.data, null, 2));
      return r?.data;
    },
    2
  );

  // 6. LUỒNG AGENT / MULTI-STEP - Đăng nhập form hoàn chỉnh
  await runScenario(
    {
      flow: "agent_multistep",
      name: "Quy trình đăng nhập đầy đủ: nhập user, nhập pass, bấm login và kiểm tra thông báo",
      url: "https://the-internet.herokuapp.com/login",
    },
    async (stagehand, page) => {
      console.log("Bước 1: Nhập username 'tomsmith'...");
      await stagehand.act("Type 'tomsmith' into the username field");

      console.log("Bước 2: Nhập password 'SuperSecretPassword!'...");
      await stagehand.act("Type 'SuperSecretPassword!' into the password field");

      console.log("Bước 3: Nhấn nút Login...");
      await stagehand.act("Click the Login button");

      console.log("Bước 4: Trích xuất thông báo bảo mật...");
      const schema = z.object({
        successMessage: z.string().describe("Nội dung thông báo flash sau khi đăng nhập"),
      });
      const r = await stagehand.extract("Extract the alert/flash message on the page", schema);
      console.log("Agent Multistep Result:", r?.data);
      return r?.data;
    },
    2
  );

  // In báo cáo tổng hợp
  console.log("\n================================================================================");
  console.log("                       BẢNG TỔNG HỢP KẾT QUẢ KIỂM THỬ E2E                       ");
  console.log("================================================================================\n");

  const summaryByFlow = {};
  for (const rep of testReports) {
    if (!summaryByFlow[rep.flow]) {
      summaryByFlow[rep.flow] = { total: 0, passed: 0, failed: 0, repairs: [] };
    }
    summaryByFlow[rep.flow].total++;
    if (rep.status === "passed") summaryByFlow[rep.flow].passed++;
    else summaryByFlow[rep.flow].failed++;
    if (rep.repairedFields.length > 0) {
      summaryByFlow[rep.flow].repairs.push(...rep.repairedFields);
    }
  }

  console.table(
    Object.entries(summaryByFlow).map(([flow, stat]) => ({
      Luồng: flow,
      "Tổng số lần chạy": stat.total,
      "Thành công": stat.passed,
      "Thất bại": stat.failed,
      "Tỉ lệ Pass (%)": `${((stat.passed / stat.total) * 100).toFixed(1)}%`,
      "Số lần tự sửa trường": stat.repairs.length,
    }))
  );

  console.log("\nChi tiết các trường đã tự động phục hồi trong suốt quá trình test:");
  const uniqueRepairs = [...new Set(testReports.flatMap((r) => r.repairedFields))];
  if (uniqueRepairs.length === 0) {
    console.log("✔ Không có trường nào bị sai cú pháp (Tất cả phản hồi đạt chuẩn).");
  } else {
    uniqueRepairs.forEach((rep) => console.log(` - 🛠 ${rep}`));
  }

  // Ghi báo cáo chi tiết ra file JSON
  fs.writeFileSync("./e2e_test_report.json", JSON.stringify(testReports, null, 2), "utf-8");
  console.log("\n📁 Đã lưu toàn bộ báo cáo chi tiết (kèm raw output & processed output) vào: be/e2e_test_report.json\n");
}

startSuite().catch((err) => {
  console.error("FATAL SUITE ERROR:", err);
});

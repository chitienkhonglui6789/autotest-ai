import { localBrowser } from "./be/node_modules/@browserbasehq/stagehand/dist/index.js";
import fs from "node:fs";
import path from "node:path";

async function run() {
  console.log("Launching browser to inspect http://127.0.0.1:5173...");
  const browser = await localBrowser.launch({ headless: true });
  const [page] = await browser.context.pages();
  
  const consoleMessages = [];
  page.on("console", (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));

  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  console.log("Page loaded. Title:", await page.title());

  // Check main headers
  const headerText = await page.textContent("header");
  console.log("Header text:", headerText.replace(/\s+/g, " ").trim());

  // Take initial screenshot
  const outDir = "./be/test-screenshots";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, "01_initial_load.png") });
  console.log("Saved screenshot: 01_initial_load.png");

  await browser.close();
  console.log("Console messages:", consoleMessages.slice(0, 5));
}

run().catch((e) => console.error("Script error:", e));


#!/usr/bin/env node

import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const htmlPath = resolve(root, "deliverables/IVYBM_一期海外社媒账号与API开通指南_客户版.html");
const pdfPath = resolve(root, "deliverables/IVYBM_一期海外社媒账号与API开通指南_客户版.pdf");

await access(htmlPath);
await mkdir(dirname(pdfPath), { recursive: true });

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  throw new Error(
    "需要 Playwright Chromium 才能从客户 HTML 重建 PDF；请先运行 pnpm exec playwright install chromium。",
    { cause: error },
  );
}
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
} finally {
  await browser.close();
}

console.log(pdfPath);

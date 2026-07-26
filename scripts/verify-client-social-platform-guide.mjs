#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const sourcePath = resolve(root, "docs/operations/一期海外社媒账号与API开通指南（客户版）.md");
const htmlPath = resolve(root, "deliverables/IVYBM_一期海外社媒账号与API开通指南_客户版.html");
const pdfPath = resolve(root, "deliverables/IVYBM_一期海外社媒账号与API开通指南_客户版.pdf");

const [source, html, pdf] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(htmlPath, "utf8"),
  readFile(pdfPath),
]);

const documentDate = source.match(/^更新日期：(\d{4}-\d{2}-\d{2})$/m)?.[1];
if (!documentDate) {
  throw new Error("客户指南缺少有效的更新日期。");
}

for (const requirement of [
  "账号注册、企业资产归属",
  "客户始终保有业务账号",
  "允许访问消息/Allow access to messages",
  "Page task",
]) {
  if (!source.includes(requirement)) {
    throw new Error(`客户指南源文件缺少范围或证据要求：${requirement}`);
  }
}

if (!html.includes(documentDate)) {
  throw new Error("客户指南 HTML 的更新日期与 Markdown 源文件不一致。");
}
if (/docs\/operations\/assets\//.test(html)) {
  throw new Error("客户指南 HTML 仍引用未受控的本地截图路径。");
}
if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
  throw new Error("客户指南 PDF 不是有效的 PDF 文件。");
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
console.log(JSON.stringify({
  documentDate,
  htmlSha256: sha256(html),
  pdfSha256: sha256(pdf),
  status: "static-contract-ok",
}, null, 2));

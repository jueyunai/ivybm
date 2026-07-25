#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const sourcePath = resolve(root, "docs/operations/一期海外社媒账号与API开通指南（客户版）.md");
const cssPath = resolve(root, "docs/operations/client-social-platform-guide.css");
const tempMarkdownPath = resolve(root, "tmp/client-social-guide-print.md");
const tempHtmlPath = resolve(root, "tmp/client-social-guide-print.html");
const outputPath = resolve(root, "deliverables/IVYBM_一期海外社媒账号与API开通指南_客户版.html");

const diagrams = [
  {
    key: "客户自有账号/主页",
    html: `<div class="flow">
  <div class="flow-item">客户自有账号/主页</div><div class="flow-arrow">→</div>
  <div class="flow-item">企业资产与管理员权限</div><div class="flow-arrow">→</div>
  <div class="flow-item warning">授权给项目 App</div><div class="flow-arrow">→</div>
  <div class="flow-item warning">产品/App 审核</div><div class="flow-arrow">→</div>
  <div class="flow-item success">受控测试与上线</div>
</div><p class="flow-caption">账号注册只是第一步；资产授权、平台审核和真实受控测试均完成后才能启用。</p>`,
  },
  {
    key: "客户企业主体",
    html: `<div class="flow">
  <div class="flow-item">客户企业主体</div><div class="flow-arrow">→</div>
  <div class="flow-item">客户 Meta Business Portfolio</div><div class="flow-arrow">→</div>
  <div class="flow-item">Facebook Page</div><div class="flow-arrow">↔</div>
  <div class="flow-item">Instagram 专业/商业账号</div><div class="flow-arrow">→</div>
  <div class="flow-item warning">IVYBM 受控 Meta App</div><div class="flow-arrow">→</div>
  <div class="flow-item success">平台审核与受控联调</div>
</div><p class="flow-caption">客户持有业务资产；IVYBM 的集成 App 仅通过官方授权页接入资产。</p>`,
  },
  {
    key: "TikTok 商业账号",
    html: `<div class="flow flow-tiktok">
  <div class="flow-item">TikTok 商业账号</div><div class="flow-arrow">→</div>
  <div class="flow-item">Business Center 与企业资料</div><div class="flow-arrow">→</div>
  <div class="flow-item warning">DM 产品资格书面确认</div><div class="flow-arrow">→</div>
  <div class="flow-item warning">App 审核与授权</div><div class="flow-arrow">→</div>
  <div class="flow-item success">Webhook 联调</div>
</div><div class="decision-grid"><div class="decision-card available"><h4>资格已确认</h4><p>可进入受控技术联调。</p></div><div class="decision-card blocked"><h4>资格未确认</h4><p>标为 blocked，改由客户在 TikTok Inbox 人工处理。</p></div></div>`,
  },
  {
    key: "需要发布图文",
    html: `<div class="decision-grid"><div class="decision-card available"><h4>个人账号发布</h4><p>Share on LinkedIn → OAuth + <code>w_member_social</code> → 受控自动发布。</p></div><div class="decision-card"><h4>企业主页发布</h4><p>Company Page + 合格管理员 → Community Management App Review → OAuth + <code>w_organization_social</code>。</p></div><div class="decision-card blocked"><h4>企业 API 未获批</h4><p>内容工作台生成文案与素材包，客户手动发布后回填状态。</p></div></div>`,
  },
];

function replaceMermaidBlocks(markdown) {
  return markdown.replace(/```mermaid\n([\s\S]*?)```/g, (block, body) => {
    const match = diagrams.find((diagram) => body.includes(diagram.key));
    return match ? `\n${match.html}\n` : block;
  });
}

await mkdir(resolve(root, "tmp"), { recursive: true });
await mkdir(resolve(root, "deliverables"), { recursive: true });

const [source, css] = await Promise.all([readFile(sourcePath, "utf8"), readFile(cssPath, "utf8")]);
const documentDate = source.match(/^更新日期：(\d{4}-\d{2}-\d{2})$/m)?.[1];
if (!documentDate) {
  throw new Error("客户指南缺少有效的更新日期，已停止构建 HTML。");
}
const localScreenshotPaths = [
  ...new Set(
    [...source.matchAll(/<img\s+[^>]*\bsrc="(docs\/operations\/assets\/[^\"]+)"/g)].map((match) => match[1]),
  ),
];
const missingScreenshots = [];

for (const relativePath of localScreenshotPaths) {
  try {
    await access(resolve(root, relativePath));
  } catch {
    missingScreenshots.push(relativePath);
  }
}

if (missingScreenshots.length > 0) {
  throw new Error(
    `缺少受控本地截图，已停止重建客户交付 HTML：\n${missingScreenshots.join("\n")}`,
  );
}

const printSource = `---\ntitle: 一期海外社媒账号与 API 开通指南\nsubtitle: 客户开通包 | Meta · TikTok · LinkedIn\ndate: ${documentDate}\n---\n\n${replaceMermaidBlocks(source)}`;
await writeFile(tempMarkdownPath, printSource, "utf8");

execFileSync(
  "pandoc",
  [
    "--standalone",
    "--from=gfm+raw_html",
    "--to=html5",
    "--resource-path",
    root,
    "--embed-resources",
    "--toc",
    "--toc-depth=2",
    "--output",
    tempHtmlPath,
    tempMarkdownPath,
  ],
  { cwd: root, stdio: "inherit" },
);

const html = await readFile(tempHtmlPath, "utf8");
const withStyle = html.replace("</head>", `<style>\n${css}\n</style>\n</head>`);
await writeFile(outputPath, withStyle, "utf8");
console.log(outputPath);

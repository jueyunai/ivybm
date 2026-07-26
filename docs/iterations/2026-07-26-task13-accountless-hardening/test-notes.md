# 测试记录

已运行：

```text
pnpm install --frozen-lockfile
pnpm docs:client-platform-workbook
pnpm docs:client-social-guide:pdf
pnpm docs:client-social-guide:verify
```

XLSX 验证脚本确认 7 个工作表、字段级 `dataValidation`、TikTok T-09/T-10 默认 `被阻塞（blocked）`、客户资产归属边界、Meta Page task 和 Instagram“Allow access to messages”证据字段；在两个临时目录重建的 SHA-256 均为 `5113cb4b3f78ddfb5e9a1f78544934a26cb8df86ef7e6e3c6b9ebb20325febca`。

同步 HTML 的静态契约验证确认更新日期为 `2026-07-26`、无受控外的本地截图路径；Playwright Chromium 1.58.2 已从该 HTML 重建 PDF，并验证 PDF 文件签名。当前机器没有 `pandoc`，因此**没有**运行 `pnpm docs:client-social-guide:html`，不能声称 Markdown → HTML 已在本机重新生成；有 `pandoc` 的文档环境须运行该命令，再运行 `pnpm docs:client-social-guide:pdf` 与 `pnpm docs:client-social-guide:verify`。

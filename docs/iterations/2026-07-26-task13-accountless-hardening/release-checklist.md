# 发布检查表

- [x] 不含真实账号密码、token、secret、证件原件或客户资料。
- [x] XLSX 结构、字段级下拉、客户资产归属边界和证据字段通过；同源内容可字节级重建。
- [x] HTML 静态契约通过：日期一致且无缺失的本地截图引用。
- [x] PDF 已从当前 HTML 通过 Playwright Chromium 重建并验证文件签名。
- [ ] jueyunai review：客户 App 归属、交付口径与版本化二进制文档。
- [ ] 有 `pandoc` 的环境运行 `pnpm docs:client-social-guide:html`，再重新生成 PDF 并完成静态契约核验。

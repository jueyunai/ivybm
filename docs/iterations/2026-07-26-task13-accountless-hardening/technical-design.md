# 技术与交付设计

- 工作簿按字段使用通用资料、授权、审批、部署和 TikTok 私信资格的独立下拉枚举。
- 工作簿明确“客户创建并持有账号/资产，IVYBM 仅在书面授权后协助集成配置”；Meta 另记录 Page task 与 Instagram“Allow access to messages”的脱敏证据位置。
- 默认 Meta 路径为 IVYBM 受控 App；客户自持 App 的名称和管理员仅在书面确认后条件必填。
- 工作簿只记录非密资料、状态和受控交付记录；不记录密码、验证码、secret、token 或银行卡信息。
- XLSX 以固定 ZIP 元数据生成，`pnpm docs:client-platform-workbook` 在临时目录中验证字节级重建。客户指南 Markdown → HTML 需要 `pandoc`，HTML → PDF 使用 Playwright Chromium；未运行的构建不能宣称已验证。

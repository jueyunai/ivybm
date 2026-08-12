# Walkthrough: 国家信号结构化 token 隔离

## 修复结果

`extractCountry` 现在先移除邮箱和 URL/domain span，再从剩余自然语言中匹配国家。邮箱域名和 URL path 不再产生 `target_country`，但 `The project is in Oman.`、`The project market is UAE.`、`المشروع في عمان.` 等正常描述保持可识别。

## 回归覆盖

- 邮箱域名：`usa`、`oman`、`canada`；
- URL path/query/fragment/port：`https://example.com/usa/spec`、`example.com?country=usa`、`example.com#oman`、`example.com;market=canada`、`example.com:443/usa/spec`；
- 权威评分：无真实国家时保持 60 分 B 级、`handoffRecommended=false`；
- 混合文本：先出现 `sales@usa.example.invalid`，后出现真实 `Oman` 描述时仍提取 `Oman`；
- 既有词内边界：`woman`、`Canadian`、`Qatarian` 继续不产生国家信号。

## 验证证据

- 修复前：首批新增 8 个回归失败，分别复现 `USA` / `Oman` / `Canada` 误提取和评分误晋级；独立复审继续补出无 scheme URL continuation 变体。
- 修复后：`tests/unit/conversation-lead-sink.test.ts` 142/142、定向评分测试合计 145/145、全量 unit 983/983、contract 73/73 通过。
- 本问题属于纯服务端文本解析，无可视 UI 状态；自动化断言代替截图作为复现与修复证据。

完整静态检查和提交前门禁结果记录在 PR #80 的中文证据评论中。

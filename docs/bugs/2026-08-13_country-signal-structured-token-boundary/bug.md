# Bug: 邮箱与 URL 中的国家词误触发高意向接管

## 关联需求

- `docs/plans/2026-08-10-MVP范围冻结与交付冲刺.md`：官网 AI 客服 → 人工接管 → Lead → 飞书闭环。
- `docs/plans/2026-07-16-一期开发实施计划.md`：Task 9 意向评分与人工接管。

## 问题描述

PR #80 已把国家匹配从无边界子串收紧为 Unicode 字母/数字边界，但国家词出现在邮箱或 URL 中时仍会被当成访客明确提供的目标国家。

例如：

- `sales@usa.example.invalid` 被识别为 `USA`；
- `buyer@oman.example.invalid` 被识别为 `Oman`；
- `https://example.com/usa/spec` 被识别为 `USA`。
- `example.com?country=usa`、`example.com#oman`、`example.com:443/usa` 等无 scheme URL 后缀中的国家词也会被识别。

这些伪国家信号会增加 10 分 `target_country`，把原本 60 分的 B 级询盘提升为 70 分 A 级，并错误触发人工接管。

## 复现步骤

1. 用 `PayloadConversationLeadSink.evaluate` 评估包含产品、1000 平方米、tender、邮箱，但没有自然语言国家描述的访客消息。
2. 把邮箱域名设为 `usa.example.invalid`、`oman.example.invalid` 或 `canada.example.invalid`，或加入 URL path/query/fragment/port 后缀中的国家词。
3. 修复前执行 `tests/unit/conversation-lead-sink.test.ts`，回归断言会复现 `country` 被错误赋值、评分升到 A 级。

## 根因分析

国家正则只要求国家词两侧不是 Unicode 字母或数字。该规则能阻止 `woman` 中的 `Oman`，但 `@`、`.`、`/` 都不是字母或数字，因此邮箱域名和 URL path 中的独立 token 仍满足边界条件。

根因不在评分阈值，而在评分前的信号提取没有区分自然语言正文与邮箱/URL 这类结构化标识符。继续添加单个前后字符排除会遗漏 URL query、无 scheme 域名等变体。

## 修复方案

1. 国家匹配前先从候选文本中屏蔽完整邮箱地址和 URL/domain span，包括无 scheme URL 的 port、path、query、fragment 与分号参数。
2. 继续在剩余自然语言文本上使用现有 Unicode 字母/数字边界，保留英文和阿语国家识别。
3. 增加邮箱域名、URL path、B→A 误晋级，以及“结构化 token 后仍有真实国家描述”的回归测试。

## 影响范围

- 只修改 Task 9 的国家信号提取和对应 unit 测试。
- 不修改评分阈值、共享 Collection、migration、公共 contract、CI 或 production 配置。

# Task 7 询盘与线索入库设计

## 目标与边界

Task 7 把 Task 6 的英文 / 阿语联系表单接入真实 Payload / PostgreSQL 线索流程，并为 Task 9 提供稳定的 `Leads` 共享契约。一期只收集跟进项目所需的姓名、公司、国家、邮箱、电话、产品兴趣、需求描述、locale、来源 URL 和 UTM。不存储客户 IP、User-Agent 或其他非必要指纹；不提前实现 Task 9 的 AI 打分，也不引入 Task 10 的 Jobs / worker。

## 数据模型与权限

`LeadSources` 管理稳定来源键、显示名、渠道和启用状态。公开询盘端点会幂等确保 `website-contact` 来源存在，避免依赖开发 seed。`Leads` 保存业务字段、`requestId`、客户生成的 `idempotencyKey`、来源关系、状态、意向等级和可选负责人。`requestId` 和 `idempotencyKey` 都使用数据库唯一索引，并发重试时由数据库作最终幂等保障。

公网不可直接读写 `Leads`。admin 拥有全权；operator 可读取、更新和分配；sales 只能读取、更新分配给自己的线索，不能改写来源、幂等键或负责人。公开 API 在完成自身验证、限流和蜜罐检查后，只以服务端边界使用 Payload Local API 写入。

## 请求流程与错误处理

`POST /api/inquiries` 同时接受 JSON 和普通 HTML form body。请求先经固定窗口限流，再执行字段白名单、长度、locale、邮箱、电话、URL 和 UUID 校验。蜜罐字段被填写时返回通用接收响应但不入库。重复 `idempotencyKey` 返回首次入库的 `requestId`，不生成第二条线索。

JavaScript 客户端获得结构化 JSON，显示提交中、成功、校验失败、限流和可恢复服务异常状态。普通 HTML form 提交则获得对应 locale 的最小 HTML 结果页和返回联系页链接。所有失败只暴露稳定错误码和本次 request ID，不回显数据库、连接串或内部异常。

## 限流与测试

当前单机部署使用进程内固定窗口限流，默认每个客户地址 10 分钟 5 次；限流器通过小型接口注入，后续多实例部署可换为共享存储而不修改 API 业务逻辑。数据库唯一约束仍负责跨进程的最终幂等。

客户地址只允许从受信 OpenResty 写入的 `X-Real-IP` / `X-Forwarded-For` 读取；应用端口不得直接暴露公网，反向代理必须覆盖客户端自带的同名 header。Task 14 的 staging / production 验收需同时检查代理 header 覆盖和应用端口网络隔离，否则当前进程内限流不能视为可靠的公网反滥用边界。

单元测试覆盖字段校验、正规化、蜜罐与限流器；集成测试覆盖 Payload 入库、来源、UTM、重复提交、并发唯一约束、权限和错误边界；E2E 覆盖英文 / 阿语校验与成功态、重试及无 JavaScript 基础提交。

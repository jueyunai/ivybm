# Task 实施规格契约模板 (Spec as Contract)

> **使用说明**：任何新需求、功能改版或重构任务在动工前，必须按本模板编写实施规格并确认。规格必须**自包含**，严禁让执行者或 AI 猜测文件位置、接口形态或自由发挥未要求的特性。

---

# Task-<编号>: <任务简述>

- **负责人**: <jueyunai / xuemusi>
- **关联需求/问题**: [`docs/requirements/...`](file:///path/to/doc)
- **目标与背景**: 一句话说明要解决什么问题、为什么做、成功交付长什么样。

---

## 1. 点名文件与修改清单 (Named Files & Paths)

> 明确列出本次涉及的所有文件路径（使用 `[NEW]`、`[MODIFY]`、`[DELETE]` 标识），禁止写“在相关地方修改”：

- `[NEW] src/components/path/to/NewComponent.tsx`
- `[MODIFY] src/services/path/to/ExistingService.ts`
- `[NEW] tests/unit/path/to/NewComponent.test.ts`

---

## 2. 点名具体接口与数据结构 (Named Interfaces & Contracts)

> 明确给出涉及的 TypeScript 类型、函数/方法签名、API 端点入参与响应结构，按真实定义编写：

```typescript
// 示例：入参 DTO
export interface ExampleRequestDTO {
  id: string;
  name: string;
  options?: Record<string, unknown>;
}

// 示例：服务方法签名
export interface ExampleServicePort {
  execute(params: ExampleRequestDTO): Promise<{ success: boolean; dataId: string }>;
}
```

---

## 3. 明确不做清单 (Out-of-Scope — 强制项)

> 白纸黑字列出本次任务**坚决不做**的功能与边界，杜绝 AI 镀金与范围蔓延。开发过程中若有人/AI 尝试增加这些内容，直接拒绝：

- ❌ 本次不做：...
- ❌ 本次不做：...
- ❌ 本次不重构：...

---

## 4. 版本锚定 (Version Pinning)

> 确认已安装依赖的实际版本，按该版本 API 编写，防止幻觉签名：

- 核心框架/库版本：`Next.js 15.x` / `Payload 3.x` / `Lucide React 0.4x`
- 对应限制：严禁使用废弃 API 或编造不存在的第三方包。

---

## 5. 已知坑与防护 (Encoded Pitfalls)

> 列出该模块历史上踩过、易错的高频坑或系统边界约束（如 RBAC、同源校验、幂等键、并发锁）：

- 坑点 1：...
- 坑点 2：...

---

## 6. 端到端可执行验证步骤 (E2E Verification Commands)

> 任务以一组从头到尾可运行的验证命令收尾，作为交付完成的硬性定义（覆盖核心成功流 + 关键错误流）：

```bash
# 1. 静态检查
pnpm typecheck
pnpm lint

# 2. 定向单元/集成测试
pnpm test:unit tests/unit/path/to/NewComponent.test.ts

# 3. (可选) 关键路径构建或 E2E 验证
pnpm build
```

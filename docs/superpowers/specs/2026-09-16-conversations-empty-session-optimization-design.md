# 统一会话防污染与延迟建连设计规格 (Conversations Empty Session Optimization)

## 1. 概述与背景

### 1.1 现状与问题
在官网访客交互与运营后台统一会话（`/dashboard/conversations`）中存在以下问题：
1. **前台即时建连产生死会话**：访客在官网前台点击打开右下角客服挂件时，`ChatWidget` 立即调用 `/api/chat/sessions` 在数据库创建会话与访客记录。若访客仅点开查看但未发言便关闭网页，就会在数据库中留下无消息的空白会话。
2. **后台排序与过滤缺陷**：空会话的 `lastMessageAt` 字段为 `null`，在 PostgreSQL 降序排序（`-lastMessageAt`）时，`null` 值默认排在最前（`NULLS FIRST`），导致大量无消息的弃访记录置顶霸屏，严重干扰客服工作台操作。

### 1.2 优化目标
1. **源头治理（延迟建连）**：访客点击打开客服浮窗仅展示本地界面，不发起网络请求、不写库；直到访客真正输入并发送第一条消息时，才正式向后端发起建连。
2. **工作台防污染（有效会话过滤）**：客服工作台接口只返回存在实际消息互动（`lastMessageAt IS NOT NULL`）的有效会话，彻底排除空会话干扰。
3. **兼容与韧性**：现有 `sessionStorage` 历史会话恢复、多语言（EN/AR）切换、快捷提问胶囊等功能保持 100% 兼容。

---

## 2. 详细架构设计

### 2.1 前台 ChatWidget 延迟建连 (Lazy Session Initialization)

#### 2.1.1 状态机与生命周期
- **打开挂件 (`open`)**：
  - 设置 `isOpen: true`；
  - 若 `persistSession: true` 且本地 `sessionStorage` 中存在已持久化的 `sessionId`，尝试静默恢复已有会话历史；
  - 若本地无历史会话，**不调用 `startSession()`**，保持 `session: null`，前端展示本地初始欢迎态（客服头像、欢迎提示、常见问题胶囊）。
- **发送首条消息 (`submitMessage`)**：
  - 若当前 `session` 为空：
    1. 调用 `startSession({ channel: 'website', locale, ... })` 获得新会话；
    2. 立即将草稿消息提交至 `sendMessage({ sessionId, text })`；
    3. 服务端持久化该消息并原子更新会话的 `lastMessageAt`；
    4. 本地提交会话快照，转入正常聊天状态机。
  - 若当前已有 `session`：
    - 直接提交消息至 `sendMessage`。
- **快捷提问胶囊点击**：
  - 将胶囊文本填入并自动调用 `submitMessage` 逻辑，同样触发延迟建连与首条发送。

### 2.2 服务端查询过滤 (Operator Sessions Query)

#### 2.2.1 过滤约束收敛
在 `src/app/api/chat/operator/sessions/route.ts` 中：
```typescript
const filters: Where[] = [
  { lastMessageAt: { exists: true } },
]
if (actor.role === 'sales') filters.push({ assignedTo: { equals: actor.id } })
if (status) filters.push({ handoffStatus: { equals: status } })
```
- 查询条件固定包含 `lastMessageAt: { exists: true }`，确保排除所有未产生消息的空白会话。
- 排序保持 `sort: '-lastMessageAt'`，天然避免 `NULLS FIRST` 导致的顶置错乱。

### 2.3 工作台前端显示防御

在 `ConversationWorkspace.tsx` 中：
- 对可能缺失 `lastMessageAt` 的旧数据或边缘情况做防御性回退，避免出现孤立破折号 `—`。

---

## 3. 测试与验证策略

1. **单元测试**：
   - `tests/unit/chat-widget.test.ts`：验证打开挂件时不触发 `startSession`；验证首次发送消息时顺序触发 `startSession` 与 `sendMessage`；验证已有持久化会话时的恢复逻辑。
   - `tests/unit/admin-portal-conversations.test.ts`：验证列表查询参数包含 `lastMessageAt` 过滤条件。
2. **集成与契约测试**：
   - `tests/integration/chat-api.test.ts`：验证未发消息的会话不出现在 operator 列表，首条消息发送后正常在 operator 列表出现。
3. **全局门禁**：
   - `pnpm typecheck`：0 error。
   - `pnpm lint`：0 error。
   - `pnpm test:unit` 与 `pnpm test:contract`：100% PASS。

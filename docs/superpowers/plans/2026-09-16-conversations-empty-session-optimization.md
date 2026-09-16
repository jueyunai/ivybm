# 统一会话防污染与延迟建连实现计划 (Conversations Empty Session Optimization)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底解决官网点开聊天浮窗产生空会话以及运营后台被无时间空会话霸屏的问题：前台实现延迟建连（首条消息才写库建连），后台接口实现有效会话强制过滤（`lastMessageAt` 存在性约束）。

**Architecture:**
1. 服务端：在 `src/app/api/chat/operator/sessions/route.ts` 中为后台操作员列表查询增加 `{ lastMessageAt: { exists: true } }` 约束，只返回有真实消息记录的有效会话。
2. 前台端：修改 `src/components/chat/ChatWidget.tsx`，在展开聊天挂件时仅渲染本地欢迎界面（不请求 `/api/chat/sessions`），在访客提交首条消息或点击快捷胶囊时顺序触发建连与发送；保留 `sessionStorage` 历史会话恢复能力。
3. 工作台：在 `ConversationWorkspace.tsx` 对异常无时间会话做防御性降级渲染。

**Tech Stack:** Next.js (App Router), React 19, Payload CMS 3.x, PostgreSQL, Vitest, Testing Library.

## Global Constraints

- 不破坏已有的会话领域状态机（`ai_active`、`handoff_requested`、`human_active`、`resolved`）。
- 保持英阿双语（`en` / `ar`）多语言支持一致。
- 保持 `sessionStorage` 会话持久化与恢复机制正常工作。
- 保持全量门禁（`pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:contract`）100% 通过。

---

### Task 1: 服务端 Operator Sessions API 过滤无消息会话

**Files:**
- Modify: `src/app/api/chat/operator/sessions/route.ts:44-56`
- Test: `tests/integration/chat-api.test.ts`

**Interfaces:**
- Consumes: Payload `conversations` collection, `Where` filter types
- Produces: `GET /api/chat/operator/sessions` returns only docs where `lastMessageAt` exists

- [ ] **Step 1: Write the failing integration test**

在 `tests/integration/chat-api.test.ts` 中新增测试用例，验证刚创建但无消息的会话不会出现在 operator 会话列表中，而在发送首条消息后才会出现：

```typescript
it('omits empty conversations with no messages from the operator inbox', async () => {
  const suffix = randomUUID()
  const idempotencyKey = `empty-session-${suffix}`
  const body = JSON.stringify({ channel: 'website', idempotencyKey, locale: 'en' })
  const startResponse = await startSession(
    new NextRequest('http://localhost/api/chat/sessions', {
      body,
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  )
  expect(startResponse.status).toBe(201)
  const created = (await startResponse.json()) as { id: string }

  // Operator list should not contain this empty session
  const adminCookie = await createAdminSessionCookie(payload)
  const listResponse = await listOperatorSessions(
    new NextRequest('http://localhost/api/chat/operator/sessions', {
      headers: { cookie: adminCookie },
    }),
  )
  expect(listResponse.status).toBe(200)
  const listData = (await listResponse.json()) as { docs: Array<{ id: string }> }
  expect(listData.docs.some((doc) => doc.id === created.id)).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/chat-api.test.ts`
Expected: FAIL（因为当前代码没有过滤，刚创建的空会话会出现在 listData.docs 中）。

- [ ] **Step 3: Write minimal implementation in route.ts**

修改 `src/app/api/chat/operator/sessions/route.ts`：
```typescript
const filters: Where[] = [
  {
    lastMessageAt: {
      exists: true,
    },
  },
]
if (actor.role === 'sales') filters.push({ assignedTo: { equals: actor.id } })
if (status) filters.push({ handoffStatus: { equals: status } })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/chat-api.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit Task 1**

```bash
git add src/app/api/chat/operator/sessions/route.ts tests/integration/chat-api.test.ts
git commit -m "feat(conversations): filter empty sessions without messages in operator inbox"
```

---

### Task 2: 前台 ChatWidget 延迟建连核心逻辑

**Files:**
- Modify: `src/components/chat/ChatWidget.tsx:184-248`
- Test: `tests/unit/chat-widget.test.ts`

**Interfaces:**
- Consumes: `ChatService`, `startSession`, `sendMessage`
- Produces: `ChatWidget` component that delays `startSession` until first message submission

- [ ] **Step 1: Write the failing unit tests**

在 `tests/unit/chat-widget.test.ts` 中增加测试用例：
1. 打开挂件时不调用 `startSession`；
2. 发送首条消息时，先调用 `startSession` 再调用 `sendMessage`：

```typescript
it('does not start a session when opening the widget until the visitor sends a message', async () => {
  const service = new FakeChatService()
  const startSessionSpy = vi.spyOn(service, 'startSession')
  const sendMessageSpy = vi.spyOn(service, 'sendMessage')

  renderWidget(service)
  await openWidget()

  // Opening the widget must not create a backend session
  expect(startSessionSpy).not.toHaveBeenCalled()
  expect(sendMessageSpy).not.toHaveBeenCalled()

  // Sending the first message triggers startSession and then sendMessage
  const composer = screen.getByLabelText('Ask about panels, drawings, finishes, or your project…')
  fireEvent.change(composer, { target: { value: 'Hello there' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))

  await waitFor(() => {
    expect(startSessionSpy).toHaveBeenCalledTimes(1)
    expect(sendMessageSpy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/chat-widget.test.ts`
Expected: FAIL（因为当前 `openWidget()` 会立即调用 `startSession`）。

- [ ] **Step 3: Modify ChatWidget.tsx to defer startSession**

修改 `src/components/chat/ChatWidget.tsx`：
1. 修改 `open()` 方法：
```typescript
const open = (): void => {
  setIsOpen(true)
  if (persistSession) {
    const persistedID = readPersistedSessionID(sessionStorageKey)
    if (persistedID && !session) {
      void startSession(false)
    }
  }
}
```
2. 修改 `submitMessage` 方法，在提交时若无 `session` 则先等待 `startSession()` 返回：
```typescript
const submitMessage = async (event: React.FormEvent<HTMLFormElement>) => {
  event.preventDefault()
  const text = draft.trim()
  if (!text || operationPending(status)) return

  let activeSession = session
  if (!activeSession) {
    activeSession = await startSession()
  }
  if (!activeSession || !hasAction(activeSession, 'send_message')) return
  ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/chat-widget.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit Task 2**

```bash
git add src/components/chat/ChatWidget.tsx tests/unit/chat-widget.test.ts
git commit -m "feat(chat): defer session creation until visitor sends first message"
```

---

### Task 3: 快捷提问胶囊与持久化会话延迟建连集成

**Files:**
- Modify: `src/components/chat/ChatWidget.tsx`
- Test: `tests/unit/chat-widget.test.ts`

**Interfaces:**
- Consumes: `sampleQuestions`, `submitMessage`
- Produces: Quick questions seamlessly trigger deferred session initialization

- [ ] **Step 1: Write test for quick question prompt pills**

```typescript
it('triggers deferred session creation when clicking a sample question pill', async () => {
  const service = new FakeChatService()
  const startSessionSpy = vi.spyOn(service, 'startSession')
  const sendMessageSpy = vi.spyOn(service, 'sendMessage')

  renderWidget(service)
  await openWidget()

  expect(startSessionSpy).not.toHaveBeenCalled()
  const sampleButton = screen.queryByRole('button', { name: /perforated facade|facade panels/i })
  if (sampleButton) {
    fireEvent.click(sampleButton)
    await waitFor(() => {
      expect(startSessionSpy).toHaveBeenCalledTimes(1)
      expect(sendMessageSpy).toHaveBeenCalledTimes(1)
    })
  }
})
```

- [ ] **Step 2: Run test and verify behavior**

Run: `pnpm vitest run tests/unit/chat-widget.test.ts`
Expected: PASS / 调整对应点击处理函数确保统一调用。

- [ ] **Step 3: Commit Task 3**

```bash
git add src/components/chat/ChatWidget.tsx tests/unit/chat-widget.test.ts
git commit -m "feat(chat): ensure sample question pills trigger deferred session creation"
```

---

### Task 4: 工作台空时间防御与列表时间渲染完善

**Files:**
- Modify: `src/admin-portal/modules/conversations/ConversationWorkspace.tsx:312-326`
- Test: `tests/unit/admin-portal-conversations.test.ts`

**Interfaces:**
- Consumes: `ChatSessionSummary`, `lastMessageAt`
- Produces: Robust fallback time display when lastMessageAt is missing

- [ ] **Step 1: Write test in admin-portal-conversations.test.ts**

验证即使接口返回了一条缺少 `lastMessageAt` 的异常会话，界面渲染也能平稳回退并不产生抛错：

```typescript
it('gracefully handles conversations with missing lastMessageAt without crashing', async () => {
  const abnormalSession: ChatSession = {
    ...session1,
    id: 'conv-no-time',
    messages: [],
  }
  // verify workspace handles session without throwing
})
```

- [ ] **Step 2: Implement defensive formatting in ConversationWorkspace.tsx**

更新 `formatDate`，确保空值时返回统一语义：
```typescript
const formatDate = (value: string | undefined, locale: 'en' | 'zh'): string => {
  if (!value) return locale === 'zh' ? '暂无消息' : 'No messages'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(timestamp)
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/admin-portal-conversations.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit Task 4**

```bash
git add src/admin-portal/modules/conversations/ConversationWorkspace.tsx tests/unit/admin-portal-conversations.test.ts
git commit -m "fix(portal): provide friendly fallback for conversations without timestamps"
```

---

### Task 5: 全量门禁验证与开发进度记录

**Files:**
- Modify: `docs/开发进度.md`

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: 0 errors.

- [ ] **Step 3: Run unit and contract tests**

Run: `pnpm test:unit`
Expected: All tests PASS.
Run: `pnpm test:contract`
Expected: All tests PASS.

- [ ] **Step 4: Update docs/开发进度.md**

记录本次线上历史空数据清理、前台延迟建连以及后台列表有效会话过滤的完整闭环。

- [ ] **Step 5: Commit progress record**

```bash
git add "docs/开发进度.md"
git commit -m "docs: record conversations empty session cleanup and lazy initialization optimization"
```

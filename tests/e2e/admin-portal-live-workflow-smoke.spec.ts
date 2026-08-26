import './require-mutation-launch'
import { createServer, type Server } from 'node:http'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect, test } from '@playwright/test'

import { runLiveWorkflowSmoke } from '../../scripts/smoke/live-workflow-smoke'
import { verifyFeishuRecord } from '../../scripts/smoke/feishu-verifier'
import type { SmokeConfig } from '../../scripts/smoke/config'
import { generateCanaryData } from '../../scripts/smoke/marker'

type SyntheticLead = {
  company: string
  email: string
  message: string
  name: string
  status: 'disqualified' | 'new'
}

test.describe('live-workflow browser runner with synthetic server', () => {
  test.describe.configure({ timeout: 60_000 })
  let server: Server
  let serverUrl: string
  let tempDir: string

  const state = {
    chatMessages: [] as Array<{ author: string; content: string }>,
    conversationResolved: false,
    delayedFeishuSearchMs: 0,
    denyLeadCleanup: false,
    deliverOperatorReplies: true,
    duplicatePortalLead: false,
    duplicateFeishuRecord: false,
    failLeadCleanup: false,
    feishuSplitFields: false,
    hideFeishuRecord: false,
    inquiryResponseDelayMs: 0,
    inquiries: [] as Array<Record<string, unknown>>,
    leads: [] as SyntheticLead[],
    omitSessionId: false,
    operatorReplies: [] as string[],
    takenOver: false,
  }

  test.beforeEach(() => {
    state.chatMessages.length = 0
    state.conversationResolved = false
    state.delayedFeishuSearchMs = 0
    state.denyLeadCleanup = false
    state.deliverOperatorReplies = true
    state.duplicatePortalLead = false
    state.duplicateFeishuRecord = false
    state.failLeadCleanup = false
    state.feishuSplitFields = false
    state.hideFeishuRecord = false
    state.inquiryResponseDelayMs = 0
    state.inquiries.length = 0
    state.leads.length = 0
    state.omitSessionId = false
    state.operatorReplies.length = 0
    state.takenOver = false
  })

  test.beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'smoke-runner-test-'))

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

      // API: Inquiries
      if (req.method === 'POST' && url.pathname === '/api/inquiries') {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}') as Record<string, unknown>
          state.inquiries.push(parsed)
          const lead: SyntheticLead = {
            company: String(parsed.company ?? ''),
            email: String(parsed.email ?? ''),
            message: String(parsed.message ?? ''),
            name: String(parsed.name ?? ''),
            status: 'new',
          }
          const existingLead = state.leads.findIndex((item) => item.email === lead.email)
          if (existingLead >= 0) state.leads[existingLead] = lead
          else state.leads.push(lead)
          const respond = () => {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, requestId: `req-${Date.now()}` }))
          }
          if (state.inquiryResponseDelayMs > 0) setTimeout(respond, state.inquiryResponseDelayMs)
          else respond()
        })
        return
      }

      // API: Chat Sessions Start
      if (req.method === 'POST' && url.pathname === '/api/chat/sessions') {
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            ...(state.omitSessionId ? {} : { id: 'chat-sess-synth-1' }),
            requestId: 'req-chat-start-1',
          }),
        )
        return
      }

      // API: Chat Message Post
      if (
        req.method === 'POST' &&
        url.pathname === '/api/chat/sessions/chat-sess-synth-1/messages'
      ) {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}') as { text?: string }
          state.chatMessages.push({ author: 'visitor', content: parsed.text ?? '' })
          const runId = parsed.text?.match(/\[CANARY ([^\]]+)\]/u)?.[1]
          if (runId && /@example\.invalid/u.test(parsed.text ?? '')) {
            const locale = /-ar@example\.invalid/u.test(parsed.text ?? '') ? 'ar' : 'en'
            const data = generateCanaryData(runId, locale)
            const lead: SyntheticLead = {
              company: data.company,
              email: data.email,
              message: data.message,
              name: data.name,
              status: 'new',
            }
            const existingLead = state.leads.findIndex((item) => item.email === lead.email)
            if (existingLead >= 0) state.leads[existingLead] = lead
            else state.leads.push(lead)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              author: 'assistant',
              content: 'Reviewed knowledge: Aluminum facade panels.',
            }),
          )
        })
        return
      }

      if (req.method === 'POST' && url.pathname === '/synthetic-lead-update') {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          if (state.failLeadCleanup) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Synthetic cleanup failed' }))
            return
          }
          const parsed = JSON.parse(body || '{}') as { email?: string }
          const lead = state.leads.find((item) => item.email === parsed.email)
          if (lead) lead.status = 'disqualified'
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        })
        return
      }

      // API: Chat Poll
      if (req.method === 'GET' && url.pathname === '/api/chat/sessions/chat-sess-synth-1') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            handoffStatus: state.conversationResolved
              ? 'resolved'
              : state.takenOver
                ? 'human_active'
                : 'handoff_requested',
            operatorReplies: state.deliverOperatorReplies ? state.operatorReplies : [],
          }),
        )
        return
      }

      // Synthetic Page: Contact
      if (url.pathname === '/en/contact' || url.pathname === '/ar/contact') {
        const isAr = url.pathname.startsWith('/ar')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`
          <!DOCTYPE html>
          <html>
          <body>
            <form id="inquiry-form">
              <label for="name">${isAr ? 'الاسم *' : 'Name *'}</label>
              <input id="name" name="name" />

              <label for="email">${isAr ? 'البريد الإلكتروني *' : 'Email *'}</label>
              <input id="email" name="email" type="email" />

              <label for="company">${isAr ? 'الشركة' : 'Company'}</label>
              <input id="company" name="company" />

              <label for="phone">${isAr ? 'الهاتف' : 'Phone'}</label>
              <input id="phone" name="phone" />

              <label for="country">${isAr ? 'الدولة *' : 'Country *'}</label>
              <select id="country" name="country">
                <option value="">Select</option>
                <option value="United Arab Emirates">United Arab Emirates</option>
              </select>

              <label for="message">${isAr ? 'الرسالة *' : 'Message *'}</label>
              <textarea id="message" name="message"></textarea>

              <button type="button" id="submit-btn">${isAr ? 'إرسال الاستفسار' : 'Send Inquiry'}</button>
            </form>
            <div id="status"></div>

            <script>
              document.getElementById('submit-btn').addEventListener('click', async () => {
                const name = document.getElementById('name').value;
                const email = document.getElementById('email').value;
                const company = document.getElementById('company').value;
                const country = document.getElementById('country').value;
                const message = document.getElementById('message').value;
                const phone = document.getElementById('phone').value;

                const res = await fetch('/api/inquiries', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name, email, company, country, message, phone })
                });
                const data = await res.json();
                document.getElementById('status').innerHTML =
                  '${isAr ? 'تم استلام الاستفسار' : 'Inquiry received'}: <span data-testid="inquiry-request-id">' + data.requestId + '</span>';
              });
            </script>
          </body>
          </html>
        `)
        return
      }

      // Synthetic Page: Portal Login
      if (url.pathname === '/dashboard/login') {
        const returnTo = url.searchParams.get('returnTo') || '/dashboard/leads'
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`
          <!DOCTYPE html>
          <html>
          <body>
            <label for="email">邮箱</label>
            <input id="email" name="email" type="email" />

            <label for="password">密码</label>
            <input id="password" name="password" type="password" />

            <button type="button" id="login-btn">登录后台</button>

            <script>
              document.getElementById('login-btn').addEventListener('click', () => {
                window.location.href = '${returnTo}';
              });
            </script>
          </body>
          </html>
        `)
        return
      }

      // Synthetic Page: Portal Leads
      if (url.pathname === '/dashboard/leads') {
        const query = url.searchParams.get('q') ?? ''
        const matchedLeads = state.leads.filter((lead) => !query || lead.email === query)
        if (state.duplicatePortalLead && matchedLeads[0]) {
          matchedLeads.push({ ...matchedLeads[0] })
        }
        const selected = matchedLeads[0]
        const listItems = matchedLeads
          .map(
            (lead, index) => `<li>
              <button type="button" class="lead-item-btn" data-index="${index}">
                <strong>${lead.name}</strong>
                <span>${lead.company}</span>
                <span>A 高意向</span>
              </button>
            </li>`,
          )
          .join('')
        const detail = selected
          ? `<div class="portal-leads__detail">
              <header>
                <h3>${selected.name}</h3>
                <span id="lead-status">${selected.status === 'disqualified' ? '不合格' : '新增'}</span>
                ${state.denyLeadCleanup ? '' : '<button type="button" id="edit-lead" aria-label="编辑线索">编辑</button>'}
              </header>
              <p id="detail-email">${selected.email}</p>
              <p id="detail-company">${selected.company}</p>
              <p id="detail-locale">EN</p>
              <p id="detail-message">${selected.message}</p>
            </div>
            <section class="portal-leads-editor portal-leads__editor" style="display:none">
              <label for="lead-status-select">状态</label>
              <select id="lead-status-select"><option value="new">新增</option><option value="disqualified">不合格</option></select>
              <button type="button" id="save-lead">保存修改</button>
              <p id="lead-error" role="alert" style="display:none"></p>
            </section>
            <p id="lead-feedback" role="status" style="display:none"></p>`
          : '<div class="portal-leads__detail"></div>'
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`
          <!DOCTYPE html>
          <html>
          <body>
            <div class="portal-leads__filters">
              <input name="q" type="search" placeholder="搜索" />
              <button type="submit">筛选</button>
            </div>
            <div class="portal-leads__workspace">
              <div class="portal-leads__list">
                <ul>${listItems}</ul>
              </div>
              ${detail}
            </div>
            <script>
              const edit = document.getElementById('edit-lead');
              if (edit) edit.addEventListener('click', () => {
                document.querySelector('.portal-leads-editor').style.display = 'block';
              });
              const save = document.getElementById('save-lead');
              if (save) save.addEventListener('click', async () => {
                const response = await fetch('/synthetic-lead-update', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: '${selected?.email ?? ''}' })
                });
                if (!response.ok) {
                  const error = document.getElementById('lead-error');
                  error.innerText = 'Synthetic cleanup failed';
                  error.style.display = 'block';
                  return;
                }
                document.getElementById('lead-status').innerText = '不合格';
                document.querySelector('.portal-leads-editor').style.display = 'none';
                const feedback = document.getElementById('lead-feedback');
                feedback.innerText = '线索已保存。';
                feedback.style.display = 'block';
              });
            </script>
          </body>
          </html>
        `)
        return
      }

      // Synthetic Page: Website Home & Chat
      if (url.pathname === '/en' || url.pathname === '/ar') {
        const isAr = url.pathname.startsWith('/ar')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`
          <!DOCTYPE html>
          <html>
          <body>
            <div data-testid="chat-widget">
              <button type="button" id="chat-launcher">${isAr ? 'اسأل مساعد المشروع' : 'Ask our project assistant'}</button>
              <div role="dialog" aria-label="${isAr ? 'مساعد المشروع' : 'Project Assistant'}" id="chat-dialog" style="display:none;">
                <div id="messages"></div>
                <div data-testid="chat-handoff-pending" id="handoff-box" style="display:none;">
                  ${isAr ? 'تمت مشاركة طلبك مع فريق المشروع' : 'Your request has been shared with our project team.'}
                </div>
                <textarea id="chat-input" aria-label="${isAr ? 'اسأل عن الألواح أو مشروعك…' : 'Ask about panels, drawings, finishes, or your project…'}"></textarea>
                <button type="button" id="send-btn">${isAr ? 'إرسال' : 'Send'}</button>
              </div>
            </div>

            <script>
              let round = 0;
              document.getElementById('chat-launcher').addEventListener('click', async () => {
                document.getElementById('chat-dialog').style.display = 'block';
                await fetch('/api/chat/sessions', { method: 'POST' });
              });

              document.getElementById('send-btn').addEventListener('click', async () => {
                const text = document.getElementById('chat-input').value;
                if (!text) return;
                round++;
                const msgBox = document.getElementById('messages');
                const visitorMsg = document.createElement('div');
                visitorMsg.innerText = text;
                msgBox.appendChild(visitorMsg);

                await fetch('/api/chat/sessions/chat-sess-synth-1/messages', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text })
                });

                if (round < 3) {
                  const aiMsg = document.createElement('article');
                  aiMsg.setAttribute('data-author', 'assistant');
                  aiMsg.innerHTML = '<div class="chat-message-content"><p>Answer for round ' + round + '</p><div class="chat-citations">${isAr ? 'مصادر مراجَعة' : 'Reviewed sources'}</div></div>';
                  msgBox.appendChild(aiMsg);
                } else {
                  document.getElementById('handoff-box').style.display = 'block';
                  document.getElementById('chat-input').disabled = true;
                }
              });

              setInterval(async () => {
                try {
                  const res = await fetch('/api/chat/sessions/chat-sess-synth-1');
                  const data = await res.json();
                  if (data.operatorReplies && data.operatorReplies.length > 0) {
                    for (const reply of data.operatorReplies) {
                      if (!document.getElementById('op-reply-' + reply)) {
                        const opMsg = document.createElement('div');
                        opMsg.id = 'op-reply-' + reply;
                        opMsg.innerText = reply;
                        document.getElementById('messages').appendChild(opMsg);
                      }
                    }
                  }
                } catch(e) {}
              }, 1000);
            </script>
          </body>
          </html>
        `)
        return
      }

      // Synthetic Page: Portal Conversations
      if (url.pathname === '/dashboard/conversations') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`
          <!DOCTYPE html>
          <html>
          <body>
            <h2>统一会话</h2>
            <section class="portal-conversations__detail">
              <h3>官网访客 #${'chat-sess-synth-1'.slice(-6)}</h3>
              <div class="portal-conversations__timeline">
                <p>${state.chatMessages[0]?.content || ''}</p>
                <div id="timeline"></div>
              </div>
              <button type="button" id="takeover-btn">接管会话</button>
              <div id="reply-panel" style="display:none;">
                <input placeholder="输入给客户的回复…" id="operator-reply-input" />
                <button type="button" id="send-reply-btn">发送回复</button>
                <button type="button" id="resolve-btn">解决会话</button>
              </div>
              <div id="conv-status"></div>
            </section>

            <script>
              document.getElementById('takeover-btn').addEventListener('click', () => {
                document.getElementById('reply-panel').style.display = 'block';
              });
              document.getElementById('send-reply-btn').addEventListener('click', () => {
                const text = document.getElementById('operator-reply-input').value;
                const p = document.createElement('p');
                p.innerText = text;
                document.getElementById('timeline').appendChild(p);
                // record operator reply on server
                fetch('/api/chat/sessions/chat-sess-synth-1', {
                  method: 'POST',
                  body: JSON.stringify({ reply: text })
                }).catch(() => {});
              });
              document.getElementById('resolve-btn').addEventListener('click', () => {
                document.getElementById('conv-status').innerText = '已解决';
              });
            </script>
          </body>
          </html>
        `)
        return
      }

      // Synthetic Page: Feishu Public Bitable
      if (url.pathname === '/feishu-public-table') {
        const latestInquiry = state.leads.at(-1) || {
          company: 'Canary Facade Test',
          email: 'canary-test@example.invalid',
          message: '[CANARY test]',
          name: 'Canary Buyer Test',
          status: 'new' as const,
        }
        const searchControl = state.delayedFeishuSearchMs
          ? `<div id="search-slot"></div><script>
              setTimeout(() => {
                const input = document.createElement('input');
                input.type = 'search';
                input.placeholder = '搜索';
                document.getElementById('search-slot').appendChild(input);
              }, ${state.delayedFeishuSearchMs});
            </script>`
          : '<input type="search" placeholder="搜索" id="search-input" />'
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`
          <!DOCTYPE html>
          <html>
          <body>
            <button type="button">登录</button>
            ${searchControl}
            ${
              state.hideFeishuRecord
                ? ''
                : state.feishuSplitFields
                  ? `<div role="row"><div>${latestInquiry.name}</div></div>
                     <div role="row"><div>${latestInquiry.email}</div></div>
                     <div role="row"><div>${latestInquiry.company}</div></div>`
                  : `<div class="bitable-grid" role="row">
                      <div class="cell-name">${latestInquiry.name}</div>
                      <div class="cell-email">${latestInquiry.email}</div>
                      <div class="cell-company">${latestInquiry.company}</div>
                    </div>`
            }
            ${state.duplicateFeishuRecord ? `<div role="row"><div>${latestInquiry.name}</div><div>${latestInquiry.email}</div><div>${latestInquiry.company}</div></div>` : ''}
          </body>
          </html>
        `)
        return
      }

      // Handler for recording operator replies
      if (req.method === 'POST' && url.pathname === '/api/chat/sessions/chat-sess-synth-1') {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}') as { reply?: string }
          if (parsed.reply) {
            state.operatorReplies.push(parsed.reply)
            state.takenOver = true
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        })
        return
      }

      res.writeHead(404)
      res.end('Not Found')
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          serverUrl = `http://127.0.0.1:${address.port}`
        }
        resolve()
      })
    })
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(tempDir, { force: true, recursive: true }).catch(() => undefined)
  })

  test('verifies feishu public table verifier identifies records and catches blocked states', async () => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()

    try {
      const result = await verifyFeishuRecord({
        company: 'Canary Facade Test',
        email: 'canary-test@example.invalid',
        name: 'Canary Buyer Test',
        page,
        screenshotPath: join(tempDir, 'feishu-test.png'),
        tableUrl: `${serverUrl}/feishu-public-table`,
        timeoutMs: 5000,
      })

      expect(result.found).toBe(true)
      expect(result.status).toBe('PASS')
    } finally {
      await page.close()
      await browser.close()
    }
  })

  test('rejects ambiguous Feishu rows instead of accepting the first match', async () => {
    state.duplicateFeishuRecord = true
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    try {
      const result = await verifyFeishuRecord({
        company: 'Canary Facade Test',
        email: 'canary-test@example.invalid',
        name: 'Canary Buyer Test',
        page,
        tableUrl: `${serverUrl}/feishu-public-table`,
        timeoutMs: 5_000,
      })
      expect(result).toMatchObject({ found: false, status: 'FAIL_FEISHU' })
      expect(result.message).toMatch(/ambiguous/u)
    } finally {
      await browser.close()
    }
  })

  test('rejects fields split across different Feishu rows and does not capture a screenshot', async () => {
    state.feishuSplitFields = true
    const screenshotPath = join(tempDir, 'feishu-split-fields.png')
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    try {
      const result = await verifyFeishuRecord({
        company: 'Canary Facade Test',
        email: 'canary-test@example.invalid',
        name: 'Canary Buyer Test',
        page,
        screenshotPath,
        tableUrl: `${serverUrl}/feishu-public-table`,
        timeoutMs: 1_000,
      })
      expect(result).toMatchObject({ found: false, status: 'FAIL_FEISHU' })
      expect(
        await access(screenshotPath)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    } finally {
      await browser.close()
    }
  })

  test('waits for an asynchronously mounted Feishu search control', async () => {
    state.delayedFeishuSearchMs = 100
    state.hideFeishuRecord = true
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    try {
      const result = await verifyFeishuRecord({
        company: 'Canary Facade Test',
        email: 'canary-test@example.invalid',
        name: 'Canary Buyer Test',
        page,
        tableUrl: `${serverUrl}/feishu-public-table`,
        timeoutMs: 3_000,
      })
      expect(result).toMatchObject({ found: false, status: 'FAIL_FEISHU' })
      expect(result.message).toMatch(/was not visible/u)
    } finally {
      await browser.close()
    }
  })

  test('runs complete live workflow smoke against synthetic server successfully', async () => {
    const config: SmokeConfig = {
      evidenceMode: 'full',
      feishuTableUrl: `${serverUrl}/feishu-public-table`,
      headless: true,
      locales: ['en'],
      outputDir: tempDir,
      portalEmail: 'smoke@example.invalid',
      portalPassword: 'secret-password-123',
      scenario: 'all',
      targetUrl: serverUrl,
      timeoutMs: 60_000,
    }

    const { report } = await runLiveWorkflowSmoke(config, 'canary-test-synthetic-123')
    expect(report.overallStatus).toBe('PASS')
    expect(report.scenarios.inquiry?.status).toBe('PASS')
    expect(report.scenarios.chat?.status).toBe('PASS')
    expect(report.evidence).toHaveLength(7)
    expect(state.inquiries.length).toBeGreaterThan(0)
    expect(state.inquiries[0]?.company).toBe('Canary Facade canary-test-synthetic-123')
  })

  test('compact evidence omits successful visitor screenshots but keeps final chain proof', async () => {
    const config: SmokeConfig = {
      evidenceMode: 'compact',
      feishuTableUrl: `${serverUrl}/feishu-public-table`,
      headless: true,
      locales: ['en'],
      outputDir: tempDir,
      portalEmail: 'smoke@example.invalid',
      portalPassword: 'secret-password-123',
      scenario: 'inquiry',
      targetUrl: serverUrl,
      timeoutMs: 30_000,
    }

    const { report } = await runLiveWorkflowSmoke(config, 'canary-test-compact-evidence')
    expect(report.overallStatus).toBe('PASS')
    expect(report.evidence.map((path) => path.split('/').at(-1)).sort()).toEqual([
      'inquiry-feishu-en.png',
      'inquiry-portal-lead-en.png',
    ])
  })

  test('captures Feishu failure evidence and marks the exact Canary Lead disqualified', async () => {
    state.duplicateFeishuRecord = true
    const config: SmokeConfig = {
      evidenceMode: 'compact',
      feishuTableUrl: `${serverUrl}/feishu-public-table`,
      headless: true,
      locales: ['en'],
      outputDir: tempDir,
      portalEmail: 'smoke@example.invalid',
      portalPassword: 'secret-password-123',
      scenario: 'inquiry',
      targetUrl: serverUrl,
      timeoutMs: 10_000,
    }

    const { report } = await runLiveWorkflowSmoke(config, 'canary-test-feishu-failure')
    expect(report.overallStatus).toBe('FAIL_FEISHU')
    expect(report.evidence.some((path) => path.endsWith('inquiry-feishu-failure-en.png'))).toBe(
      true,
    )
    expect(state.leads).toHaveLength(1)
    expect(state.leads[0]?.status).toBe('disqualified')
  })

  test('captures Portal failure evidence without accepting duplicate leads', async () => {
    state.duplicatePortalLead = true
    const config: SmokeConfig = {
      evidenceMode: 'compact',
      feishuTableUrl: `${serverUrl}/feishu-public-table`,
      headless: true,
      locales: ['en'],
      outputDir: tempDir,
      portalEmail: 'smoke@example.invalid',
      portalPassword: 'secret-password-123',
      scenario: 'inquiry',
      targetUrl: serverUrl,
      timeoutMs: 5_000,
    }

    const { report } = await runLiveWorkflowSmoke(config, 'canary-test-portal-failure')
    expect(report.overallStatus).toBe('FAIL_PORTAL')
    expect(
      report.evidence.some((path) => path.endsWith('inquiry-portal-lead-failure-en.png')),
    ).toBe(true)
  })

  test('classifies denied and failed Portal Lead cleanup separately', async () => {
    const baseConfig: SmokeConfig = {
      evidenceMode: 'compact',
      feishuTableUrl: `${serverUrl}/feishu-public-table`,
      headless: true,
      locales: ['en'],
      outputDir: tempDir,
      portalEmail: 'smoke@example.invalid',
      portalPassword: 'secret-password-123',
      scenario: 'inquiry',
      targetUrl: serverUrl,
      timeoutMs: 5_000,
    }

    state.denyLeadCleanup = true
    const denied = await runLiveWorkflowSmoke(baseConfig, 'canary-test-cleanup-denied')
    expect(denied.report.cleanup.status).toBe('SKIPPED')

    state.denyLeadCleanup = false
    state.failLeadCleanup = true
    const failed = await runLiveWorkflowSmoke(baseConfig, 'canary-test-cleanup-failed')
    expect(failed.report.cleanup.status).toBe('FAILED')
    expect(failed.report.overallStatus).toBe('CLEANUP_FAILED')
  })

  test('fails before any Portal write when the browser response has no session ID', async () => {
    state.omitSessionId = true
    const config: SmokeConfig = {
      evidenceMode: 'compact',
      feishuTableUrl: `${serverUrl}/feishu-public-table`,
      headless: true,
      locales: ['en'],
      outputDir: tempDir,
      portalEmail: 'smoke@example.invalid',
      portalPassword: 'secret-password-123',
      scenario: 'chat',
      targetUrl: serverUrl,
      timeoutMs: 10_000,
    }

    const { report } = await runLiveWorkflowSmoke(config, 'canary-test-missing-session')
    expect(report.scenarios.chat?.status).toBe('FAIL_WEBSITE')
    expect(report.scenarios.chat?.runs[0]?.error).toMatch(/did not include a session ID/u)
    expect(state.takenOver).toBe(false)
    expect(state.operatorReplies).toHaveLength(0)
  })

  test('enforces the configured overall timeout', async () => {
    state.inquiryResponseDelayMs = 5_000
    const config: SmokeConfig = {
      evidenceMode: 'compact',
      feishuTableUrl: `${serverUrl}/feishu-public-table`,
      headless: true,
      locales: ['en'],
      outputDir: tempDir,
      portalEmail: 'smoke@example.invalid',
      portalPassword: 'secret-password-123',
      scenario: 'inquiry',
      targetUrl: serverUrl,
      timeoutMs: 500,
    }

    const startedAt = Date.now()
    const { report } = await runLiveWorkflowSmoke(config, 'canary-test-timeout')
    expect(Date.now() - startedAt).toBeLessThan(4_000)
    expect(report.scenarios.inquiry?.status).toBe('FAIL_WEBSITE')
    expect(report.scenarios.inquiry?.runs[0]?.error).toMatch(/overall timeout/u)
  })
})

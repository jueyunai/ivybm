import { createServer } from 'node:http'

const port = Number(process.env.IVYBM_E2E_AI_PROVIDER_PORT)
const token = process.env.IVYBM_E2E_LAUNCH_TOKEN?.trim() ?? ''
if (
  process.env.IVYBM_E2E_MODE !== 'mutation' ||
  process.env.IVYBM_E2E_EXTERNAL_SIDE_EFFECTS !== 'deny' ||
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65_535 ||
  !/^[a-f0-9]{64}$/u.test(token)
) {
  throw new Error('AI provider stub requires an authenticated mutation E2E launch')
}

let requestCount = 0

const respond = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

const readJSON = async (request) => {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1_000_000) throw new Error('request too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    respond(response, 200, { status: 'ready' })
    return
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    respond(response, 401, { error: { message: 'unauthorized' } })
    return
  }

  try {
    const body = await readJSON(request)
    requestCount += 1
    response.setHeader('x-request-id', `e2e-ai-${process.env.IVYBM_E2E_RUN_ID}-${requestCount}`)

    if (request.method === 'POST' && request.url === '/v1/embeddings') {
      const input = Array.isArray(body.input) ? body.input : []
      respond(response, 200, {
        data: input.map((_value, index) => ({ embedding: [1, 0, 0], index })),
        model: body.model,
        usage: {
          prompt_tokens: Math.max(input.length, 1),
          total_tokens: Math.max(input.length, 1),
        },
      })
      return
    }

    if (request.method === 'POST' && request.url === '/v1/responses') {
      const input = typeof body.input === 'string' ? body.input : ''
      const arabic = /[\u0600-\u06ff]/u.test(input)
      respond(response, 200, {
        model: body.model,
        output: [
          {
            content: [
              {
                text: arabic
                  ? 'تؤكد المعرفة المراجعة توفر حلول ألواح الألمنيوم للمشروع.'
                  : 'Reviewed knowledge confirms suitable aluminum panel options for this project.',
                type: 'output_text',
              },
            ],
          },
        ],
        usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
      })
      return
    }

    respond(response, 404, { error: { message: 'unsupported fixture operation' } })
  } catch {
    respond(response, 400, { error: { message: 'invalid fixture request' } })
  }
})

server.listen(port, '127.0.0.1')

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)))
}

import type { Context } from 'hono'

const VERSION = '1.16.1'
const SERVER_TYPE = 'tinggui'
const SERVER_VERSION = '0.1.0'

/**
 * 成功信封。body 的字段并进 subsonic-response，不另包一层。
 * HTTP 仍是 200：客户端看的是信封里的 status，不是状态码。
 */
export function sendOk(
  c: Context,
  body: Record<string, unknown>,
  format: 'json' | 'xml',
): Response {
  return send(c, envelope('ok', body), format)
}

/** 失败信封。code 是 Subsonic 错误码，放进 error，不拿来当 HTTP 状态。 */
export function sendErr(
  c: Context,
  code: number,
  message: string,
  format: 'json' | 'xml',
): Response {
  return send(c, envelope('failed', { error: { code, message } }), format)
}

function envelope(
  status: 'ok' | 'failed',
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    'subsonic-response': {
      status,
      version: VERSION,
      type: SERVER_TYPE,
      serverVersion: SERVER_VERSION,
      ...extra,
    },
  }
}

function send(c: Context, payload: Record<string, unknown>, format: 'json' | 'xml'): Response {
  if (format === 'json') {
    return c.body(JSON.stringify(payload), 200, {
      'Content-Type': 'application/json; charset=UTF-8',
    })
  }
  const [rootName, rootValue] = Object.entries(payload)[0]
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>${renderNode(rootName, rootValue)}`, 200, {
    'Content-Type': 'text/xml; charset=UTF-8',
  })
}

/**
 * Subsonic 的 JSON 和 XML 是同一棵树：标量当属性，对象和数组当同名子元素。
 * 文本要转义，歌名和错误信息里会有 &、<、引号。
 * line 和 lyrics 的 value 在 JSON 里仍是字段，XML 里必须是元素正文，否则客户端读不到歌词。
 */
function renderNode(name: string, value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => renderNode(name, item)).join('')
  if (value !== null && typeof value === 'object') {
    const attrs: string[] = []
    const children: string[] = []
    let text: string | undefined
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child === null || child === undefined) continue
      if ((name === 'line' || name === 'lyrics') && key === 'value' && typeof child === 'string') {
        text = escapeXml(child)
        continue
      }
      if (typeof child === 'object') children.push(renderNode(key, child))
      else attrs.push(`${key}="${escapeXml(String(child))}"`)
    }
    const attrText = attrs.length > 0 ? ` ${attrs.join(' ')}` : ''
    if (text === undefined && children.length === 0) return `<${name}${attrText}/>`
    return `<${name}${attrText}>${text ?? ''}${children.join('')}</${name}>`
  }
  return `<${name}>${escapeXml(value == null ? '' : String(value))}</${name}>`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

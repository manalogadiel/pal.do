// Pal's cloud brain for everyone, on free tiers only. The keys live here (Vercel env vars), never in the app.
//
// Chat goes to Groq's free models; "gemini" goes to Google's free Gemini Flash-Lite. The app tries them in order and
// skips any that answer 429, so when one free quota runs out the next takes over, and when all are out the app
// answers with its own rules (and, on Android, the model on the phone).
//
// Every user shares the same free quota, so each device gets a daily allowance (needs a free Upstash Redis;
// without one there's no cap). A device over it gets a Groq-style 429 that says when it resets.

const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_AUDIO = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GEMINI_CHAT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
/** Only the models the app uses, so a leaked proxy URL can't be pointed at anything else */
const GROQ_MODELS = new Set(['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
const EFFORT = new Set(['none', 'low', 'medium'])
const STT_MODEL = 'whisper-large-v3-turbo'
const MAX_TOKENS = 500
const MAX_BODY = 32_000 // bytes: prompt + a few turns of history fits well under this
const MAX_AUDIO = 600_000 // bytes: ~18s of 16kHz mono WAV; the app caps commands at 15s
const DEVICE_DAILY = Number(process.env.PAL_DEVICE_DAILY ?? 40) // AI replies per device per day
const IP_DAILY = Number(process.env.PAL_IP_DAILY ?? 200) // per network: stops one script inventing device ids
const AUDIO_DAILY = Number(process.env.PAL_AUDIO_DAILY ?? 60)

export interface CloudKeys { groq?: string; gemini?: string }
const serverKeys = (): CloudKeys => ({ groq: process.env.GROQ_API_KEY, gemini: process.env.GEMINI_API_KEY })

/** Configuration only; never return a credential to the browser or APK. */
export function cloudStatus(req: Request, keys: CloudKeys = serverKeys()): Response {
  const c = cors(req)
  return json(c.ok ? 200 : 403, c.ok ? { configured: Boolean(keys.groq || keys.gemini) } : { error: 'Origin not allowed' }, { ...c.headers, 'Cache-Control': 'no-store' })
}

function allowedOrigins() {
  // Same-origin web requests carry the deployment's own origin; Capacitor's Android WebView is https://localhost
  return (process.env.ALLOWED_ORIGINS ?? 'https://localhost,http://localhost:8443,http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean)
}

export function cors(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  const self = new URL(req.url).origin
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
  // No Origin header = same-origin GET-style request from the deployed page itself
  const ok = !origin || origin === self || origin === vercel || allowedOrigins().includes(origin)
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': ok && origin ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Pal-Device',
      Vary: 'Origin',
    } as Record<string, string>,
  }
}

export function preflight(req: Request) {
  const c = cors(req)
  return new Response(null, { status: c.ok ? 204 : 403, headers: c.headers })
}

const json = (status: number, body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })

/* ---------- Per-device daily allowance (Upstash Redis REST, or Vercel KV which speaks the same API) ---------- */
const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? ''
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? ''

async function countToday(key: string, signal?: AbortSignal): Promise<number | null> {
  const url = redisUrl(), token = redisToken()
  if (!url || !token) return null
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, 2 * 86400]]),
    })
    if (!res.ok) return null
    const out = (await res.json()) as { result: number }[]
    return Number(out[0]?.result ?? 0)
  } catch {
    return null // a Redis hiccup never blocks a reply
  }
}

/** Over today's allowance: a 429 shaped like Groq's, so the app shows "simple answers until about …" */
export async function overLimit(req: Request, kind: 'chat' | 'audio', signal?: AbortSignal): Promise<{ wait: string } | null> {
  const day = new Date().toISOString().slice(0, 10)
  const device = (req.headers.get('X-Pal-Device') ?? '').replace(/[^\w-]/g, '').slice(0, 64) || 'none'
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const [d, n] = await Promise.all([countToday(`pal:${kind}:${day}:d:${device}`, signal), countToday(`pal:${kind}:${day}:ip:${ip}`, signal)])
  const deviceMax = kind === 'chat' ? DEVICE_DAILY : AUDIO_DAILY
  if ((d != null && d > deviceMax) || (n != null && n > IP_DAILY)) {
    const now = new Date()
    const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()
    const h = Math.floor(reset / 3_600_000), m = Math.ceil((reset % 3_600_000) / 60_000)
    return { wait: `${h}h${m}m0s` }
  }
  return null
}

/* ---------- Chat ---------- */
export async function chat(req: Request, keys: CloudKeys = serverKeys()): Promise<Response> {
  const c = cors(req)
  if (!c.ok) return new Response('Origin not allowed', { status: 403, headers: c.headers })
  const raw = await req.text()
  if (raw.length > MAX_BODY) return new Response('Too large', { status: 413, headers: c.headers })
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return new Response('Bad JSON', { status: 400, headers: c.headers })
  }
  const model = String(body.model ?? '')
  const gemini = model === 'gemini'
  if (!gemini && !GROQ_MODELS.has(model)) return new Response('Model not allowed', { status: 400, headers: c.headers })
  const key = gemini ? keys.gemini : keys.groq
  // Not set up: an error, not a 429, so the app just moves on to its next model
  if (!key) return json(503, { error: { message: `${gemini ? 'Gemini' : 'Groq'} is not configured on this server` } }, c.headers)

  const limited = await overLimit(req, 'chat')
  if (limited) return json(429, { error: { message: `Pal's free daily limit for this device is used up (RPD). Please try again in ${limited.wait}.` } }, c.headers)

  const upstream = await fetch(gemini ? GEMINI_CHAT : GROQ_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: gemini ? process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite' : model,
      messages: body.messages,
      temperature: Math.min(Number(body.temperature) || 0.7, 1),
      max_tokens: Math.min(Number(body.max_tokens) || 400, MAX_TOKENS),
      response_format: body.response_format,
      ...(!gemini && EFFORT.has(String(body.reasoning_effort)) ? { reasoning_effort: body.reasoning_effort } : {}),
    }),
  })
  if (gemini && upstream.status === 429) {
    // Gemini's quota errors don't say "per day" the way Groq's do: say it, so the app rests this model long enough
    const text = await upstream.text()
    const daily = /per ?day|PerDay|daily/i.test(text)
    const retry = text.match(/retry in ([\d.]+)s/i)?.[1]
    return json(429, { error: { message: `Gemini rate limit${daily ? ' (RPD)' : ''}. Please try again in ${retry ? `${retry}s` : daily ? '1h0m0s' : '30s'}.` } }, c.headers)
  }
  return new Response(upstream.body, { status: upstream.status, headers: { ...c.headers, 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' } })
}

/* ---------- Voice: one spoken command after "Hi {pal}", written out by Groq's Whisper ---------- */
export async function audio(req: Request, key = process.env.GROQ_API_KEY): Promise<Response> {
  const c = cors(req)
  if (!c.ok) return new Response('Origin not allowed', { status: 403, headers: c.headers })
  if (!key) return json(503, { error: { message: 'Groq is not configured on this server' } }, c.headers)
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') return new Response('No audio', { status: 400, headers: c.headers })
  if (file.size > MAX_AUDIO) return new Response('Too large', { status: 413, headers: c.headers })
  const limited = await overLimit(req, 'audio')
  if (limited) return json(429, { error: { message: `Voice limit for this device is used up (RPD). Please try again in ${limited.wait}.` } }, c.headers)
  const out = new FormData()
  out.append('file', file, 'speech.wav')
  out.append('model', STT_MODEL)
  out.append('response_format', 'json')
  out.append('temperature', '0')
  const prompt = form!.get('prompt')
  if (typeof prompt === 'string' && prompt.length < 300) out.append('prompt', prompt)
  const upstream = await fetch(GROQ_AUDIO, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: out })
  return new Response(upstream.body, { status: upstream.status, headers: { ...c.headers, 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' } })
}

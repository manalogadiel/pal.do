// Cloudflare Worker: forwards chat requests to Groq with a server-side key,
// so the key never ships inside the web build or the Android APK.
//
// Deploy (one time):
//   cd proxy
//   npx wrangler secret put GROQ_API_KEY     # paste your gsk_... key
//   npx wrangler deploy
// Then set VITE_GROQ_PROXY_URL=https://paldo-groq.<you>.workers.dev in .env and rebuild.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
// Only the models the app uses, so a leaked proxy URL can't be pointed at pricier ones
const MODELS = new Set(['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
const EFFORT = new Set(['none', 'low', 'medium'])
const MAX_TOKENS = 500
const MAX_BODY = 32_000 // bytes: prompt + 8 turns of history fits well under this
// Hands-free voice: one spoken command after "Hi {pal}", transcribed by Groq's Whisper
const AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const STT_MODEL = 'whisper-large-v3-turbo'
const MAX_AUDIO = 600_000 // bytes: ~18s of 16kHz mono WAV, the app caps commands at 15s

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || ''
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
    const ok = allowed.includes(origin)
    const cors = {
      'Access-Control-Allow-Origin': ok ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: cors })
    if (!ok) return new Response('Origin not allowed', { status: 403, headers: cors })
    if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: cors })

    // POST /audio: multipart { file, prompt? }. The model is fixed here, whatever the client sends.
    if (new URL(req.url).pathname.replace(/\/$/, '').endsWith('/audio')) {
      const form = await req.formData().catch(() => null)
      const file = form?.get('file')
      if (!file || typeof file === 'string') return new Response('No audio', { status: 400, headers: cors })
      if (file.size > MAX_AUDIO) return new Response('Too large', { status: 413, headers: cors })
      const out = new FormData()
      out.append('file', file, 'speech.wav')
      out.append('model', STT_MODEL)
      out.append('response_format', 'json')
      out.append('temperature', '0')
      const prompt = form.get('prompt')
      if (typeof prompt === 'string' && prompt.length < 300) out.append('prompt', prompt)
      const upstream = await fetch(AUDIO_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, body: out })
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
      })
    }

    const raw = await req.text()
    if (raw.length > MAX_BODY) return new Response('Too large', { status: 413, headers: cors })
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      return new Response('Bad JSON', { status: 400, headers: cors })
    }
    if (!MODELS.has(body.model)) return new Response('Model not allowed', { status: 400, headers: cors })

    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        temperature: Math.min(Number(body.temperature) || 0.7, 1),
        max_tokens: Math.min(Number(body.max_tokens) || 400, MAX_TOKENS),
        response_format: body.response_format,
        ...(EFFORT.has(body.reasoning_effort) ? { reasoning_effort: body.reasoning_effort } : {}),
      }),
    })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
    })
  },
}

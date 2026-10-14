// POST /tts (rewritten here by vercel.json): Pal's voice, from Microsoft Edge's free neural voices. The same service
// as services/tts/server.py (which dev uses), for the deployed site where only api/ functions run.
// Body { pal, text } → audio/mpeg. Any failure is an error status, and the app falls back to the device's own voice.
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

const PROFILE: Record<string, { voice: string; rate: string; pitch: string }> = {
  rei: { voice: 'en-PH-RosaNeural', rate: '-2%', pitch: '-2Hz' },
  diel: { voice: 'fil-PH-AngeloNeural', rate: '+2%', pitch: '-1Hz' },
  jhyvie: { voice: 'fil-PH-BlessicaNeural', rate: '+4%', pitch: '+3Hz' },
  jaypee: { voice: 'en-PH-JamesNeural', rate: '-3%', pitch: '-3Hz' },
}
const MAX_TEXT = 2000
const MAX_AUDIO = 8 * 1024 * 1024
const TIMEOUT_MS = 10_000
const PER_MINUTE = 30 // per IP, per warm instance (the ingress limit is Vercel's own)
const ANDROID = ['http://localhost', 'https://localhost', 'capacitor://localhost']

const recent = new Map<string, number[]>()
function allow(ip: string) {
  const now = Date.now()
  if (recent.size > 4096) for (const [k, v] of recent) if (!v.length || v[v.length - 1] < now - 60_000) recent.delete(k)
  const hits = (recent.get(ip) ?? []).filter((t) => t > now - 60_000)
  if (hits.length >= PER_MINUTE) return false
  hits.push(now)
  recent.set(ip, hits)
  return true
}

/** The deployed site itself, or the Android app's WebView */
function originOk(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
  return !origin || origin === new URL(req.url).origin || origin === vercel || ANDROID.includes(origin)
}

function headers(req: Request, extra: Record<string, string> = {}) {
  const h: Record<string, string> = { 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'no-store', ...extra }
  const origin = req.headers.get('Origin')
  if (origin && ANDROID.includes(origin)) Object.assign(h, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' })
  return h
}
const fail = (req: Request, status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: headers(req, { 'Content-Type': 'application/json' }) })

// The text goes inside SSML: never let it add tags
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

async function synthesize(pal: string, text: string) {
  const p = PROFILE[pal]
  const tts = new MsEdgeTTS()
  try {
    await tts.setMetadata(p.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = tts.toStream(escapeXml(text), { rate: p.rate, pitch: p.pitch })
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of audioStream) {
      chunks.push(chunk as Buffer)
      size += (chunk as Buffer).length
      if (size > MAX_AUDIO) throw new Error('audio too large')
    }
    if (!size) throw new Error('no audio')
    return Buffer.concat(chunks)
  } finally {
    tts.close()
  }
}

export const OPTIONS = (req: Request) => (originOk(req) ? new Response(null, { status: 204, headers: headers(req) }) : fail(req, 403, 'origin'))

export async function POST(req: Request) {
  if (!originOk(req)) return fail(req, 403, 'origin')
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  if (!allow(ip)) return fail(req, 429, 'Too many requests')
  let pal: unknown, text: unknown
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object') throw new Error()
    ;({ pal, text } = body as Record<string, unknown>)
  } catch {
    return fail(req, 400, 'Expected pal and text in body')
  }
  if (typeof pal !== 'string' || !PROFILE[pal]) return fail(req, 400, 'Unknown pal')
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return fail(req, 400, 'Text must contain 1–2000 characters')
  try {
    const audio = await Promise.race([synthesize(pal, text.trim()), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))])
    // Never log spoken content
    return new Response(new Uint8Array(audio), { status: 200, headers: headers(req, { 'Content-Type': 'audio/mpeg' }) })
  } catch {
    return fail(req, 502, 'Speech unavailable')
  }
}

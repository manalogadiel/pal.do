import type { PalId } from './core'
import { BLOCKED_OUTPUT } from './agent'
import { relativeDays } from './context'
import { AI_ACTIONS, PAL_NAME, toLocalIso, type AiResponse, type ChatTurn } from './groq'

export const WEB_LLM_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
export const FALLBACK_WEB_LLM_MODEL = 'SmolLM2-360M-Instruct-q4f16_1-MLC'

let enginePromise: Promise<any> | null = null
let engineInstance: any = null
let loadProgressCallback: ((progress: number, text: string) => void) | null = null

export function setWebLlmProgressHandler(handler: ((progress: number, text: string) => void) | null) {
  loadProgressCallback = handler
}

/** Check if current browser device supports WebGPU */
export async function isWebGpuSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !(navigator as any).gpu) return false
  try {
    const adapter = await (navigator as any).gpu.requestAdapter()
    return Boolean(adapter)
  } catch {
    return false
  }
}

/** True when the model files are already in the browser cache, so loading costs no data. */
export async function isModelCached(): Promise<boolean> {
  try {
    const { hasModelInCache } = await import('@mlc-ai/web-llm')
    return await hasModelInCache(WEB_LLM_MODEL)
  } catch {
    return false
  }
}

/** Lazily load the in-browser WebLLM engine */
export async function getWebLlmEngine() {
  if (engineInstance) return engineInstance
  if (enginePromise) return enginePromise

  enginePromise = (async () => {
    try {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm')
      const engine = await CreateMLCEngine(
        WEB_LLM_MODEL,
        {
          initProgressCallback: (report) => {
            if (loadProgressCallback) {
              loadProgressCallback(report.progress, report.text)
            }
          },
        }
      )
      engineInstance = engine
      return engine
    } catch (err) {
      console.warn('[web-llm] Failed to initialize WebLLM engine:', err)
      enginePromise = null
      return null
    }
  })()

  return enginePromise
}

/** Short prompt with concrete examples: small models copy schema placeholders from long prompts. */
function compactPrompt(pal: PalId, facts: string, now: number): string {
  const tmrw = toLocalIso(now + 86400000).slice(0, 10)
  return `You are ${PAL_NAME[pal]}, a friendly student planner buddy. Reply in short casual Taglish/English (1-2 sentences).
You only help with planning, schedules, study time, and today's time/weather. If asked anything else, kindly say it's not your thing and suggest one planning step instead, in your own words (action "redirect").
You can't change the calendar yourself: every change is a card the user says yes to. Never say something is added, removed or moved.
Facts (never invent others): ${facts}
Days: ${relativeDays(now)}.
Output ONLY JSON.
User: "lagay mo bukas 3pm study"
{"text":"Sige! Study bukas 3pm, okay ba?","action":{"type":"addEvent","title":"Study Session","kind":"work","start":"${tmrw}T15:00:00","end":"${tmrw}T16:00:00"}}
User: "cancel mo yung org meeting"
{"text":"Eto yung org meeting, tap Remove kung yan nga.","action":{"type":"removeEvent","id":"e2"}}
(card WAITING) User: "sige push mo na"
{"text":"Ayan, sige!","action":{"type":"confirmEvent"}}
(card WAITING) User: "wag na"
{"text":"Okay, di ko na itutuloy.","action":{"type":"skipEvent"}}
User: "who is the president of france"
{"text":"Hala, di ko yan forte! Pero gusto mo i-plan natin yung free time mo later?","action":{"type":"redirect"}}
User: "hi bosing"
{"text":"Uy! Anong plano mo ngayong week?","action":{"type":"none"}}`
}

/** Ask the in-browser WebLLM model directly in the client */
export async function askWebLlm(
  prompt: string,
  pal: PalId,
  history: ChatTurn[] = [],
  facts = '',
  now = Date.now()
): Promise<AiResponse | null> {
  try {
    // Not loaded: the rules answer. Loading is the app's call (already cached, or the user asked), never a
    // surprise ~1GB download on mobile data just because a message came in.
    if (!engineInstance) return null
    const engine = engineInstance

    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
    const reply: any = await Promise.race([timeout, engine.chat.completions.create({
      messages: [
        { role: 'system', content: compactPrompt(pal, facts, now) },
        ...history.slice(-4).map(({ role, content }) => ({ role, content })), // small context window: keep it short
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 350,
      response_format: { type: 'json_object' },
    })])

    const content = reply.choices?.[0]?.message?.content
    if (!content) return null

    let cleanContent = content.trim()
    if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    }

    const parsed = JSON.parse(cleanContent) as AiResponse
    if (parsed.text && BLOCKED_OUTPUT.test(parsed.text)) {
      console.warn('[web-llm] Output blocked by safety guardrail:', parsed.text)
      return null
    }
    if (parsed.action && typeof parsed.action === 'object') {
      if (!(AI_ACTIONS as readonly string[]).includes(parsed.action.type)) {
        parsed.action = { type: 'none' }
      }
    }
    return { ...parsed, modelUsed: 'In-Browser Qwen2.5-1.5B (WebGPU)' }
  } catch (err) {
    console.warn('[web-llm] Execution failed:', err)
    return null
  }
}

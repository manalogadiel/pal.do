import { registerPlugin } from '@capacitor/core'
import type { ChatTurn } from './groq'

export interface NativeMessage { role: 'system' | 'user' | 'assistant'; content: string; required: boolean; priority: number }
export interface NativeStatus { available: boolean; loaded: boolean; architecture: string; model?: { name: string; bytes: number; sha256: string }; setup?: { bytes: number; total: number; stage: 'copying' | 'checking' } }
export interface NativeReply { requestId: string; text: string; loadMs: number; firstTokenMs: number; generationMs: number; promptTokens: number; generatedTokens: number }
export interface NativePlugin {
  status(): Promise<NativeStatus>
  setupModel?(): Promise<NativeStatus>
  importModel(): Promise<NativeStatus>
  load(): Promise<NativeStatus>
  generate(options: { requestId: string; messages: NativeMessage[]; maxTokens: number }): Promise<NativeReply>
  cancel(options: { requestId: string }): Promise<void>
  unload(): Promise<void>
}
export const LocalAi = registerPlugin<NativePlugin>('LocalAi')
export interface NativeClient { generate(messages: NativeMessage[], signal?: AbortSignal): Promise<string>; prepare?(): Promise<NativeStatus | null> }
export const nativeError = (code: string) => Object.assign(new Error(code), { code })
const encodedSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

export function prepareNativeMessages(system: string, history: ChatTurn[], user: string, facts: string): NativeMessage[] {
  const factLines = facts.split('\n')
  const mandatory = factLines.filter((line) => /WAITING FOR THE USER|^- The user is|^- Now:|User preferences|Task being set up/.test(line))
  const optionalFacts = factLines.filter((line) => !mandatory.includes(line)).join('\n')
  const required: NativeMessage[] = [{ role: 'system', content: [system, ...mandatory].join('\n'), required: true, priority: 100 }, { role: 'user', content: user, required: true, priority: 100 }]
  if (encodedSize(required) > 64 * 1024) throw nativeError('PROMPT_TOO_LONG')
  const optional: NativeMessage[] = [
    ...(optionalFacts ? [{ role: 'system' as const, content: optionalFacts, required: false, priority: 20 }] : []),
    ...history.slice(-8).map((h, i) => ({ role: h.role, content: h.role === 'assistant' ? JSON.stringify({ text: h.content, action: h.action ?? { type: 'none' }, outcome: h.outcome }) : h.content, required: false, priority: i + 1 })),
  ]
  const messages = () => [required[0], ...optional, required[1]]
  while (encodedSize(messages()) > 64 * 1024 && optional.length) {
    const lowest = Math.min(...optional.map((m) => m.priority))
    optional.splice(optional.findIndex((m) => m.priority === lowest), 1)
  }
  return messages()
}

export function createNativeClient(plugin: NativePlugin): NativeClient {
  let preparing: Promise<NativeStatus | null> | null = null
  const prepare = () => {
    if (!preparing) preparing = (plugin.setupModel ? plugin.setupModel() : Promise.resolve(null)).finally(() => { preparing = null })
    return preparing
  }
  return {
    prepare,
    async generate(messages, signal) {
      if (signal?.aborted) throw nativeError('CANCELLED')
      await prepare()
      if (signal?.aborted) throw nativeError('CANCELLED')
      const requestId = crypto.randomUUID()
      const cancel = () => { void plugin.cancel({ requestId }).catch(() => {}) }
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        const reply = await plugin.generate({ requestId, messages, maxTokens: 256 })
        if (signal?.aborted || reply.requestId !== requestId) throw nativeError('CANCELLED')
        if (typeof reply.text !== 'string' || reply.text.length > 32768) throw nativeError('INFERENCE_FAILED')
        return reply.text
      } finally { signal?.removeEventListener('abort', cancel) }
    },
  }
}
export const phoneAi = createNativeClient(LocalAi)

export function automaticModelSetup(prepare: () => Promise<unknown>, visible: () => boolean, schedule: (retry: () => void) => () => void = (retry) => { const timer = setTimeout(retry, 250); return () => clearTimeout(timer) }) {
  let stopped = false; let running = false; let cancelRetry: (() => void) | undefined
  const start = () => {
    if (stopped || running || !visible()) return
    cancelRetry?.(); cancelRetry = undefined; running = true
    void prepare().catch((error: { code?: string }) => {
      if (!stopped && visible() && error?.code === 'CANCELLED') cancelRetry = schedule(start)
    }).finally(() => { running = false })
  }
  return { start, stop: () => { stopped = true; cancelRetry?.() } }
}

export function nativeErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    MISSING_MODEL: 'Offline AI needs a model. Open Settings to import a model or retry automatic setup.',
    UNSUPPORTED_ARCH: 'This preview needs a phone with a 64-bit ARM processor.',
    INVALID_MODEL: 'This model file could not be opened. Import the supported Qwen GGUF file.',
    INSUFFICIENT_SPACE: 'There is not enough free space to import this model safely.',
    BUSY: 'The previous reply is still stopping. Please try again in a moment.',
    LOAD_FAILED: 'The offline model could not load. Close other apps and try again.',
    CANCELLED: 'Reply cancelled.',
    PROMPT_TOO_LONG: 'That request is too long for the phone model. Please shorten it.',
    INFERENCE_FAILED: 'The phone model could not finish that reply. Please try again.',
  }
  return messages[code] ?? 'Offline AI is unavailable. Check the model in Settings.'
}

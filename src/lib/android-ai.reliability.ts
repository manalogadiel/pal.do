import { askGroq, recoverEvent, getNativeFailure } from './groq'

export async function runAndroidAiTests() {
  const failures: string[] = []
  let count = 0
  const check = async (name: string, test: () => unknown) => {
    count++
    try { if (!await test()) failures.push(name) } catch (error) { failures.push(`${name}: ${String(error)}`) }
  }
  const originalFetch = globalThis.fetch
  let fetches = 0
  let nativeCalls = 0
  const client = {
    generate: async () => { nativeCalls++; return '{"text":"Hello! How can I help you plan?","action":{"type":"none"}}' },
  }
  globalThis.fetch = async () => { fetches++; throw new Error('No network in isolated checks') }
  const ask = (provider: string, extra = {}) => askGroq('hello', 'rei', 'fixture-key', new Date(2026, 9, 12, 9).getTime(), [], { full: '' }, false, { provider, nativeClient: client, ...extra } as never)
  try {
    await check('offline_never_fetches', async () => {
      fetches = 0; nativeCalls = 0
      const result = await ask('native')
      return fetches === 0 && nativeCalls === 1 && result?.text === 'Hello! How can I help you plan?'
    })
    await check('online_never_calls_native', async () => { nativeCalls = 0; await ask('cloud'); return nativeCalls === 0 })
    await check('native_recovery_never_fetches', async () => {
      fetches = 0
      const result = await recoverEvent([{ role: 'user', content: 'add seminar' }], Date.now(), 'fixture-key', 'native' as never)
      return result === null && fetches === 0
    })
    await check('invalid_native_reply_has_no_action', async () => await ask('native', { nativeClient: { generate: async () => '{"text":"Review","action":{"type":"findTime","hours":"two"}}' } }) === null)
    await check('aborted_request_never_starts', async () => {
      const controller = new AbortController(); controller.abort(); nativeCalls = 0; fetches = 0
      await ask('native', { signal: controller.signal })
      return nativeCalls === 0 && fetches === 0
    })
    const budgetModule = await import('./native-ai').catch(() => null)
    await check('foreground_setup_retries_after_cancelled_attempt_settles', async () => {
      const start = (budgetModule as unknown as { automaticModelSetup?: (prepare: () => Promise<unknown>, visible: () => boolean, schedule: (retry: () => void) => () => void) => { start: () => void; stop: () => void } })?.automaticModelSetup
      if (!start) return false
      let calls = 0; let finish: (error: unknown) => void = () => {}; const retries: (() => void)[] = []
      const setup = start(() => { calls++; return calls === 1 ? new Promise((_, reject) => { finish = reject }) : Promise.resolve(null) }, () => true, (retry) => { retries.push(retry); return () => {} })
      setup.start(); setup.start(); finish({ code: 'CANCELLED' }); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
      if (calls !== 1 || retries.length !== 1) return false
      retries[0](); await Promise.resolve(); setup.stop(); return Number(calls) === 2
    })
    await check('bundled_setup_is_shared_and_generation_waits', async () => {
      if (!budgetModule) return false
      let finish: (status: unknown) => void = () => {}; let setups = 0; let generated = 0
      const plugin = {
        setupModel: () => { setups++; return new Promise((resolve) => { finish = resolve }) },
        generate: async ({ requestId }: { requestId: string }) => { generated++; return { requestId, text: '{}', generatedTokens: 1 } },
        cancel: async () => {},
      }
      const native = budgetModule.createNativeClient(plugin as never) as { prepare?: () => Promise<unknown>; generate: (messages: never[]) => Promise<string> }
      if (!native.prepare) return false
      const preparing = native.prepare(); const reply = native.generate([])
      if (setups !== 1 || generated !== 0) return false
      finish({ available: true, loaded: false, architecture: 'arm64-v8a' })
      await preparing; await reply; return Number(generated) === 1
    })
    await check('fresh_install_defaults_auto_and_mode_persists', async () => {
      const { getAiMode, setAiMode } = await import('./ai-mode')
      const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
      const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
      const values = new Map<string, string>()
      try {
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } })
        Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: () => true } })
        if (getAiMode() !== 'auto') return false
        // the preview's old two-way switch carries over
        values.set('paldo.android.ai-mode', 'offline'); if (getAiMode() !== 'offline') return false
        values.delete('paldo.android.ai-mode')
        setAiMode('online'); if (getAiMode() !== 'online') return false
        setAiMode('offline'); if (getAiMode() !== 'offline') return false
        setAiMode('auto'); return getAiMode() === 'auto'
      } finally {
        if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
        else Reflect.deleteProperty(globalThis, 'localStorage')
        if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
        else Reflect.deleteProperty(globalThis, 'window')
      }
    })
    await check('missing_model_offers_import_without_network', async () => {
      fetches = 0
      const reply = await ask('native', { nativeClient: { generate: async () => { throw Object.assign(new Error('MISSING_MODEL'), { code: 'MISSING_MODEL' }) } } })
      return reply === null && fetches === 0 && getNativeFailure() === 'MISSING_MODEL' && !!budgetModule?.nativeErrorMessage('MISSING_MODEL').includes('Settings to import')
    })
    await check('missing_cloud_credentials_never_calls_native', async () => {
      nativeCalls = 0; fetches = 0
      const reply = await askGroq('hello', 'rei', '', Date.now(), [], { full: '' }, false, { provider: 'cloud', nativeClient: client })
      return reply === null && nativeCalls === 0 && fetches === 0
    })
    await check('budget_keeps_current_constraints', () => {
      if (!budgetModule) return false
      const messages = budgetModule.prepareNativeMessages('Rules and Seminar today', [{ role: 'assistant', content: 'old '.repeat(40000) }], '3–5pm', 'Calendar facts')
      return messages.some((m) => m.required && m.content === 'Rules and Seminar today') && messages.some((m) => m.required && m.content === '3–5pm') && JSON.stringify(messages).length < 65536
    })
    await check('oversized_current_message_is_explicit_error', () => {
      if (!budgetModule) return false
      try { budgetModule.prepareNativeMessages('Rules', [], 'x'.repeat(70000), ''); return false } catch (error) { return (error as { code?: string }).code === 'PROMPT_TOO_LONG' }
    })
    await check('budget_keeps_pending_card_and_identity', () => {
      if (!budgetModule) return false
      const messages = budgetModule.prepareNativeMessages('Rules', [], 'yes', '- The user is Gadiel\n- WAITING FOR THE USER\'S ANSWER: Seminar 3–5pm\n- Old calendar: ' + 'x'.repeat(90000))
      return messages.some((m) => m.required && m.content.includes('Seminar 3–5pm')) && messages.some((m) => m.required && m.content.includes('Gadiel'))
    })
    const gateModule = await import('./ai-request').catch(() => null)
    await check('delayed_auxiliary_reply_cannot_commit_after_cancel', async () => {
      if (!gateModule) return false
      const gate = new gateModule.AiRequestGate(); const lease = gate.begin() as { commit?: (effect: () => void) => boolean }
      let messages = 0
      gate.cancel(); await Promise.resolve()
      return lease.commit?.(() => { messages++ }) === false && messages === 0
    })
    await check('mode_change_discards_delayed_reply', async () => {
      if (!gateModule) return false
      const gate = new gateModule.AiRequestGate(); const lease = gate.begin(); const replies: string[] = []
      gate.cancel(); await Promise.resolve(); if (lease.isCurrent()) replies.push('obsolete reply')
      return replies.length === 0 && lease.signal.aborted
    })
    await check('background_discards_delayed_action', () => {
      if (!gateModule) return false
      const gate = new gateModule.AiRequestGate(); const lease = gate.begin(); let events = 1
      gate.cancel(); if (lease.isCurrent()) events++
      return events === 1
    })
    await check('cancel_is_request_scoped', () => {
      if (!gateModule) return false
      const gate = new gateModule.AiRequestGate(); const old = gate.begin(); const current = gate.begin()
      return old.signal.aborted && !old.isCurrent() && current.isCurrent() && !current.signal.aborted
    })
    await check('cancelled_native_completion_is_rejected', async () => {
      if (!budgetModule) return false
      let finish: (value: unknown) => void = () => {}; let requestId = ''
      let begin: () => void = () => {}; const started = new Promise<void>((resolve) => { begin = resolve })
      const cancelled: string[] = []
      const plugin = { generate: (options: { requestId: string }) => { requestId = options.requestId; begin(); return new Promise((resolve) => { finish = resolve }) }, cancel: async (options: { requestId: string }) => { cancelled.push(options.requestId) } }
      const native = budgetModule.createNativeClient(plugin as never); const controller = new AbortController()
      const pending = native.generate([], controller.signal).then(() => false, (error: { code: string }) => error.code === 'CANCELLED')
      await started
      controller.abort(); finish({ requestId, text: '{}', loadMs: 0, firstTokenMs: 1, generationMs: 1, promptTokens: 1, generatedTokens: 1 })
      return await pending && cancelled.length === 1 && cancelled[0] === requestId
    })
  } finally { globalThis.fetch = originalFetch }
  console.log(`Android AI: ${count - failures.length}/${count} pass`)
  return failures
}

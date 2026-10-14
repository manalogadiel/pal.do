import { createServer } from 'vite'
import assert from 'node:assert/strict'
const server = await createServer({ configLoader: 'runner', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const previousWindow = globalThis.window
const previousDocument = globalThis.document
globalThis.window = new EventTarget()
globalThis.document = new EventTarget()
try {
  const { stripWakePhrase } = await server.ssrLoadModule('/src/lib/wake.ts')
  const { runVoiceTests } = await server.ssrLoadModule('/src/lib/timers.test-cases.ts')
  assert.deepEqual(runVoiceTests(), [], 'Existing wake detection, echo rejection, and voice commands still pass')
  assert.equal(stripWakePhrase('Hi Jhyvie', 'jhyvie'), '')
  assert.equal(stripWakePhrase('Hey JV.', 'jhyvie'), '')
  assert.equal(stripWakePhrase('iGB', 'jhyvie'), '', 'Observed clipped wake transcription is not a request')
  assert.equal(stripWakePhrase('IGB, what are my plans tomorrow?', 'jhyvie'), 'what are my plans tomorrow?')
  assert.equal(stripWakePhrase('Add IGB to my tasks.', 'jhyvie'), 'Add IGB to my tasks.', 'A name inside a real request stays intact')
  assert.equal(stripWakePhrase("Hi, Jay Hivey. What's next at 7:30pm?", 'jhyvie'), "What's next at 7:30pm?")
  assert.equal(stripWakePhrase('Hi Jhyvie, hi JV, Add class at 7:30pm.', 'jhyvie'), 'Add class at 7:30pm.')
  assert.equal(stripWakePhrase('Hi teacher, I need help.', 'jhyvie'), 'Hi teacher, I need help.')
  assert.equal(stripWakePhrase('Tell Jhyvie hello at 7am.', 'jhyvie'), 'Tell Jhyvie hello at 7am.')
  assert.equal(stripWakePhrase('Hi Ray, add class.', 'rei', 'Ray'), 'Hi Ray, add class.')
  const { WakeEngine } = await server.ssrLoadModule('/src/lib/wakeword.ts')
  function delayedEngine(onWake) {
    let release, started
    const reachedClassifier = new Promise(resolve => { started = resolve })
    const result = new Promise(resolve => { release = resolve })
    const session = size => ({ inputNames: ['input'], outputNames: ['output'], run: async () => ({output: {data:new Float32Array(size)}}) })
    const engine = new WakeEngine({Tensor:class {}}, session(32), session(96), {}, onWake)
    engine.skip = 0
    engine.emb = Array.from({length:16},()=>new Float32Array(96))
    engine.threshold = .5
    engine.clf = {run: async () => { started(); return result }}
    return { engine, reachedClassifier, release: () => release({score:{data:new Float32Array([1])}}) }
  }
  const detections = []
  const delayed = delayedEngine((score, sourceId) => detections.push(sourceId))
  delayed.engine.push(new Float32Array(1280), 41)
  await delayed.reachedClassifier
  delayed.engine.push(new Float32Array(1280), 42)
  delayed.release()
  await delayed.engine.idle()
  assert.deepEqual(detections, [41], 'An async result retains the source wake utterance even after newer audio arrives')
  delayed.engine.dispose()
  const disposed = delayedEngine(() => assert.fail('A disposed detector must not wake a new session'))
  disposed.engine.push(new Float32Array(1280), 43)
  await disposed.reachedClassifier
  disposed.engine.dispose()
  disposed.release()
  await disposed.engine.idle()
  const hf = await server.ssrLoadModule('/src/lib/handsfree.ts')
  const commands = [], previews = [], wakes = []
  await hf.startHandsFree({ pal: 'jhyvie', noMic: true, onState: () => {}, onCommand: text => commands.push(text), onPreview: text => previews.push(text), onWake: phase => wakes.push(phase) })
  await hf.simulateHeard('Hi Jhyvie')
  assert.equal(commands.length, 0, 'Wake alone must not become a chat message')
  assert.equal(hf.handsFreeState(), 'awake', 'The wake phrase opens listening')
  await hf.simulateHeard('Hi Jhyvie, Hi JV, Add class at 7:30pm.')
  assert.deepEqual(commands, [], 'Repeated wake calls are trigger-only even with transcript remainder')
  await hf.simulateHeard('Add class at 7:30pm.')
  assert.deepEqual(commands, ['Add class at 7:30pm.'])
  await hf.simulateHeard('Hi Jhyvie, Set my alarm for 7:05am.')
  assert.equal(commands.length, 1, 'A combined wake clip is never submitted')
  await hf.simulateHeard('Set my alarm for 7:05am.')
  assert.equal(commands.at(-1), 'Set my alarm for 7:05am.')
  await hf.simulateHeard('Hi Jhyvie, Hi JV.')
  assert.equal(commands.length, 2, 'Repeated wake-only phrases are never sent')
  assert.equal(hf.handsFreeState(), 'awake', 'Wake-only follow-ups keep listening')
  await hf.simulateHeard('Add class at 8:15am.')
  assert.equal(commands.at(-1), 'Add class at 8:15am.', 'A normal follow-up needs no wake phrase')
  assert.ok(previews.every(text => !/hi (jhyvie|jv)/i.test(text)), 'Preview excludes the wake phrase')
  await hf.stopHandsFree()
  const isolatedCommands = [], isolatedPreviews = [], wakePhases = []
  await hf.startHandsFree({pal:'jhyvie', noMic:true, onState:()=>{}, onCommand:text=>isolatedCommands.push(text), onPreview:text=>isolatedPreviews.push(text), onWake:phase=>wakePhases.push(phase)})
  hf.simulateWakeWord()
  await hf.simulateHeard('iGB')
  assert.deepEqual(isolatedCommands, [], 'The engine-detected wake clip is discarded even if transcription is iGB')
  assert.ok(isolatedPreviews.length > 0 && isolatedPreviews.every(text => text === ''), 'Wake audio never appears in the command preview')
  assert.deepEqual(wakePhases, ['early', 'full'], 'Capture opens only after the wake clip ends')
  assert.equal(hf.handsFreeState(), 'awake', 'Mic remains ready for the next utterance')
  await hf.simulateHeard('What are my plans tomorrow?')
  assert.deepEqual(isolatedCommands, ['What are my plans tomorrow?'], 'Only the next utterance is submitted')
  hf.simulateWakeWord()
  await hf.simulateHeard('currently as IGB')
  assert.equal(isolatedCommands.length, 1, 'A differently mistranscribed wake clip is still discarded')
  await hf.simulateHeard('Add dinner at 4pm.')
  assert.equal(isolatedCommands.at(-1), 'Add dinner at 4pm.', 'The next request is preserved')
  hf.simulateWakeWord('ended')
  assert.equal(hf.handsFreeState(), 'awake', 'A delayed engine result opens capture without waiting for another utterance')
  await hf.simulateHeard('Add review at 7pm.')
  assert.equal(isolatedCommands.at(-1), 'Add review at 7pm.', 'A late wake result must not consume the following request')
  hf.simulateWakeWord('next')
  assert.equal(hf.handsFreeState(), 'awake', 'A delayed detector result adopts the following utterance without discarding it')
  await hf.simulateHeard('Start a ten minute timer.')
  assert.equal(isolatedCommands.at(-1), 'Start a ten minute timer.')
  await hf.simulateHeard('Hi Jhyvie', 'started')
  assert.equal(wakePhases.at(-1), 'late', 'A final Whisper result does not hand off while the next utterance is recording')
  await hf.simulateHeard('Add coffee at 9am.')
  assert.equal(isolatedCommands.at(-1), 'Add coffee at 9am.')
  await hf.simulateHeard('Hi Jhyvie', 'ended')
  assert.equal(wakePhases.at(-1), 'late', 'An already queued following utterance stays on-device instead of being discarded by handoff')
  await hf.stopHandsFree()
  console.log('wake transcript: wake-only, aliases, repeated greetings, original punctuation, and follow-up routing pass')
} finally {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
  if (previousDocument === undefined) delete globalThis.document
  else globalThis.document = previousDocument
  await server.close()
}

// The "Hi {pal}" detector: catches the wake phrase about 0.2s after the name is said, on this device, without
// waiting for the sentence to end or for Whisper to read it. openWakeWord's speech features (a mel spectrogram, then
// Google's speech embedding) feed a tiny classifier per pal, trained on thousands of synthetic voices saying
// "Hi / Hey / Hello / Uy {name}" the way it's said here (docs/wake-word.md has how to retrain).
//
//   mic frames (16 kHz) → every 80 ms: 8 mel frames → one 96-number embedding → the last 16 (1.28s) → score
//
// It runs on the voice detector's own ONNX runtime (one wasm, one thread, a few ms of work per 80 ms).
// Whisper still double-checks while Pal is talking, and is the wake detector if these models can't load.
import type { RealTimeVADOptions } from '@ricky0123/vad-web'
import type { PalId } from './core'

export type Ort = Parameters<NonNullable<RealTimeVADOptions['ortConfig']>>[0]
type Session = Awaited<ReturnType<Ort['InferenceSession']['create']>>

const CHUNK = 1280 // 80 ms of audio: one step
const CONTEXT = 480 // 3 mel hops of audio before the chunk, so each chunk gives 8 whole frames
const BINS = 32
const MEL_WINDOW = 76 // mel frames per embedding (775 ms)
const EMBEDDINGS = 16 // what the classifier looks at (1.28s)
/** After a wake, the same "Hi Rei" stays in view for a while: don't fire on it twice */
const REFRACTORY_STEPS = 19

const DIR = import.meta.env.BASE_URL + 'wakeword/'

/** Score threshold per pal (from training: the lowest with under 0.5 false wakes an hour on 10h of real audio) */
type Manifest = Record<string, { threshold: number }>

const fetchModel = async (file: string) => {
  const r = await fetch(DIR + file)
  if (!r.ok) throw new Error(`${file}: ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

export class WakeEngine {
  pal: PalId | null = null
  threshold = 1
  /** The newest score (0–1), for checks and Settings */
  lastScore = 0
  /** Average work per 80 ms step, in ms (a slow phone that can't keep up hands the wake back to Whisper) */
  msPerStep = 0
  steps = 0
  failed = false
  /** Tests: every score, as it's made */
  onScore?: (score: number) => void
  private clf: Session | null = null
  private frames: Float32Array[] = []
  private frameIds: number[] = []
  private queued = 0
  private tail = new Float32Array(CONTEXT)
  // openWakeWord starts the mel buffer as ones; scoring waits until it's real audio (see `skip`)
  private mel = new Float32Array(MEL_WINDOW * BINS).fill(1)
  private emb: Float32Array[] = []
  /** Steps left before it may fire: the mel buffer filling up (10 steps) and 16 real embeddings */
  private skip = 10 + EMBEDDINGS
  private busy = false
  private loading: Promise<void> | null = null

  private constructor(
    private ort: Ort,
    private melModel: Session,
    private embModel: Session,
    private manifest: Manifest,
    private onWake: (score: number, utteranceId: number) => void,
  ) {}

  static async load(ort: Ort, pal: PalId, onWake: (score: number, utteranceId: number) => void) {
    const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' as const }
    const [manifest, mel, emb] = await Promise.all([
      fetch(DIR + 'models.json').then((r) => { if (!r.ok) throw new Error(`models.json: ${r.status}`); return r.json() as Promise<Manifest> }),
      fetchModel('melspectrogram.onnx').then((m) => ort.InferenceSession.create(m, opts)),
      fetchModel('embedding_model.onnx').then((m) => ort.InferenceSession.create(m, opts)),
    ])
    const engine = new WakeEngine(ort, mel, emb, manifest, onWake)
    await engine.setPal(pal)
    return engine
  }

  /** Listening for this pal's name now (the classifier is swapped; the speech features carry on) */
  setPal(pal: PalId) {
    if (pal === this.pal && (this.clf || this.loading)) return this.loading ?? Promise.resolve()
    this.pal = pal
    this.clf = null
    const conf = this.manifest[pal]
    if (!conf) return Promise.reject(new Error(`no wake model for ${pal}`))
    this.loading = fetchModel(`${pal}.onnx`)
      .then((m) => this.ort.InferenceSession.create(m, { executionProviders: ['wasm'] }))
      .then((s) => {
        if (this.pal !== pal) return void s.release?.()
        this.clf = s
        this.threshold = conf.threshold
        // Dev/tests: a lower bar on purpose (localStorage paldo.wakeThreshold), to see what a false wake does
        if (import.meta.env.DEV) { try { const t = Number(localStorage.getItem('paldo.wakeThreshold')); if (t > 0) this.threshold = t } catch {} }
        this.skip = Math.max(this.skip, EMBEDDINGS)
      })
      .finally(() => { this.loading = null })
    return this.loading
  }

  /** Ready to catch "Hi {pal}" (when false, Whisper is the wake detector) */
  get ready() { return !!this.clf && !this.failed }

  /** Mic audio, 16 kHz, -1..1, any frame size */
  push(frame: Float32Array, utteranceId = 0) {
    if (this.failed) return
    this.frames.push(frame.slice())
    this.frameIds.push(utteranceId)
    this.queued += frame.length
    // Fell far behind (a background tab): drop the backlog instead of firing on old audio
    if (this.queued > CHUNK * 25) this.reset()
    if (!this.busy) void this.pump()
  }

  /** Tests: resolves once everything pushed so far has been scored */
  async idle() {
    while (this.busy || (this.queued >= CHUNK && !this.failed)) await new Promise((r) => setTimeout(r, 1))
  }

  /** Audio stopped and starts again (the mic was handed off): what's still in view is old, don't fire on it */
  reset() {
    this.frames = []
    this.frameIds = []
    this.queued = 0
    this.skip = Math.max(this.skip, EMBEDDINGS)
  }

  private take(n: number) {
    const out = new Float32Array(n)
    let at = 0
    let utteranceId = 0
    while (at < n) {
      const f = this.frames[0]
      utteranceId = this.frameIds[0]
      const k = Math.min(f.length, n - at)
      out.set(f.subarray(0, k), at)
      at += k
      if (k === f.length) { this.frames.shift(); this.frameIds.shift() }
      else this.frames[0] = f.subarray(k)
    }
    this.queued -= n
    return { audio: out, utteranceId }
  }

  private async pump() {
    this.busy = true
    try {
      while (this.queued >= CHUNK) {
        const t0 = performance.now()
        const chunk = this.take(CHUNK)
        await this.step(chunk.audio, chunk.utteranceId)
        const ms = performance.now() - t0
        this.steps++
        this.msPerStep = this.steps === 1 ? ms : this.msPerStep * 0.95 + ms * 0.05
        // Can't keep up with the mic (it would only ever hear old audio): Whisper listens for the name instead
        if (this.steps > 60 && this.msPerStep > 70) throw new Error(`too slow here (${this.msPerStep.toFixed(0)} ms per 80 ms)`)
      }
    } catch (err) {
      this.failed = true
      console.warn('[wakeword] stopped, Whisper takes over:', err)
    } finally {
      this.busy = false
    }
  }

  private async step(chunk: Float32Array, utteranceId: number) {
    const { Tensor } = this.ort
    // The features expect 16-bit sample values (as floats), like openWakeWord
    const audio = new Float32Array(CONTEXT + CHUNK)
    audio.set(this.tail)
    for (let i = 0; i < CHUNK; i++) audio[CONTEXT + i] = Math.max(-32768, Math.min(32767, Math.round(chunk[i] * 32767)))
    this.tail = audio.slice(CHUNK)

    const melOut = await this.melModel.run({ [this.melModel.inputNames[0]]: new Tensor('float32', audio, [1, audio.length]) })
    const spec = melOut[this.melModel.outputNames[0]].data as Float32Array
    const n = Math.min(MEL_WINDOW, spec.length / BINS)
    this.mel.copyWithin(0, n * BINS)
    for (let i = 0; i < n * BINS; i++) this.mel[(MEL_WINDOW - n) * BINS + i] = spec[spec.length - n * BINS + i] / 10 + 2

    const embOut = await this.embModel.run({ [this.embModel.inputNames[0]]: new Tensor('float32', this.mel.slice(), [1, MEL_WINDOW, BINS, 1]) })
    this.emb.push((embOut[this.embModel.outputNames[0]].data as Float32Array).slice())
    if (this.emb.length > EMBEDDINGS) this.emb.shift()

    if (this.skip > 0) { this.skip--; return }
    if (!this.clf || this.emb.length < EMBEDDINGS) return
    const x = new Float32Array(EMBEDDINGS * 96)
    this.emb.forEach((e, i) => x.set(e, i * 96))
    const out = await this.clf.run({ input: new Tensor('float32', x, [1, EMBEDDINGS, 96]) })
    if (this.failed) return
    const score = (out.score.data as Float32Array)[0]
    this.lastScore = score
    this.onScore?.(score)
    if (score >= this.threshold) {
      this.skip = REFRACTORY_STEPS
      this.onWake(score, utteranceId)
    }
  }

  dispose() {
    this.failed = true
    this.frames = []
    this.frameIds = []
    this.queued = 0
    for (const s of [this.melModel, this.embModel, this.clf]) void s?.release?.()
    this.clf = null
  }
}

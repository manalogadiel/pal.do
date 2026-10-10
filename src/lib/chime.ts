// Phase-end chime. Browsers start an AudioContext suspended unless it's created or resumed inside a tap,
// so one shared context is unlocked from the Start/Resume/Skip handlers and reused when a timer fires.

type AudioCtor = new () => AudioContext

export function makeChime(getCtor: () => AudioCtor | undefined) {
  let ctx: AudioContext | null = null
  const ensure = (): AudioContext | null => {
    if (!ctx) {
      const Ctor = getCtor()
      if (!Ctor) return null
      ctx = new Ctor()
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  }
  return {
    /** Call from a click handler so later chimes are allowed to sound. Never throws. */
    unlock() {
      try {
        ensure()
      } catch {}
    },
    /** Two short 880 Hz beeps. Never throws; silent when audio isn't available. */
    play() {
      try {
        const c = ensure()
        if (!c) return
        for (const offset of [0, 0.25]) {
          const osc = c.createOscillator()
          const gain = c.createGain()
          osc.frequency.value = 880
          gain.gain.setValueAtTime(0.0001, c.currentTime + offset)
          gain.gain.exponentialRampToValueAtTime(0.2, c.currentTime + offset + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + offset + 0.15)
          osc.connect(gain).connect(c.destination)
          osc.start(c.currentTime + offset)
          osc.stop(c.currentTime + offset + 0.16)
        }
      } catch {}
    },
  }
}

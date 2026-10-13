// Pal's sounds: tiny chiptune blips made on the spot with Web Audio (no files to load, nothing to license), soft
// enough to sit under the pixel pals. Browsers start an AudioContext suspended unless it's created or resumed
// inside a tap, so one shared context is unlocked from tap handlers and reused when a timer fires.

type AudioCtor = new () => AudioContext

/** Notes as [frequency Hz, start s, length s] */
type Note = [number, number, number]
const C5 = 523.25, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, G4 = 392, E4 = 329.63, C4 = 261.63, D5 = 587.33

export type SoundName = 'send' | 'receive' | 'added' | 'removed' | 'wake' | 'focus' | 'break' | 'alarm' | 'error' | 'micOpen' | 'micClose'
const SOUNDS: Record<SoundName, { wave: OscillatorType; gain: number; notes: Note[] }> = {
  // a light tick going out
  send: { wave: 'triangle', gain: 0.07, notes: [[E5, 0, 0.05], [A5, 0.045, 0.06]] },
  // a soft two-note "hm?" coming in
  receive: { wave: 'triangle', gain: 0.06, notes: [[G5, 0, 0.06], [C6, 0.06, 0.08]] },
  // something landed on the calendar: a little rising arpeggio
  added: { wave: 'square', gain: 0.045, notes: [[C5, 0, 0.07], [E5, 0.07, 0.07], [G5, 0.14, 0.07], [C6, 0.21, 0.14]] },
  // something left it: the same, falling
  removed: { wave: 'square', gain: 0.04, notes: [[G4, 0, 0.07], [E4, 0.07, 0.07], [C4, 0.14, 0.14]] },
  // "Hi Rei": Pal perks up
  wake: { wave: 'square', gain: 0.05, notes: [[A5, 0, 0.05], [C6, 0.07, 0.09]] },
  // focus round starts: three steps up
  focus: { wave: 'square', gain: 0.05, notes: [[C5, 0, 0.09], [E5, 0.11, 0.09], [G5, 0.22, 0.16]] },
  // break: gentle and down
  break: { wave: 'triangle', gain: 0.08, notes: [[G5, 0, 0.12], [E5, 0.14, 0.12], [C5, 0.28, 0.22]] },
  // timers, reminders, the end of a round: the one meant to be heard across a room
  alarm: { wave: 'square', gain: 0.12, notes: [[A5, 0, 0.12], [A5, 0.2, 0.12], [D5, 0.4, 0.1], [A5, 0.52, 0.2]] },
  error: { wave: 'triangle', gain: 0.07, notes: [[E4, 0, 0.09], [C4, 0.1, 0.16]] },
  // "Hi Rei" heard, the mic is open for you: a clear rising call, loud enough to hear from across a desk
  micOpen: { wave: 'triangle', gain: 0.16, notes: [[C5, 0, 0.07], [G5, 0.07, 0.07], [C6, 0.14, 0.14]] },
  // the mic closed (request sent, or no one spoke): soft and falling
  micClose: { wave: 'triangle', gain: 0.1, notes: [[G5, 0, 0.07], [C5, 0.08, 0.12]] },
}

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
  const sound = (name: SoundName, volume = 1) => {
    try {
      const c = ensure()
      if (!c || volume <= 0) return
      const { wave, gain, notes } = SOUNDS[name]
      const t0 = c.currentTime + 0.01
      for (const [freq, at, len] of notes) {
        const osc = c.createOscillator()
        const g = c.createGain()
        osc.type = wave
        osc.frequency.value = freq
        // quick attack, short release: a blip, not a click
        g.gain.setValueAtTime(0.0001, t0 + at)
        g.gain.exponentialRampToValueAtTime(gain * volume, t0 + at + 0.012)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len)
        osc.connect(g).connect(c.destination)
        osc.start(t0 + at)
        osc.stop(t0 + at + len + 0.02)
      }
    } catch {}
  }
  return {
    /** Call from a click handler so later sounds are allowed to play. Never throws. */
    unlock() {
      try {
        ensure()
      } catch {}
    },
    /** The alarm: timers, reminders, phase ends. Never throws; silent when audio isn't available. */
    play() {
      sound('alarm')
    },
    sound,
  }
}

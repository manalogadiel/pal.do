import { useEffect, useRef, useState } from "react"
import type { PalId } from "../lib/core"
import {
  getDeck,
  saveDeck,
  getCardProgress,
  recordCardResult,
  type LibraryFile,
  type Deck,
} from "../lib/library"
import { extractCards, search } from "../lib/study-material"
import { generateStudyAids } from "../lib/groq"
import {
  answerQueue,
  cardProgressKey,
  practiceQueue,
  quizChoices,
  type CardMode,
  type CardProgress,
} from "../lib/card-practice"
import { readPiece, stopReading } from "../lib/native-tts"

const MODES: CardMode[] = ["swipe", "recall", "quiz"]
export default function CardPractice({
  file,
  pal,
  topic,
  initialMode = "swipe",
}: {
  file: LibraryFile
  pal: PalId
  topic?: string
  initialMode?: CardMode
}) {
  const [deck, setDeck] = useState<Deck | null>(),
    [history, setHistory] = useState<CardProgress[]>([]),
    [mode, setMode] = useState<CardMode>(initialMode)
  const [queue, setQueue] = useState<number[]>([]),
    [position, setPosition] = useState(0),
    [revealed, setRevealed] = useState(false),
    [typed, setTyped] = useState(""),
    [picked, setPicked] = useState<string | null>(null)
  const [full, setFull] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [making, setMaking] = useState(false)
  const [roundStats, setRoundStats] = useState<Partial<Record<CardMode, {
    attempts: number
    correct: number
  }>>>({})
  const generating = useRef(false)
  const locked = useRef(false),
    alive = useRef(true),
    gesture = useRef<{ x: number; y: number; moved:boolean } | null>(null),
    readGeneration = useRef(0)
  const passages = topic ? search(file.chunks, topic, 4) : file.chunks
  useEffect(() => {
    alive.current = true
    let cancelled = false
    void Promise.all([getDeck(file.id), getCardProgress(file.id)])
      .then(async ([saved, progress]) => {
        const d =
          saved && !topic
            ? saved
            : {
                fileId: file.id,
                cards: extractCards(passages),
                source: "app" as const,
                madeAt: Date.now(),
              }
        if (!saved && !topic && d.cards.length) await saveDeck(d)
        if (cancelled) return
        setDeck(d.cards.length ? d : null)
        setHistory(progress)
        setQueue(practiceQueue(file.id, d.cards, progress))
        setPosition(0)
      })
      .catch(() => {
        if (!cancelled) {
          setDeck(null)
          setError("Could not open these cards. Your file is still saved.")
        }
      })
    return () => {
      cancelled = true
      alive.current = false
      readGeneration.current++
      stopReading()
    }
  }, [file.id, topic])
  const reset = (next: CardMode) => {
    readGeneration.current++
    stopReading()
    setRoundStats({})
    setMode(next)
    setQueue(practiceQueue(file.id, deck?.cards ?? [], history))
    setPosition(0)
    gesture.current=null
    setRevealed(false)
    setTyped("")
    setPicked(null)
    setError("")
  }
  async function better() {
    if (making || locked.current || generating.current) return
    generating.current=true
    readGeneration.current++
    stopReading()
    setMaking(true)
    setError("")
    try {
      const cards = await generateStudyAids(
        "cards",
        passages.slice(0, 6),
        topic,
      )
      if (!cards?.length || !("front" in cards[0]))
        throw new Error(
          "AI is unavailable. You can keep using saved cards offline.",
        )
      const d: Deck = {
        fileId: file.id,
        cards: (cards as { front: string; back: string; page?: number }[]).map(
          (c, i) => ({ id: `a${i + 1}`, ...c }),
        ),
        source: "ai",
        madeAt: Date.now(),
      }
      if (!topic) await saveDeck(d)
      if (!alive.current) return
      setDeck(d)
      setRoundStats({})
      setQueue(practiceQueue(file.id, d.cards, history))
      setPosition(0)
      setRevealed(false)
      setTyped("")
      setPicked(null)
    } catch (e) {
      if (alive.current) setError((e as Error).message)
    } finally {
      generating.current=false
      if (alive.current) setMaking(false)
    }
  }
  async function answer(correct: boolean) {
    if (locked.current || generating.current || !deck || position >= queue.length) return
    locked.current = true
    setSaving(true)
    setError("")
    const card = deck.cards[queue[position]]
    try {
      const progress = await recordCardResult(
        cardProgressKey(file.id, card),
        mode,
        correct,
      )
      if (!alive.current) return
      setRoundStats((stats) => {
        const old = stats[mode] ?? { attempts: 0, correct: 0 }
        return {
          ...stats,
          [mode]: {
            attempts: old.attempts + 1,
            correct: old.correct + Number(correct),
          },
        }
      })
      const updated = [
        ...history.filter((p) => p.key !== progress.key),
        progress,
      ]
      setHistory(updated)
      const next = answerQueue(queue, position, correct)
      if (position + 1 >= next.length && full && mode !== "quiz") {
        setMode(MODES[MODES.indexOf(mode) + 1])
        setQueue(practiceQueue(file.id, deck.cards, updated))
        setPosition(0)
      } else {
        setQueue(next)
        setPosition(position + 1)
      }
      readGeneration.current++
      stopReading()
      setRevealed(false)
      setTyped("")
      setPicked(null)
    } catch {
      if (alive.current)
        setError(
          "Could not save this answer. Try again; the card has not advanced.",
        )
    } finally {
      locked.current = false
      if (alive.current) setSaving(false)
    }
  }
  if (deck === undefined)
    return <p role="status">Getting your saved cards ready…</p>
  if (!deck)
    return (
      <div className="card-practice">
        <p>
          No definition cards found in this file. Use lines such as “Term:
          definition”, or make cards from the file with AI.
        </p>
        <button
          className="tool-button-secondary mt-4"
          disabled={making}
          onClick={() => void better()}
        >
          {making ? "Making cards…" : "Make cards with AI"}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    )
  const card = deck.cards[queue[position]],
    choices = card ? quizChoices(deck.cards, queue[position]) : [],
    fallback = mode === "quiz" && !choices.length
  const total = history.reduce((n, p) => n + p.attempts, 0)
  return (
    <section className="card-practice" aria-label="Card practice">
      <p className="task-help mt-3" role="status">
        {card ? `Card ${position + 1} of ${queue.length}` : "Round complete"} ·{" "}
        {total} saved answer{total === 1 ? "" : "s"} across all modes
      </p>
      {!card ? (
        <div className="card-round-complete">
          <h3>Round complete</h3>
          <p>Missed cards will come first next time.</p>
          {MODES.filter((m) => roundStats[m]).map((m) => (
            <p key={m} className="mt-3">
              {m === "quiz" ? "Quiz" : m === "recall" ? "Recall" : "Swipe"}:{" "}
              {roundStats[m]!.correct} of {roundStats[m]!.attempts} correct
            </p>
          ))}
          <button
            className="tool-button-primary mt-5"
            onClick={() => reset(mode)}
          >
            Practice again
          </button>
        </div>
      ) : (
        <>
          {fallback && (
            <p className="task-help mt-3">
              This deck needs two different answers for a quiz. Practice recall
              with these cards instead.
            </p>
          )}
          {mode==='swipe'?<button type="button" disabled={saving||making} className="flashcard-stage" aria-label={revealed?'Show flashcard question':'Reveal flashcard answer'} onClick={()=>{if(!gesture.current?.moved)setRevealed(v=>!v)}} onKeyDown={e=>{if(revealed&&(e.key==='ArrowRight'||e.key==='ArrowLeft')){e.preventDefault();void answer(e.key==='ArrowRight')}}}
           onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);gesture.current={x:e.clientX,y:e.clientY,moved:false}}}
           onPointerCancel={()=>{gesture.current=null}} onPointerUp={e=>{const g=gesture.current;if(!g)return;const dx=e.clientX-g.x,dy=e.clientY-g.y;g.moved=Math.abs(dx)>15||Math.abs(dy)>15;if(revealed&&Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.5)void answer(dx>0);if(g.moved)setTimeout(()=>{gesture.current=null},0)}}>
            <div className="flip flashcard-paper" data-flipped={revealed}><div className="folder-face flashcard-front" data-pattern="lines" aria-hidden={revealed}><span className="font-serif text-[30px] leading-tight">{card.front}</span><span className="mt-4 text-xs opacity-70">Tap to reveal</span></div><div className="flip-back flashcard-back" aria-hidden={!revealed}>{card.back}</div></div>
          </button>:<div className="practice-paper folder-face" data-pattern="lines"><h3>{card.front}</h3>{!fallback?<div className="practice-choices">{choices.map(choice=><button key={choice} disabled={picked!==null||saving||making} className={picked!==null?(choice===card.back?'is-correct':choice===picked?'is-wrong':''):''} onClick={()=>{setPicked(choice);setRevealed(true)}}>{choice}</button>)}</div>:<button className="tool-button-secondary mt-4" disabled={saving||making} onClick={()=>setRevealed(true)}>Reveal answer</button>}{revealed&&<div className="practice-answer">{card.back}</div>}</div>}
          <div className="practice-actions">
            {revealed && (mode !== "quiz" || fallback) ? (
              <>
                <button
                  className="tool-button-secondary"
                  disabled={saving || making}
                  onClick={() => void answer(false)}
                >
                  Not yet
                </button>
                <button
                  className="tool-button-primary"
                  disabled={saving || making}
                  onClick={() => void answer(true)}
                >
                  I knew it
                </button>
              </>
            ) : revealed ? (
              <button
                className="tool-button-primary"
                disabled={saving || making}
                onClick={() => void answer(picked === card.back)}
              >
                Next card
              </button>
            ) : null}
            <button
              className="task-text-button"
              disabled={saving || making}
              onClick={() => {
                const generation = ++readGeneration.current
                stopReading()
                void readPiece(revealed ? card.back : card.front, pal).catch(
                  () => {
                    if (generation === readGeneration.current)
                      setError("Read aloud is unavailable right now.")
                  },
                )
              }}
            >
              Read {revealed ? "answer" : "question"} aloud
            </button>
          </div>
          {mode === "swipe" && (
            <p className="task-help mt-3">
              Reveal, then swipe right for “I knew it” or left for “Not yet”.
              Buttons work too.
            </p>
          )}
        </>
      )}
      {saving && <p role="status">Saving answer…</p>}
      {error && (
        <p role="alert" className="task-error mt-4">
          {error}
        </p>
      )}
      <p className="task-help mt-6">
        One deck in every mode. Missed cards get one extra turn per mode.
      </p>
      <button
        disabled={making || saving}
        className="task-text-button"
        onClick={() => void better()}
      >
        {making ? "Making cards…" : "Make better cards with AI"}
      </button>
    </section>
  )
}

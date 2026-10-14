import {createPortal} from 'react-dom'
import { useRef, useState } from "react"
import { fmtDay, fmtTime, type CalEvent, type Task } from "../lib/core"
import type { Folder } from "../lib/library"
import { isTaskDone } from "../lib/tasks"
import { Clock, Doc, Plus, Check } from "./Icons"

type Zone = "pile" | "doing" | "done"
const ZONES: { id: Zone; label: string; description: string }[] = [
  {
    id: "pile",
    label: "The Pile",
    description: "One thing at a time starts here.",
  },
  {
    id: "doing",
    label: "Workbench",
    description: "Room for three. Make it count.",
  },
  {
    id: "done",
    label: "The Wall",
    description: "A little proof of what you finished.",
  },
]
export function Tasks({
  now,
  tasks,
  events,
  onPlan,
  onAdd,
  onCreate,
  onEdit,
  onQuickAdd,
  onMove,
  folders = [],
}: {
  now: number
  tasks: Task[]
  events: CalEvent[]
  onPlan: (t: Task) => void
  onAdd: (text: string) => void
  onCreate?: () => void
  onEdit?: (id: string) => void
  onQuickAdd?: (title: string) => void
  onMove?: (id: string, status: Zone) => void
  folders?: Folder[]
}) {
  const [title, setTitle] = useState(""),
    [zone, setZone] = useState<Zone>("pile"),
    [drag, setDrag] = useState<{ id: string; x: number; y: number;grabX:number;grabY:number;width:number } | null>(null)
  const press = useRef<{
    id: string
    x: number
    y: number
    moved: boolean
    grabX:number
    grabY:number
    width:number
  } | null>(null)
  const status = (t: Task): Zone =>
    isTaskDone(t) ? "done" : t.status === "doing" ? "doing" : "pile"
  const move = (id: string, next: Zone) => {
    onMove?.(id, next)
    setZone(next)
    const task=tasks.find(t=>t.id===id)
    requestAnimationFrame(()=>{const control=[...document.querySelectorAll<HTMLSelectElement>('select[aria-label]')].find(el=>el.getAttribute('aria-label')===`Move ${task?.title}`);control?.focus({preventScroll:true})})
  }
  const clearDropTarget=()=>document.querySelectorAll<HTMLElement>('[data-drag-over]').forEach(el=>delete el.dataset.dragOver)
  const startDrag = (e: React.PointerEvent, id: string) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect=e.currentTarget.closest('article')!.getBoundingClientRect()
    press.current = { id, x:e.clientX,y:e.clientY,moved:false,grabX:e.clientX-rect.x,grabY:e.clientY-rect.y,width:rect.width }
  }
  const dragMove = (e: React.PointerEvent) => {
    const p = press.current
    if (!p) return
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) p.moved = true
    if (p.moved) setDrag({id:p.id,x:e.clientX,y:e.clientY,grabX:p.grabX,grabY:p.grabY,width:p.width})
    clearDropTarget()
    const target=document.elementsFromPoint(e.clientX,e.clientY).map(el=>el.closest<HTMLElement>('[data-zone]')).find(Boolean)
    if(target)target.dataset.dragOver=target.dataset.zone==='doing'&&tasks.filter(t=>t.status==='doing'&&t.id!==p.id).length>=3?'invalid':'true'
    const board=e.currentTarget.closest('.yard-view') as HTMLElement;const rect=board.getBoundingClientRect();if(e.clientY>rect.bottom-48)board.scrollTop+=12;else if(e.clientY<rect.top+48)board.scrollTop-=12
  }
  const finishDrag = (e: React.PointerEvent) => {
    const p = press.current
    press.current = null
    clearDropTarget()
    setDrag(null)
    if (!p?.moved) return
    const el = document
      .elementsFromPoint(e.clientX, e.clientY)
      .map((n) => n.closest<HTMLElement>("[data-zone]"))
      .find(Boolean)
    if (el) {
      const next = el.dataset.zone as Zone
      const t = tasks.find((t) => t.id === p.id)
      if (t && status(t) !== next) move(p.id, next)
    }
  }
  const card = (task: Task) => {
    const st = status(task),
      folder = folders.find((f) => f.id === task.folderId),
      cool =
        st === "doing" &&
        now - (task.lastTouchedAt ?? task.updatedAt ?? now) >= 30 * 60000
    return (
      <article
        className={`yard-block folder ${
          drag?.id === task.id ? "is-dragging" : ""
        } ${cool ? "is-cooling" : ""}`}
        data-tone={
          st === "done"
            ? "sage"
            : st === "doing" && !cool
              ? "sand"
              : (folder?.style.tone ?? "class")
        }
        key={task.id}
        style={
          {
            "--task-weight": `${Math.min(100, 65 + (task.estimatedMinutes ?? 60) / 6)}%`,
          } as React.CSSProperties
        }
      >
        <span className="folder-back yard-block-tab" aria-hidden />
        <div
          className="folder-face yard-block-paper"
          data-pattern={folder?.style.pattern ?? "lines"}
        >
          <div className="yard-block-top">
            <span className="yard-task-symbol">
              <Doc className="size-5" />
            </span>
            <span className="task-help">
              {task.estimatedMinutes
                ? `${task.estimatedMinutes} min`
                : (folder?.name ?? "Task")}
            </span>
            <button
              type="button"
              className="yard-grip"
              aria-label={`Drag ${task.title}`}
              onPointerDown={(e) => startDrag(e, task.id)}
              onPointerMove={dragMove}
              onPointerUp={finishDrag}
              onPointerCancel={() => {
                press.current = null
                clearDropTarget()
                setDrag(null)
              }}
              onLostPointerCapture={() => {
                press.current = null
                clearDropTarget()
                setDrag(null)
              }}
            >
              <svg
                width="16"
                height="20"
                viewBox="0 0 16 20"
                fill="currentColor"
                aria-hidden
              >
                {[5, 10, 15].map((y) => (
                  <g key={y}>
                    <circle cx="5" cy={y} r="1" />
                    <circle cx="11" cy={y} r="1" />
                  </g>
                ))}
              </svg>
            </button>
          </div>
          <button
            type="button"
            className="yard-task-title"
            aria-label={`Edit ${task.title}`}
            onClick={() => onEdit?.(task.id)}
          >
            {task.title}
          </button>
          {task.notes && <p className="yard-note-preview">{task.notes}</p>}
          {task.scheduled && (
            <p className="yard-time">
              <Clock className="size-3.5" />
              {fmtDay(task.scheduled.start)} · {fmtTime(task.scheduled.start)}–
              {fmtTime(task.scheduled.end)}
            </p>
          )}
          {task.due != null && (
            <p className="task-help">
              Due {fmtDay(task.due)}
              {task.due < now && !isTaskDone(task) ? " · overdue" : ""}
            </p>
          )}
          {cool && <p className="task-help">Waiting for your attention</p>}
          <div className="yard-block-actions">
            <select
              aria-label={`Move ${task.title}`}
              value={st}
              onChange={(e) => move(task.id, e.target.value as Zone)}
            >
              <option value="pile">Pile</option>
              <option value="doing">Workbench</option>
              <option value="done">Done</option>
            </select>
            {st !== "done" ? (
              <button
                type="button"
                aria-label={`Complete ${task.title}`}
                onClick={() => move(task.id, "done")}
              >
                <Check className="size-4" />
                Done
              </button>
            ) : (
              <button type="button" onClick={() => move(task.id, "pile")}>
                Reopen
              </button>
            )}
          </div>
          {task.kind !== "task" &&
            task.hours > task.doneHours &&
            st !== "done" && (
              <button
                type="button"
                className="task-text-button"
                onClick={() => onPlan(task)}
              >
                {events.some((e) => e.taskId === task.id && e.kind === "work")
                  ? "Re-plan study"
                  : "Plan study"}
              </button>
            )}
        </div>
      </article>
    )
  }
  return (
    <div className="yard-view tasks-view h-full overflow-y-auto overscroll-contain">
      <header className="yard-heading">
        <div>
          <h1>Block Yard</h1>
          <p>A place for what needs doing.</p>
        </div>
        <button
          className="tool-button-primary flex items-center gap-2"
          onClick={onCreate}
        >
          <Plus className="size-4" />
          New task
        </button>
      </header>
      <form
        className="yard-quick-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) {
            onQuickAdd?.(title.trim())
            setTitle("")
            setZone("pile")
          }
        }}
      >
        <Plus className="size-4" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={240}
          placeholder="Add a task, then press Enter"
          aria-label="Quick add task"
        />
        <button disabled={!title.trim()} type="submit">
          Add
        </button>
      </form>
      <div className="yard-zone-tabs" role="tablist" aria-label="Task zones">
        {ZONES.map((z) => (
          <button
            role="tab"
            data-zone={z.id}
            aria-selected={zone === z.id}
            key={z.id}
            onClick={() => setZone(z.id)}
          >
            {z.label}
            <span>
              {tasks.filter((t) => status(t) === z.id).length}
              {z.id === "doing" ? "/3" : ""}
            </span>
          </button>
        ))}
      </div>
      <div className="yard-zones">
        {ZONES.map((z) => {
          const rows = tasks
            .filter((t) => status(t) === z.id)
            .sort((a, b) =>
              z.id === "done"
                ? (b.completedAt ?? 0) - (a.completedAt ?? 0)
                : (a.createdAt ?? 0) - (b.createdAt ?? 0),
            )
          return (
            <section
              data-zone={z.id}
              data-active={zone === z.id}
              className={`yard-zone zone-${z.id}`}
              key={z.id}
              aria-label={z.label}
            >
              <header>
                <h2>{z.label}</h2>
                <span>
                  {rows.length}
                  {z.id === "doing" ? " / 3" : ""}
                </span>
                <p>{z.description}</p>
              </header>
              <div className="yard-zone-content">
                {!rows.length && (
                  <p className="yard-empty">
                    {z.id === "pile"
                      ? "Drop a thought here. Make it a task."
                      : z.id === "doing"
                        ? "Choose a task from the Pile."
                        : "Finished tasks build your wall here."}
                  </p>
                )}
                {rows.map((t, i) => (
                  <div key={t.id}>
                    {z.id === "done" &&
                      (i === 0 ||
                        new Date(t.completedAt ?? 0).toDateString() !==
                          new Date(
                            rows[i - 1].completedAt ?? 0,
                          ).toDateString()) && (
                        <h3 className="yard-day">
                          {t.completedAt ? fmtDay(t.completedAt) : "Earlier"}
                        </h3>
                      )}
                    {card(t)}
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
      {drag && createPortal(<div className="yard-drag-preview folder" data-tone={folders.find(f=>f.id===tasks.find(t=>t.id===drag.id)?.folderId)?.style.tone??'class'} style={{left:drag.x-drag.grabX,top:drag.y-drag.grabY,width:drag.width}} aria-hidden><div className="folder-face yard-block-paper" data-pattern="lines"><span className="yard-task-symbol"><Doc className="size-5"/></span><p className="yard-task-title">{tasks.find(t=>t.id===drag.id)?.title}</p><p className="yard-note-preview">{tasks.find(t=>t.id===drag.id)?.notes}</p></div></div>,document.body)}
    </div>
  )
}
export default Tasks

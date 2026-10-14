import SelectField from './SelectField'
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { uid, type Task } from "../lib/core"
import type { Folder } from "../lib/library"
import { validateTaskDraft, type TaskDraft } from "../lib/tasks"
import { Doc, X } from "./Icons"

const localDate = (t?: number) => {
  if (t == null) return ""
  const d = new Date(t),
    pad = (v: number) => String(v).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export default function TaskEditor({
  task,
  folders,
  onSave,
  onClose,
}: {
  task: Task | null
  folders: Folder[]
  onSave: (draft: TaskDraft, allowOverlap: boolean) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState(task?.title ?? ""),
    [notes, setNotes] = useState(task?.notes ?? "")
  const [kind, setKind] = useState(task?.kind ?? "task"),
    [status, setStatus] = useState(task?.status ?? "pile")
  const [due, setDue] = useState(localDate(task?.due)),
    [estimate, setEstimate] = useState(task?.estimatedMinutes?.toString() ?? "")
  const [start, setStart] = useState(localDate(task?.scheduled?.start)),
    [end, setEnd] = useState(localDate(task?.scheduled?.end))
  const [folder, setFolder] = useState(task?.folderId ?? ""),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [allowOverlap, setAllowOverlap] = useState(false)
  const [discard, setDiscard] = useState(false)
  const initial = useRef(
    JSON.stringify([
      title,
      notes,
      kind,
      status,
      due,
      estimate,
      start,
      end,
      folder,
    ]),
  )
  const dirty =
    initial.current !==
    JSON.stringify([
      title,
      notes,
      kind,
      status,
      due,
      estimate,
      start,
      end,
      folder,
    ])
  const close = () => (dirty ? setDiscard(true) : onClose())
  useEffect(() => {
    const el = dialog.current,
      previous = document.activeElement as HTMLElement
    el?.showModal()
    return () => {
      el?.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  const save = (e: React.FormEvent) => {
    e.preventDefault()
    const draft: TaskDraft = {
      title,
      notes,
      kind,
      status,
      folderId: folder || undefined,
      hours: task?.hours ?? 0,
      due: due ? new Date(due).getTime() : undefined,
      estimatedMinutes: estimate ? Number(estimate) : undefined,
      scheduled:
        start || end
          ? {
              eventId: task?.scheduled?.eventId ?? uid(),
              start: new Date(start).getTime(),
              end: new Date(end).getTime(),
            }
          : undefined,
    }
    const problems = validateTaskDraft(draft)
    if (problems.length) {
      setError(problems.join(" "))
      return
    }
    try {
      onSave(draft, allowOverlap)
    } catch (e) {
      setError((e as Error).message)
      setConflict((e as Error).name === "ScheduleConflict")
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      className="task-editor text-ink"
      aria-labelledby="task-editor-title"
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
    >
      <form
        onSubmit={save}
        onChange={() => {
          setError("")
          setAllowOverlap(false)
          setConflict(false)
        }}
        className="task-editor-shell"
      >
        <header className="task-editor-header">
          <div>
            <span className="task-paper-tab">
              <Doc className="size-4" />
              Block Yard
            </span>
            <h2 id="task-editor-title">{task ? "Edit task" : "New task"}</h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="settings-icon-button"
            aria-label="Close task editor"
          >
            <X />
          </button>
        </header>
        <div className="task-editor-body">
          <label className="task-field">
            Task title
            <input
              autoFocus
              required
              maxLength={240}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
            />
          </label>
          <div className="task-field-pair">
            <label className="task-field">
              Status
              <SelectField aria-label="Status" value={status} onValueChange={v=>{setStatus(v as typeof status);setError('');setAllowOverlap(false);setConflict(false)}} options={[{value:'pile',label:'Pile'},{value:'doing',label:'Workbench'},{value:'done',label:'Done'}]} />
            </label>
            <label className="task-field">
              Type
              <SelectField aria-label="Type" value={kind} onValueChange={v=>{setKind(v as typeof kind);setError('');setAllowOverlap(false);setConflict(false)}} options={[{value:'task',label:'Everyday task'},{value:'assignment',label:'Assignment'},{value:'exam',label:'Exam'}]} />
            </label>
          </div>
          <label className="task-field">
            Notes
            <textarea
              aria-label="Notes"
              className="task-notes"
              rows={7}
              maxLength={20000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Details, ideas, links, or a little reminder…"
            />
          </label>
          <details
            className="task-details"
            open={!!task?.scheduled || !!task?.due}
          >
            <summary>
              Time &amp; details <span>Optional</span>
            </summary>
            <label className="task-field">
              Estimated minutes
              <input
                type="number"
                min={1}
                max={1440}
                value={estimate}
                onChange={(e) => setEstimate(e.target.value)}
                placeholder="No estimate"
              />
            </label>
            <label className="task-field">
              Deadline
              <input
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
              <small>
                When it is due, separate from time reserved to work on it.
              </small>
            </label>
            <div className="task-field-pair">
              <label className="task-field">
                Scheduled start
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label className="task-field">
                Scheduled end
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </div>
            {(start || end) && (
              <button
                type="button"
                className="task-text-button"
                onClick={() => {
                  setStart("")
                  setEnd("")
                }}
              >
                Remove scheduled time
              </button>
            )}
            <p className="task-help">
              Leave the scheduled time empty to keep this task off the calendar.
            </p>
            <label className="task-field">
              Subject folder
              <SelectField aria-label="Subject folder" value={folder} onValueChange={v=>{setFolder(v);setError('');setAllowOverlap(false);setConflict(false)}} options={[{value:'',label:'No folder'}, ...(task?.folderId && !folders.some(f=>f.id===task.folderId)?[{value:task.folderId,label:'Folder no longer available',disabled:true}]:[]), ...folders.map(f=>({value:f.id,label:f.name}))]} />
            </label>
          </details>
          {error && (
            <p role="alert" className="task-error">
              {error}
            </p>
          )}
          {conflict && (
            <label className="task-help flex gap-2">
              <input
                type="checkbox"
                checked={allowOverlap}
                onChange={(e) => {
                  e.stopPropagation()
                  setAllowOverlap(e.target.checked)
                }}
              />
              Save despite this overlap
            </label>
          )}
          {discard && (
            <div className="task-discard" role="alert">
              <p>Discard your unsaved changes?</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  className="tool-button-secondary"
                  onClick={() => setDiscard(false)}
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  className="tool-button-secondary"
                  onClick={onClose}
                >
                  Discard changes
                </button>
              </div>
            </div>
          )}
        </div>
        <footer className="task-editor-footer">
          <button
            type="button"
            className="tool-button-secondary"
            onClick={close}
          >
            Cancel
          </button>
          <button className="tool-button-primary" type="submit">
            Save task
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  )
}

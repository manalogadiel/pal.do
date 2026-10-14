import { uid, type Task, type CalEvent } from "./core"

export type TaskDraft = Pick<Task, "title" | "kind" | "notes" | "status" | "due" | "estimatedMinutes" | "scheduled" | "folderId" | "hours">
export const isTaskDone = (task: Task) =>
  task.status
    ? task.status === "done"
    : task.hours > 0 && task.doneHours >= task.hours
export const datedTasks = (tasks: Task[]): Array<Task & { due: number }> =>
  tasks.filter(
    (t): t is Task & { due: number } =>
      Number.isFinite(t.due) && !isTaskDone(t),
  )
export function normalizeTask(raw: unknown, now: number): Task | null {
  if (!raw || typeof raw !== "object") return null
  const t = raw as Task
  if (
    typeof t.id !== "string" ||
    typeof t.title !== "string" ||
    !t.title.trim()
  )
    return null
  return {
    ...t,
    title: t.title.trim(),
    kind: ["exam", "assignment", "task"].includes(t.kind) ? t.kind : "task",
    hours: Number.isFinite(t.hours) ? Math.max(0, t.hours) : 0,
    doneHours: Number.isFinite(t.doneHours) ? Math.max(0, t.doneHours) : 0,
    due: Number.isFinite(t.due) ? t.due : undefined,
    notes: typeof t.notes === "string" ? t.notes : "",
    status: ["pile", "doing", "done"].includes(t.status ?? "")
      ? t.status
      : isTaskDone(t)
        ? "done"
        : "pile",
    createdAt: t.createdAt ?? now,
    updatedAt: t.updatedAt ?? now,
    lastTouchedAt: t.lastTouchedAt ?? now,
  }
}
export function validateTaskDraft(d: TaskDraft): string[] {
  const errors: string[] = []
  if (!d.title.trim()) errors.push("Give your task a title.")
  if (d.title.length > 240) errors.push("Keep the title under 240 characters.")
  if ((d.notes?.length ?? 0) > 20000)
    errors.push("Keep notes under 20,000 characters.")
  if (d.due != null && !Number.isFinite(d.due))
    errors.push("Choose a valid deadline.")
  if (
    d.estimatedMinutes != null &&
    (!Number.isFinite(d.estimatedMinutes) ||
      d.estimatedMinutes < 1 ||
      d.estimatedMinutes > 1440)
  )
    errors.push("Estimate between 1 and 1,440 minutes.")
  if (
    d.scheduled &&
    (!Number.isFinite(d.scheduled.start) ||
      !Number.isFinite(d.scheduled.end) ||
      d.scheduled.end <= d.scheduled.start)
  )
    errors.push("The scheduled end must be after the start.")
  return errors
}
export function applyTaskEdit(task: Task, draft: TaskDraft, now: number): Task {
  const errors = validateTaskDraft(draft)
  if (errors.length) throw new Error(errors.join(" "))
  const status = draft.status ?? task.status ?? "pile"
  return {
    ...task,
    ...draft,
    title: draft.title.trim(),
    notes: draft.notes ?? "",
    status,
    createdAt: task.createdAt ?? now,
    updatedAt: now,
    lastTouchedAt: now,
    completedAt: status === "done" ? (task.completedAt ?? now) : undefined,
  }
}
export function newTask(draft: TaskDraft, now: number): Task {
  return applyTaskEdit(
    { id: uid(), title: "", kind: "task", hours: 0, doneHours: 0 },
    draft,
    now,
  )
}
export function transitionTask(
  task: Task,
  status: NonNullable<Task["status"]>,
  tasks: Task[],
  now: number,
): { task?: Task; error?: string } {
  if (
    status === "doing" &&
    task.status !== "doing" &&
    tasks.filter((t) => t.id !== task.id && t.status === "doing").length >= 3
  )
    return {
      error:
        "Your Workbench has three tasks. Finish or return one to the Pile first.",
    }
  return { task: applyTaskEdit(task, { ...task, status }, now) }
}
export function syncTaskCalendar(
  before: Task | null,
  after: Task,
  events: CalEvent[],
): CalEvent[] {
  const oldId = before?.scheduled?.eventId
  const current = oldId ? events.find((e) => e.id === oldId) : undefined
  if (
    before?.scheduled &&
    (!current ||
      current.taskId !== before.id ||
      current.title !== before.title ||
      current.start !== before.scheduled.start ||
      current.end !== before.scheduled.end)
  )
    throw new Error(
      "This calendar block changed. Reopen the task before saving its schedule.",
    )
  let next = oldId ? events.filter((e) => e.id !== oldId) : [...events]
  if (after.scheduled) {
    if (next.some((e) => e.id === after.scheduled!.eventId))
      throw new Error("This calendar block changed. Reopen the task.")
    next.push({
      ...current,
      id: after.scheduled.eventId,
      taskId: after.id,
      title: after.title,
      kind: "protected",
      start: after.scheduled.start,
      end: after.scheduled.end,
      status: isTaskDone(after) ? "done" : "planned",
      note: after.notes || undefined,
    })
  }
  const currentDeadline = events.find(e=>e.taskId===before?.id && e.kind==='deadline')
  if(before && currentDeadline && currentDeadline.start !== before.due)throw new Error('This deadline changed. Reopen the task before saving.')
  // Deadlines stay distinct from the task's reserved work time.
  const deadline = next.find(
    (e) => e.taskId === after.id && e.kind === "deadline",
  )
  next = next.filter((e) => !(e.taskId === after.id && e.kind === "deadline"))
  if (after.due != null)
    next.push({
      ...deadline,
      note:after.notes||undefined,
      id: deadline?.id ?? `due-${after.id}`,
      taskId: after.id,
      title: after.title,
      kind: "deadline",
      start: after.due,
      end: after.due,
      status: isTaskDone(after) ? "done" : "planned",
    })
  return next
}

/** Calendar edits remain authoritative for explicitly linked blocks and deadline markers. */
export function reconcileTaskCalendar(task: Task, events: CalEvent[], previousEvents: CalEvent[] = []): Task {
  let next = task
  const deadline=events.find(e=>e.kind==='deadline' && e.taskId===task.id)
  const previousDeadline=previousEvents.find(e=>e.kind==='deadline' && e.taskId===task.id)
  if (deadline && deadline.start!==task.due) next={...next,due:deadline.start,updatedAt:Date.now()}
  else if (!deadline && previousDeadline) next={...next,due:undefined,updatedAt:Date.now()}
  if (!task.scheduled) return next
  const event=events.find(e=>e.id===task.scheduled!.eventId && e.taskId===task.id)
  if (!event) return {...next,scheduled:undefined}
  const status=event.status==='done'?'done':task.status==='done'?'pile':task.status
  if(event.title===task.title&&event.start===task.scheduled.start&&event.end===task.scheduled.end&&status===task.status&&(event.note??'')===(task.notes??''))return next
  return {...next,title:event.title,notes:event.note??'',scheduled:{eventId:event.id,start:event.start,end:event.end},status,completedAt:status==='done'?task.completedAt??event.end:undefined,updatedAt:Date.now()}
}

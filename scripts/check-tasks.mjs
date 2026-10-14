import { createServer } from "vite"
import assert from "node:assert/strict"
const vite = await createServer({
  configLoader: "runner",
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
})
try {
  const {
    normalizeTask,
    applyTaskEdit,
    validateTaskDraft,
    syncTaskCalendar,
    transitionTask,
    isTaskDone,
    reconcileTaskCalendar,
  } = await vite.ssrLoadModule("/src/lib/tasks.ts")
  const now = Date.parse("2026-10-14T02:00:00Z")
  const legacy = {
    id: "old",
    title: "Paper",
    kind: "assignment",
    due: now + 86400000,
    hours: 4,
    doneHours: 1,
  }
  const old = normalizeTask(legacy, now)
  assert.equal(old.id, "old")
  assert.equal(old.doneHours, 1)
  assert.equal(old.status, "pile")
  assert.equal(old.notes, "")
  assert.equal(normalizeTask({ ...legacy, doneHours: 4 }, now).status, "done")
  assert.equal(normalizeTask({ bad: true }, now), null)
  const draft = {
    title: "Buy groceries",
    kind: "task",
    notes: "Milk\nBread",
    status: "pile",
    hours: 0,
  }
  assert.deepEqual(validateTaskDraft(draft), [])
  const task = applyTaskEdit(
    normalizeTask({ id: "new", ...draft }, now),
    draft,
    now,
  )
  assert.equal(task.due, undefined)
  assert.equal(task.notes, "Milk\nBread")
  assert.equal(isTaskDone(task), false)
  assert.deepEqual(syncTaskCalendar(null, task, []), [])
  const scheduled = applyTaskEdit(
    task,
    {
      ...draft,
      scheduled: { eventId: "slot", start: now + 3600000, end: now + 7200000 },
    },
    now,
  )
  const unrelated = {
    id: "unrelated",
    title: "Class",
    kind: "class",
    start: now,
    end: now + 1800000,
    status: "planned",
  }
  const events = syncTaskCalendar(task, scheduled, [unrelated])
  assert.equal(events.length, 2)
  assert.deepEqual(events[0], unrelated)
  assert.deepEqual(syncTaskCalendar(scheduled, scheduled, events), events)
  const done = transitionTask(scheduled, "done", [scheduled], now).task
  assert.equal(syncTaskCalendar(scheduled, done, events)[1].status, "done")
  assert.deepEqual(syncTaskCalendar(scheduled, task, events), [unrelated])
  const doing = [1, 2, 3].map((i) => ({
    ...task,
    id: String(i),
    status: "doing",
  }))
  assert.ok(transitionTask(task, "doing", doing, now).error)
  assert.equal(
    transitionTask(task, "doing", doing.slice(1), now).task.status,
    "doing",
  )
  assert.ok(
    validateTaskDraft({
      ...draft,
      scheduled: { eventId: "x", start: now, end: now },
    }).length,
  )
  const changed = events.map((e) =>
    e.id === "slot" ? { ...e, title: "Calendar edit" } : e,
  )
  assert.throws(
    () =>
      syncTaskCalendar(
        scheduled,
        { ...scheduled, title: "Task edit" },
        changed,
      ),
    /changed/i,
  )
  const reconciled = reconcileTaskCalendar(scheduled, changed)
  assert.equal(reconciled.title, "Calendar edit")
  assert.equal(reconcileTaskCalendar(scheduled, []).scheduled, undefined)
  const reopened = transitionTask(done, "pile", [done], now + 1000).task
  assert.equal(reopened.completedAt, undefined)
  assert.equal(reopened.doneHours, done.doneHours)
  assert.equal(
    syncTaskCalendar(
      done,
      reopened,
      syncTaskCalendar(scheduled, done, events),
    )[1].status,
    "planned",
  )
  const dueTask={...task,due:now+86400000}
  const marker={id:'due-new',taskId:task.id,title:task.title,kind:'deadline',start:dueTask.due,end:dueTask.due,status:'planned'}
  const movedMarker={...marker,start:now+172800000,end:now+172800000}
  assert.equal(reconcileTaskCalendar(dueTask,[movedMarker],[marker]).due,movedMarker.start)
  assert.equal(reconcileTaskCalendar(dueTask,[],[marker]).due,undefined)
  assert.throws(()=>syncTaskCalendar(dueTask,{...dueTask,notes:'Updated notes'},[movedMarker]),/changed/i)
  console.log(
    "tasks: migration, notes, optional dates, calendar idempotence, stale edits and three-slot limit pass",
  )
} finally {
  await vite.close()
}

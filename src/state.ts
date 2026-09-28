import type { AppState, AttendanceStatus, Session, Assessment } from "./domain";

export const emptyPlannerState = (): AppState => ({
  schemaVersion: 1,
  timezone: "Europe/Madrid",
  scheduleCoverage: "incomplete",
  courses: [],
  sessions: [],
  attendance: [],
  assessments: [],
  trips: [],
  scenarios: [],
});

// Initialize only after a successful read; a storage failure must never replace saved data.
export async function initializePlanner(
  read: () => Promise<AppState | null>,
  write: (state: AppState) => Promise<void>,
  initial: AppState = emptyPlannerState(),
) {
  const existing = await read();
  if (existing) return existing;
  await write(initial);
  return initial;
}

export function saveQueue(write: (state: AppState) => Promise<void>) {
  let pending: Promise<void> = Promise.resolve();
  return (state: AppState) =>
    (pending = pending.catch(() => {}).then(() => write(state)));
}
export function recordAttendance(
  state: AppState,
  sessionId: string,
  unitId: string,
  status: AttendanceStatus | "",
): AppState {
  const old = state.attendance.find(
    (r) => r.sessionId === sessionId && r.unitId === unitId,
  );
  const attendance = state.attendance.filter((r) => r !== old);
  if (status)
    attendance.push({
      ...old,
      id: old?.id ?? crypto.randomUUID(),
      sessionId,
      unitId,
      status,
      recordedAt: new Date().toISOString(),
    });
  return { ...state, attendance };
}

export interface SessionEdits {
  attendance: Record<string, AttendanceStatus | "">;
  planned: Record<string, boolean>;
  scenarioId?: string;
}
export function applySessionEdit(
  state: AppState,
  session: Session,
  assessment: Assessment | null,
  edits: SessionEdits,
): AppState {
  const previous = state.sessions.find((s) => s.id === session.id);
  const removed = new Set(
    previous?.units
      .filter((u) => !session.units.some((n) => n.id === u.id))
      .map((u) => u.id),
  );
  let next = {
    ...state,
    sessions: previous
      ? state.sessions.map((s) => (s.id === session.id ? session : s))
      : [...state.sessions, session],
    attendance: state.attendance.filter((r) => !removed.has(r.unitId)),
    assessments: state.assessments.filter(
      (a) => a.sessionId !== session.id && a.id !== previous?.assessmentId,
    ),
    scenarios: state.scenarios.map((s) => ({
      ...s,
      plannedUnitIds: (s.plannedUnitIds ?? []).filter((id) => !removed.has(id)),
    })),
  };
  if (assessment) next.assessments.push(assessment);
  for (const unit of session.units) {
    if (Object.hasOwn(edits.attendance, unit.id))
      next = recordAttendance(
        next,
        session.id,
        unit.id,
        edits.attendance[unit.id],
      ) as typeof next;
  }
  next.scenarios = next.scenarios.map((s) => {
    if (s.id !== edits.scenarioId) return s;
    const ids = new Set(s.plannedUnitIds);
    for (const unit of session.units) {
      if (!Object.hasOwn(edits.planned, unit.id)) continue;
      if (edits.planned[unit.id]) ids.add(unit.id);
      else ids.delete(unit.id);
    }
    return { ...s, plannedUnitIds: [...ids] };
  });
  return next;
}

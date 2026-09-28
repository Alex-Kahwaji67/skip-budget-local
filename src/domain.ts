export type DeliveryMode = "in-person" | "online" | "async";
export type TripStatus = "tentative" | "confirmed" | "cancelled";
export type Confidence = "confirmed" | "tentative" | "unknown";
export type AttendanceStatus = "attended" | "absent" | "excused";
export type AsyncCompletion =
  "not-started" | "in-progress" | "complete" | "unknown";
export interface SessionUnit {
  id: string;
  label: string;
}

export interface SourceMetadata {
  source?: string;
  sourceId?: string;
  importedAt?: string;
  sequence?: number;
}
export interface Course extends SourceMetadata {
  id: string;
  name: string;
  totalUnits: number;
  requiredAttendanceBps: number;
  excusedTreatment?: "count" | "exclude" | "unresolved";
  policyNotes?: string;
  sourceUrl?: string;
  verifiedAt?: string;
}
export interface Session extends SourceMetadata {
  id: string;
  courseId: string;
  title?: string;
  startsAt: number;
  endsAt: number;
  timezone?: string;
  units: SessionUnit[];
  /** compatibility projection for simple consumers */ unitIds?: string[];
  deliveryMode: DeliveryMode;
  notes?: string;
  isPast?: boolean;
  publishedWindow?: boolean;
  asyncCompletion?: AsyncCompletion;
  asyncDueAt?: number;
  assessmentId?: string;
}
export interface AttendanceRecord extends SourceMetadata {
  id: string;
  sessionId: string;
  unitId: string;
  status: AttendanceStatus;
  recordedAt?: string;
  notes?: string;
}
export interface Assessment extends SourceMetadata {
  id: string;
  courseId: string;
  title: string;
  startsAt: number;
  endsAt: number;
  confidence: Confidence;
  type?: "exam" | "presentation" | "assignment" | "other";
  sessionId?: string;
  dueAt?: number;
  notes?: string;
}
export interface Trip extends SourceMetadata {
  id: string;
  name: string;
  departureAt: number;
  returnAt: number;
  status: TripStatus;
  departureBufferMinutes?: number;
  returnBufferMinutes?: number;
  notes?: string;
}
export interface Scenario extends SourceMetadata {
  id: string;
  name: string;
  enabled: boolean;
  tripIds?: string[];
  plannedUnitIds?: string[];
}
export interface AppState {
  schemaVersion: 1;
  timezone: string;
  courses: Course[];
  sessions: Session[];
  attendance: AttendanceRecord[];
  assessments: Assessment[];
  trips: Trip[];
  scenarios: Scenario[];
  scheduleCoverage: "incomplete" | "complete";
  source?: SourceMetadata;
}

export const MADRID_TIMEZONE = "Europe/Madrid";
export const isPointDeadline = (assessment: Assessment) =>
  assessment.startsAt === assessment.endsAt &&
  assessment.dueAt === assessment.startsAt;
export const assessmentDueAtAfterTimingChange = (
  assessment: Assessment | undefined,
  dueOnly: boolean,
  startsAt: number,
) =>
  dueOnly
    ? startsAt
    : assessment && !isPointDeadline(assessment)
      ? assessment.dueAt
      : undefined;

/** Convert a Madrid (or supplied IANA zone) local datetime to an epoch. */
export function localDateTimeToEpoch(
  value: string,
  timezone = MADRID_TIMEZONE,
): number {
  const m = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) throw new Error(`Invalid local datetime: ${value}`);
  const [y, mo, d, h, min] = m.slice(1, 6).map(Number);
  const sec = m[6] ? Number(m[6]) : 0;
  let guess = Date.UTC(y, mo - 1, d, h, min, sec);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(
      fmt
        .formatToParts(new Date(guess))
        .filter((x) => x.type !== "literal")
        .map((x) => [x.type, Number(x.value)]),
    );
    const rendered = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    guess += Date.UTC(y, mo - 1, d, h, min, sec) - rendered;
  }
  const target = `${y}-${mo}-${d}-${h}-${min}-${sec}`;
  const keyAt = (epoch: number) => {
    const p = Object.fromEntries(
      fmt
        .formatToParts(new Date(epoch))
        .filter((x) => x.type !== "literal")
        .map((x) => [x.type, Number(x.value)]),
    );
    return `${p.year}-${p.month}-${p.day}-${p.hour}-${p.minute}-${p.second}`;
  };
  if (keyAt(guess) !== target)
    throw new Error(`Nonexistent local datetime in ${timezone}: ${value}`);
  const alternatives = [
    guess - 7_200_000,
    guess - 5_400_000,
    guess - 3_600_000,
    guess - 1_800_000,
    guess + 1_800_000,
    guess + 3_600_000,
    guess + 5_400_000,
    guess + 7_200_000,
  ];
  if (alternatives.some((candidate) => keyAt(candidate) === target))
    throw new Error(`Ambiguous local datetime in ${timezone}: ${value}`);
  return guess;
}

export function maxAbsences(
  courseOrTotal: Pick<Course, "totalUnits" | "requiredAttendanceBps"> | number,
  bps?: number,
): number {
  const total =
    typeof courseOrTotal === "number"
      ? courseOrTotal
      : courseOrTotal.totalUnits;
  const rate =
    typeof courseOrTotal === "number"
      ? bps!
      : courseOrTotal.requiredAttendanceBps;
  if (
    !Number.isInteger(total) ||
    total < 1 ||
    !Number.isInteger(rate) ||
    rate < 0 ||
    rate > 10_000
  )
    throw new Error(
      "Attendance totals and basis points must be valid integers.",
    );
  return Math.max(0, total - Math.ceil((total * rate) / 10000));
}

function tripOverlaps(session: Session, trip: Trip): boolean {
  if (session.deliveryMode === "async") return false;
  const start = trip.departureAt - (trip.departureBufferMinutes ?? 0) * 60000;
  const end = trip.returnAt + (trip.returnBufferMinutes ?? 0) * 60000;
  return session.startsAt < end && session.endsAt > start;
}
const unitsOf = (s: Session): SessionUnit[] =>
  s.units ?? (s.unitIds ?? []).map((id) => ({ id, label: id }));
const tripsFor = (state: AppState, scenario: Scenario | null): Trip[] => {
  if (!scenario) return state.trips.filter((t) => t.status === "confirmed");
  const ids = new Set(scenario.tripIds ?? []);
  return state.trips.filter(
    (t) =>
      t.status === "confirmed" ||
      (scenario.enabled && t.status !== "cancelled" && ids.has(t.id)),
  );
};
function selectedTrips(state: AppState, scenario: Scenario | null): Trip[] {
  return tripsFor(state, scenario);
}

export function affectedSessions(
  state: AppState,
  tripsOrScenario: Trip | Trip[] | Scenario | null = null,
): Session[] {
  const trips = Array.isArray(tripsOrScenario)
    ? tripsOrScenario
    : tripsOrScenario && "departureAt" in tripsOrScenario
      ? [tripsOrScenario]
      : selectedTrips(state, tripsOrScenario as Scenario | null);
  return state.sessions.filter((s) =>
    trips.some((t) => t.status !== "cancelled" && tripOverlaps(s, t)),
  );
}

export function assessmentConflicts(
  state: AppState,
  tripsOrScenario: Trip | Trip[] | Scenario | null = null,
): Assessment[] {
  const trips = Array.isArray(tripsOrScenario)
    ? tripsOrScenario
    : tripsOrScenario && "departureAt" in tripsOrScenario
      ? [tripsOrScenario]
      : selectedTrips(state, tripsOrScenario as Scenario | null);
  return state.assessments.filter((a) =>
    trips.some((t) => {
      if (t.status === "cancelled") return false;
      const start = t.departureAt - (t.departureBufferMinutes ?? 0) * 60000,
        end = t.returnAt + (t.returnBufferMinutes ?? 0) * 60000;
      if (isPointDeadline(a)) return a.dueAt! >= start && a.dueAt! < end;
      return a.startsAt < end && a.endsAt > start;
    }),
  );
}

export interface CourseProjection {
  courseId: string;
  actualAbsences: number;
  unknownPastUnits: number;
  plannedAbsences: number;
  projectedAbsences: number;
  allowance: number;
  status:
    | "Within budget"
    | "At limit"
    | "Projected over limit"
    | "Attendance threshold unreachable";
}
export interface Projection {
  courses: CourseProjection[];
  affectedSessions: Session[];
  assessmentConflicts: Assessment[];
  asyncDuringTrips: Session[];
  scheduleCoverage: "incomplete" | "complete";
}

export function getProjection(
  state: AppState,
  scenario: Scenario | null = null,
  now = Date.now(),
): Projection {
  const plans = new Set<string>();
  affectedSessions(state, scenario).forEach((s) => {
    if (s.endsAt >= now && s.deliveryMode !== "async")
      unitsOf(s).forEach((u) => plans.add(u.id));
  });
  if (scenario?.enabled)
    (scenario.plannedUnitIds ?? []).forEach(
      (id) =>
        state.sessions.some(
          (s) =>
            s.deliveryMode !== "async" &&
            s.endsAt >= now &&
            unitsOf(s).some((u) => u.id === id),
        ) && plans.add(id),
    );
  const recorded = new Map(
    state.attendance.map((a) => [`${a.sessionId}:${a.unitId}`, a]),
  );
  const courses = state.courses.map((c) => {
    let actual = 0,
      unknown = 0;
    state.sessions
      .filter((s) => s.courseId === c.id)
      .forEach((s) =>
        unitsOf(s).forEach((u) => {
          const r = recorded.get(`${s.id}:${u.id}`);
          if (
            r?.status === "absent" ||
            (r?.status === "excused" &&
              (c.excusedTreatment ?? "unresolved") !== "exclude")
          )
            actual++;
          else if (
            !r &&
            (s.deliveryMode === "async"
              ? (s.asyncDueAt ?? s.endsAt)
              : s.endsAt) < now
          )
            unknown++;
        }),
      );
    const planned = [...plans].filter(
      (id) =>
        !state.attendance.some((a) => a.unitId === id) &&
        state.sessions.some(
          (s) => s.courseId === c.id && unitsOf(s).some((u) => u.id === id),
        ),
    ).length;
    const allowance = maxAbsences(c);
    const projected = actual + planned;
    const status: CourseProjection["status"] =
      actual > allowance
        ? "Attendance threshold unreachable"
        : projected > allowance
          ? "Projected over limit"
          : projected === allowance
            ? "At limit"
            : "Within budget";
    return {
      courseId: c.id,
      actualAbsences: actual,
      unknownPastUnits: unknown,
      plannedAbsences: planned,
      projectedAbsences: projected,
      allowance,
      status,
    };
  });
  const selected = tripsFor(state, scenario);
  return {
    courses,
    affectedSessions: affectedSessions(state, scenario),
    assessmentConflicts: assessmentConflicts(state, scenario),
    asyncDuringTrips: state.sessions.filter(
      (s) =>
        s.deliveryMode === "async" &&
        selected.some((t) => {
          const start =
            t.departureAt - (t.departureBufferMinutes ?? 0) * 60_000;
          const end = t.returnAt + (t.returnBufferMinutes ?? 0) * 60_000;
          return s.asyncDueAt
            ? s.asyncDueAt >= start && s.asyncDueAt < end
            : s.startsAt < end && s.endsAt > start;
        }),
    ),
    scheduleCoverage: state.scheduleCoverage,
  };
}

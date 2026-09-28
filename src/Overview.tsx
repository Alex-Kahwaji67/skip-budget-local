import { useState } from "react";
import {
  affectedSessions,
  type AppState,
  type Projection,
  type AttendanceStatus,
  type Trip,
} from "./domain";
import {
  Icon,
  Dialog,
  formatDate,
  formatTime,
  courseName,
  AttendancePicker,
} from "./ui";

export function PageHeader({
  title = "Attendance & travel",
}: {
  title?: string;
}) {
  return (
    <section className="page-heading">
      <div>
        <p className="exchange">
          <Icon name="plane" /> Free for IE students
        </p>
        <h1>{title}</h1>
        <p>
          Madrid & Segovia <span className="dot">·</span> Independent student
          project
        </p>
        <p>
          <a
            href="https://docs.ie.edu/documents/Attendance_Policy_Bachelor_Programs.pdf"
            target="_blank"
            rel="noreferrer"
          >
            IE bachelor attendance policy (2026–27)
          </a>{" "}
          · Estimates are not travel approval.
        </p>
      </div>

      <blockquote>
        <span>“</span>
        <em>
          Know the class cost
          <br />
          before you book the trip.
        </em>
        <small>Free. Open source. No subscription.</small>
      </blockquote>
    </section>
  );
}
export function Coverage({ state }: { state: AppState }) {
  const [open, setOpen] = useState(false);
  const unknown = state.sessions.some(
    (s) =>
      (s.deliveryMode === "async" ? (s.asyncDueAt ?? s.endsAt) : s.endsAt) <
        Date.now() &&
      s.units.some(
        (u) =>
          !state.attendance.some(
            (r) => r.sessionId === s.id && r.unitId === u.id,
          ),
      ),
  );
  const incomplete = state.scheduleCoverage === "incomplete";
  if (!incomplete && !unknown) return null;
  return (
    <>
      <div className="notice coverage-notice">
        <Icon name="alert" />
        <div>
          <strong>
            {state.sessions.length} known blocks
            {unknown
              ? " · attendance history incomplete"
              : " · schedule coverage incomplete"}
          </strong>
          <p>
            {incomplete
              ? "Known conflicts are a lower bound until the full timetable and past attendance are reviewed."
              : "Record unknown past attendance to make your remaining allowance reliable."}
          </p>
        </div>
        <button className="button quiet" onClick={() => setOpen(true)}>
          <Icon name="info" /> Learn more about this <Icon name="arrow-right" />
        </button>
      </div>
      <Dialog
        open={open}
        title="Understanding your planning estimates"
        onClose={() => setOpen(false)}
      >
        <p>
          Trips project future absences. They never record attendance for you.
          Unrecorded past units remain unknown, and an empty calendar does not
          prove you are free.
        </p>
        <p>
          Each course has its own editable allowance. These are planning
          calculations, not the university’s official sanction rules.
        </p>
        <p>
          Use Schedule to record attendance, Import to review timetable changes,
          and course details to verify the policy.
        </p>
      </Dialog>
    </>
  );
}
export function TripImage({ trip: _trip }: { trip: Trip }) {
  return (
    <span className="trip-thumb trip-placeholder">
      <Icon name="plane" />
    </span>
  );
}
export function BudgetStatus({
  value,
  incomplete,
}: {
  value: Projection["courses"][number];
  incomplete?: boolean;
}) {
  const remaining = value.allowance - value.projectedAbsences;
  const tone = remaining < 0 ? "danger" : remaining === 0 ? "warning" : "";
  return (
    <span className="budget-state">
      <span className={`status ${tone}`}>
        <Icon name={remaining <= 0 ? "alert" : "info"} />
        {value.status === "Attendance threshold unreachable"
          ? "Threshold unreachable"
          : remaining < 0
            ? "Projected over limit"
            : remaining === 0
              ? "At limit"
              : "Within budget"}
      </span>
      {(incomplete || value.unknownPastUnits > 0) && (
        <small>Data incomplete</small>
      )}
    </span>
  );
}
export function Overview({
  state,
  projection,
  confirmed,
  scenarioId,
  onScenario,
  onCourse,
  onSession,
  onTrip,
  onSchedule,
  onAttendance,
}: {
  state: AppState;
  projection: Projection;
  confirmed: Projection;
  scenarioId: string | null;
  onScenario: (id: string | null) => void;
  onCourse: (id: string) => void;
  onSession: (id: string) => void;
  onTrip: (id?: string) => void;
  onSchedule: () => void;
  onAttendance: (
    sessionId: string,
    unitId: string,
    status: AttendanceStatus | "",
  ) => void;
}) {
  const [sort, setSort] = useState("risk");
  const [expanded, setExpanded] = useState<string | null>(null);
  const scenario = state.scenarios.find((s) => s.id === scenarioId);
  const delta =
    projection.courses.reduce((n, c) => n + c.plannedAbsences, 0) -
    confirmed.courses.reduce((n, c) => n + c.plannedAbsences, 0);
  const ordered = [...projection.courses].sort((a, b) =>
    sort === "name"
      ? courseName(state, a.courseId).localeCompare(
          courseName(state, b.courseId),
        )
      : a.allowance -
          a.projectedAbsences -
          (b.allowance - b.projectedAbsences) ||
        b.unknownPastUnits - a.unknownPastUnits,
  );
  const over = projection.courses.filter(
    (c) => c.projectedAbsences > c.allowance,
  );
  const upcoming = state.sessions
    .filter((s) => s.endsAt >= Date.now())
    .sort((a, b) => a.startsAt - b.startsAt)
    .slice(0, 5);
  return (
    <>
      <PageHeader />
      <Coverage state={state} />
      <div className={`scenario-panel ${scenario ? "active-scenario" : ""}`}>
        <div className="segmented">
          <button aria-pressed={!scenario} onClick={() => onScenario(null)}>
            <Icon name="calendar" />
            Confirmed plans
          </button>
          {state.scenarios.map((s) => (
            <button
              key={s.id}
              aria-pressed={s.id === scenarioId}
              onClick={() => onScenario(s.id)}
            >
              <Icon name="flask" />
              {s.name.replace(/^What-if:\s*/i, "")}
            </button>
          ))}
        </div>
        {!scenario && (
          <span className="muted">{state.courses.length} courses</span>
        )}
        {scenario && (
          <div className="scenario-description">
            <div>
              <strong>
                <Icon name="flask" /> Hypothetical scenario:{" "}
                {scenario.name.replace(/^What-if:\s*/i, "")}
              </strong>
              <p>
                Only the selected tentative trips and planned skips affect this
                view.
              </p>
            </div>
            <div className="scenario-delta">
              <strong>
                {delta >= 0 ? "+" : ""}
                {delta}
              </strong>
              <span>
                projected units
                <br />
                vs. confirmed plans
              </span>
            </div>
            {over.length > 0 && (
              <div className="scenario-risk">
                <Icon name="alert" />
                <div>
                  {over.map((c) => (
                    <p key={c.courseId}>
                      <strong>
                        {courseName(state, c.courseId)}:{" "}
                        {c.projectedAbsences - c.allowance} unit(s) over
                        allowance.
                      </strong>
                    </p>
                  ))}
                  <button
                    className="text-button"
                    onClick={() => onCourse(over[0].courseId)}
                  >
                    Review affected units <Icon name="arrow-right" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="overview-layout">
        <section className="panel course-ledger">
          <div className="section-heading">
            <div>
              <h2>Course attendance ledger</h2>
              <p>
                Projected against each course’s editable attendance threshold.
              </p>
            </div>
            <label className="sort-control">
              <span className="sr-only">Sort courses</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="risk">Sort by: Most at risk</option>
                <option value="name">Sort by: Course name</option>
              </select>
            </label>
          </div>
          <div className="ledger-heading">
            <span>Course</span>
            <span>
              Recorded
              <br />
              absent
            </span>
            <span>
              Past attendance
              <br />
              unknown
            </span>
            <span>
              {scenario ? "Projected" : "Confirmed"}
              <br />
              future absences
            </span>
            <span>
              Remaining
              <br />
              allowance
            </span>
            <span>Status</span>
            <span />
          </div>
          {ordered.map((item) => {
            const remaining = item.allowance - item.projectedAbsences;
            const name = courseName(state, item.courseId);
            const tone =
              remaining < 0 ? "danger" : remaining <= 1 ? "warning" : "";
            return (
              <div key={item.courseId} className={`ledger-entry ${tone}`}>
                <div className="ledger-row">
                  <button
                    className="course-link"
                    onClick={() => onCourse(item.courseId)}
                  >
                    {name}
                  </button>
                  <span className="ledger-number">{item.actualAbsences}</span>
                  <span className="ledger-number">{item.unknownPastUnits}</span>
                  <span className="ledger-number">{item.plannedAbsences}</span>
                  <strong
                    className="remaining"
                    aria-label={`${remaining < 0 ? Math.abs(remaining) + " over allowance" : remaining + " remaining of " + item.allowance}`}
                  >
                    {remaining < 0 ? (
                      `${-remaining} over`
                    ) : (
                      <>
                        {remaining}
                        <small>remaining of {item.allowance}</small>
                      </>
                    )}
                  </strong>
                  <span className="ledger-status">
                    <BudgetStatus
                      value={item}
                      incomplete={state.scheduleCoverage === "incomplete"}
                    />
                  </span>
                  <button
                    className="icon-button small desktop-only"
                    aria-label={`Inspect ${name}`}
                    onClick={() => onCourse(item.courseId)}
                  >
                    <Icon name="arrow-right" />
                  </button>
                  <button
                    className="icon-button mobile-only"
                    aria-label={`Expand ${name}`}
                    aria-expanded={expanded === item.courseId}
                    onClick={() =>
                      setExpanded(
                        expanded === item.courseId ? null : item.courseId,
                      )
                    }
                  >
                    <Icon name="arrow-right" />
                  </button>
                </div>
                {expanded === item.courseId && (
                  <div className="mobile-course-details">
                    <span>{item.actualAbsences} recorded absent</span>
                    <span>{item.unknownPastUnits} past unknown</span>
                    <span>{item.plannedAbsences} future planned</span>
                    <BudgetStatus
                      value={item}
                      incomplete={state.scheduleCoverage === "incomplete"}
                    />
                    <button
                      className="text-button"
                      onClick={() => onCourse(item.courseId)}
                    >
                      Inspect & edit course
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {!ordered.length && (
            <div className="empty">
              <Icon name="book" />
              <h3>No courses added yet</h3>
              <button
                className="button primary"
                onClick={() => onCourse("new")}
              >
                Add your first course
              </button>
            </div>
          )}
          <footer className="panel-footer">
            <span>
              <Icon name="info" /> Planning estimates, not official university
              sanctions.
            </span>
            <button className="text-button" onClick={() => onCourse("new")}>
              <Icon name="plus" />
              Add course
            </button>
          </footer>
        </section>
        <aside className="side-ledger">
          <section className="panel">
            <div className="section-heading">
              <h2>
                <Icon name="bag" /> Confirmed trips
              </h2>
              <button className="text-button" onClick={() => onTrip()}>
                <Icon name="plus" /> Add trip
              </button>
            </div>
            {state.trips
              .filter((t) => t.status === "confirmed")
              .map((trip) => (
                <button
                  className="trip-row"
                  key={trip.id}
                  onClick={() => onTrip(trip.id)}
                >
                  <TripImage trip={trip} />
                  <span className="row-copy">
                    <strong>{trip.name}</strong>
                    <span>
                      {formatDate(trip.departureAt)} –{" "}
                      {formatDate(trip.returnAt)},{" "}
                      {new Date(trip.returnAt).getFullYear()}
                    </span>
                  </span>
                  <span className="trip-count">
                    <strong>
                      {affectedSessions(state, trip).reduce(
                        (n, s) => n + s.units.length,
                        0,
                      )}
                    </strong>
                    <small>known units</small>
                  </span>
                  <Icon name="arrow-right" />
                </button>
              ))}
            {!state.trips.some((t) => t.status === "confirmed") && (
              <p className="empty">
                No confirmed trips. Try an idea in the simulator.
              </p>
            )}
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>
                <Icon name="book" /> Next known classes
              </h2>
              <button className="text-button" onClick={onSchedule}>
                View schedule <Icon name="arrow-right" />
              </button>
            </div>
            {upcoming.map((s) => (
              <div className="next-row" key={s.id}>
                <time>
                  <span>
                    {formatDate(s.startsAt, {
                      weekday: "short",
                      day: undefined,
                      month: undefined,
                    })}
                  </span>
                  <strong>{formatDate(s.startsAt)}</strong>
                </time>
                <button className="row-copy" onClick={() => onSession(s.id)}>
                  <strong>{courseName(state, s.courseId)}</strong>
                  <span>
                    {s.deliveryMode === "async"
                      ? "Async window"
                      : `${formatTime(s.startsAt)} – ${formatTime(s.endsAt)}`}
                    <br />
                    {s.units.map((u) => u.label).join(" · ")}
                  </span>
                </button>
                {s.deliveryMode === "async" || s.units.length > 1 ? (
                  <button
                    className="button small"
                    onClick={() => onSession(s.id)}
                  >
                    {s.deliveryMode === "async" ? "Completion" : "Record units"}
                  </button>
                ) : (
                  <AttendancePicker
                    value={
                      state.attendance.find((r) => r.unitId === s.units[0].id)
                        ?.status ?? ""
                    }
                    label={`Attendance for ${courseName(state, s.courseId)} ${s.units[0].label}`}
                    onChange={(status) =>
                      onAttendance(s.id, s.units[0].id, status)
                    }
                  />
                )}
              </div>
            ))}
            {!upcoming.length && (
              <p className="empty">
                No upcoming classes in the known schedule.
              </p>
            )}
            <button className="button full-width soft" onClick={onSchedule}>
              <Icon name="calendar" />
              Open full schedule <Icon name="arrow-right" />
            </button>
          </section>
          {projection.asyncDuringTrips.length > 0 && (
            <section className="panel">
              <h3>Coursework during travel</h3>
              {projection.asyncDuringTrips.map((s) => (
                <button
                  className="coursework-row"
                  key={s.id}
                  onClick={() => onSession(s.id)}
                >
                  <Icon name="file" />
                  <span>
                    <strong>{courseName(state, s.courseId)}</strong>
                    <small>
                      {s.asyncDueAt
                        ? `Due ${formatDate(s.asyncDueAt)}`
                        : "Published window · no verified deadline"}
                    </small>
                  </span>
                  <Icon name="arrow-right" />
                </button>
              ))}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

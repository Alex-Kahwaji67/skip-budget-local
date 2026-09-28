import { useState } from "react";
import {
  affectedSessions,
  localDateTimeToEpoch,
  type AppState,
  type AttendanceStatus,
} from "./domain";
import {
  calendarEvents,
  layoutEvents,
  occursWithin,
  type CalendarEvent,
} from "./calendarLayout";
import {
  Icon,
  dateKey,
  todayInMadrid,
  mondayOf,
  addDays,
  formatDate,
  formatTime,
  AttendancePicker,
} from "./ui";
import { Coverage, PageHeader } from "./Overview";

export function Schedule({
  state,
  readOnly = false,
  onSession,
  onAssessment,
  onTrip,
  onAttendance,
}: {
  state: AppState;
  readOnly?: boolean;
  onSession: (id: string) => void;
  onAssessment: (id: string) => void;
  onTrip: (id?: string) => void;
  onAttendance: (
    sessionId: string,
    unitId: string,
    status: AttendanceStatus | "",
  ) => void;
}) {
  const [mode, setMode] = useState<"week" | "agenda">(() =>
    window.innerWidth < 768 ? "agenda" : "week",
  );
  const [week, setWeek] = useState(() => mondayOf(todayInMadrid()));
  const [day, setDay] = useState(todayInMadrid);
  const [course, setCourse] = useState("");
  const [attendance, setAttendance] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filters, setFilters] = useState(false);
  const events = calendarEvents(state);
  const travel = new Set(affectedSessions(state).map((s) => s.id));
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const open = (e: CalendarEvent) =>
    e.kind === "trip"
      ? onTrip(e.id)
      : e.kind === "assessment"
        ? onAssessment(e.id)
        : onSession(e.id);
  const matches = (e: CalendarEvent) => {
    if (course && e.courseId !== course) return false;
    if ((from && dateKey(e.end) < from) || (to && dateKey(e.start) > to))
      return false;
    if (attendance === "all") return true;
    const s = state.sessions.find((s) => s.id === e.id);
    if (!s) return false;
    return s.units.some(
      (u) =>
        (state.attendance.find((r) => r.unitId === u.id)?.status ??
          "unknown") === attendance,
    );
  };
  const filtered = events.filter(matches);
  const within = (e: CalendarEvent, d: string) =>
    occursWithin(
      e,
      localDateTimeToEpoch(`${d}T00:00`),
      localDateTimeToEpoch(`${addDays(d, 1)}T00:00`),
    );
  const pointDeadline = (e: CalendarEvent) =>
    e.kind === "assessment" && e.start === e.end;
  const label = (e: CalendarEvent) => {
    const s = state.sessions.find((s) => s.id === e.id);
    const a = state.assessments.find((a) => a.id === e.id);
    return s
      ? s.units.map((u) => u.label).join(" · ")
      : a
        ? `${pointDeadline(e) ? "Deadline" : (a.type ?? "Assessment")} · ${a.confidence}`
        : state.trips.find((t) => t.id === e.id)?.status;
  };
  const renderEvent = (e: CalendarEvent) => (
    <>
      <span className="event-time">
        <Icon
          name={
            e.kind === "assessment"
              ? "file"
              : e.kind === "trip"
                ? "plane"
                : "book"
          }
        />
        {pointDeadline(e)
          ? `Due ${formatTime(e.start)}`
          : dateKey(e.start) !== dateKey(e.end)
            ? `${formatDate(e.start)}, ${formatTime(e.start)} – ${formatDate(e.end)}, ${formatTime(e.end)}`
            : `${formatTime(e.start)} – ${formatTime(e.end)}`}
      </span>
      <strong>{e.title}</strong>
      <small>{label(e)}</small>
      {travel.has(e.id) && (
        <span className="overlap-label">Travel overlap</span>
      )}
    </>
  );
  const timed = filtered
    .filter((e) => e.kind === "class" || e.kind === "assessment")
    .filter((e) => !pointDeadline(e))
    .filter((e) => days.slice(0, 5).some((d) => within(e, d)));
  const minute = (epoch: number) => {
    const [h, m] = formatTime(epoch).split(":").map(Number);
    return h * 60 + m;
  };
  const floor = Math.min(
    8 * 60,
    ...timed.map((e) =>
      dateKey(e.end) !== dateKey(e.start) ? 0 : minute(e.start),
    ),
  );
  const ceiling = Math.max(
    20 * 60,
    ...timed.map((e) =>
      dateKey(e.end) !== dateKey(e.start) ? 1440 : minute(e.end),
    ),
  );
  const startHour = Math.floor(floor / 60),
    endHour = Math.ceil(ceiling / 60);
  const height = (endHour - startHour) * 64;
  const groups = new Map<string, CalendarEvent[]>();
  filtered.forEach((e) => {
    const key = dateKey(e.start);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  });
  return (
    <>
      <PageHeader title="Schedule" />
      <Coverage state={state} />
      <div className="toolbar">
        <div className="toolbar-group">
          <button
            className="button"
            onClick={() => {
              setWeek(mondayOf(todayInMadrid()));
              setDay(todayInMadrid());
            }}
          >
            Today
          </button>
          <button
            className="icon-button"
            aria-label="Previous week"
            onClick={() => {
              setWeek(addDays(week, -7));
              setDay(addDays(day, -7));
            }}
          >
            <Icon name="arrow-left" />
          </button>
          <button
            className="icon-button"
            aria-label="Next week"
            onClick={() => {
              setWeek(addDays(week, 7));
              setDay(addDays(day, 7));
            }}
          >
            <Icon name="arrow-right" />
          </button>
          <div>
            <strong>
              {formatDate(localDateTimeToEpoch(week + "T12:00"))} –{" "}
              {formatDate(localDateTimeToEpoch(addDays(week, 6) + "T12:00"))},{" "}
              {week.slice(0, 4)}
            </strong>
            <small>Europe/Madrid · local time</small>
          </div>
        </div>
        <div className="toolbar-group">
          <div className="segmented">
            <button
              aria-pressed={mode === "week"}
              onClick={() => setMode("week")}
            >
              Week
            </button>
            <button
              aria-pressed={mode === "agenda"}
              onClick={() => setMode("agenda")}
            >
              Agenda
            </button>
          </div>
          <button
            className="button"
            onClick={() => setFilters(!filters)}
            aria-expanded={filters}
          >
            <Icon name="filter" />
            Filters
          </button>
          <button
            className="button"
            disabled={readOnly}
            onClick={() => onSession("new")}
          >
            <Icon name="plus" />
            Add a class
          </button>
          <button className="button" onClick={() => onAssessment("new")}>
            <Icon name="plus" />
            Add an assessment
          </button>
        </div>
      </div>
      {filters && (
        <div className="filter-bar panel">
          <label className="field">
            Course
            <select value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">All courses & trips</option>
              {state.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Attendance
            <select
              value={attendance}
              onChange={(e) => setAttendance(e.target.value)}
            >
              <option value="all">All attendance</option>
              {["unknown", "attended", "absent", "excused"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="field">
            Through
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            className="text-button"
            onClick={() => {
              setCourse("");
              setAttendance("all");
              setFrom("");
              setTo("");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      <div className="mobile-date-strip">
        {days.map((d) => (
          <button key={d} aria-pressed={d === day} onClick={() => setDay(d)}>
            <span>
              {formatDate(localDateTimeToEpoch(d + "T12:00"), {
                weekday: "short",
                day: undefined,
                month: undefined,
              })}
            </span>
            <strong>{formatDate(localDateTimeToEpoch(d + "T12:00"))}</strong>
          </button>
        ))}
      </div>
      <div className="mobile-agenda">
        {filtered
          .filter((e) => within(e, day))
          .map((e) => (
            <button
              className={`mobile-event ${e.kind}`}
              key={e.kind + e.id}
              onClick={() => open(e)}
            >
              {renderEvent(e)}
              <Icon name="arrow-right" />
            </button>
          ))}
        {!filtered.some((e) => within(e, day)) && (
          <div className="empty">
            <Icon name="calendar" />
            <h3>No known commitments this day</h3>
            <p>Check coverage before making travel plans.</p>
          </div>
        )}
      </div>
      <div className="desktop-schedule">
        {mode === "week" ? (
          <div className="schedule-layout">
            <div className="calendar">
              <div className="calendar-head">
                <span>Madrid time</span>
                {days.slice(0, 5).map((d) => (
                  <strong key={d}>
                    {formatDate(localDateTimeToEpoch(d + "T12:00"), {
                      weekday: "short",
                    })}
                  </strong>
                ))}
              </div>
              <div className="calendar-bands">
                <span>Travel / async / due</span>
                {days.slice(0, 5).map((d) => (
                  <div key={d}>
                    {filtered
                      .filter(
                        (e) =>
                          (e.kind === "trip" ||
                            e.kind === "async" ||
                            pointDeadline(e)) &&
                          within(e, d),
                      )
                      .map((e) => (
                        <button
                          className={`calendar-band ${e.kind}`}
                          key={e.id}
                          onClick={() => open(e)}
                        >
                          <Icon name={e.kind === "trip" ? "plane" : "file"} />
                          {e.title}
                          <small>
                            {e.kind === "async" ? "Published window" : label(e)}
                          </small>
                        </button>
                      ))}
                  </div>
                ))}
              </div>
              <div className="calendar-body" style={{ height }}>
                <div className="time-axis">
                  {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
                    <span key={i} style={{ top: i * 64 }}>
                      {String(startHour + i).padStart(2, "0")}:00
                    </span>
                  ))}
                </div>
                {days.slice(0, 5).map((d) => (
                  <div className="calendar-day" key={d}>
                    {Array.from({ length: endHour - startHour }, (_, i) => (
                      <div
                        className="hour-rule"
                        style={{ top: i * 64 }}
                        key={i}
                      />
                    ))}
                    {layoutEvents(timed.filter((e) => within(e, d))).map(
                      (e) => {
                        const top =
                          (dateKey(e.start) < d ? 0 : minute(e.start)) -
                          startHour * 60;
                        const bottom =
                          dateKey(e.end) > d ? 1440 : minute(e.end);
                        return (
                          <button
                            className={`calendar-event ${e.kind}`}
                            key={e.kind + e.id}
                            onClick={() => open(e)}
                            style={{
                              top: (Math.max(0, top) * 64) / 60,
                              height: Math.max(
                                36,
                                ((bottom -
                                  Math.max(
                                    startHour * 60,
                                    dateKey(e.start) < d ? 0 : minute(e.start),
                                  )) *
                                  64) /
                                  60 -
                                  4,
                              ),
                              left: `calc(${(e.column / e.columns) * 100}% + 4px)`,
                              width: `calc(${100 / e.columns}% - 8px)`,
                            }}
                          >
                            {renderEvent(e)}
                          </button>
                        );
                      },
                    )}
                  </div>
                ))}
              </div>
            </div>
            <aside className="side-ledger">
              <section className="panel">
                <h2>Weekend</h2>
                {days.slice(5).map((d) => (
                  <div className="weekend-day" key={d}>
                    <h3>
                      {formatDate(localDateTimeToEpoch(d + "T12:00"), {
                        weekday: "long",
                      })}
                    </h3>
                    {filtered
                      .filter((e) => within(e, d))
                      .map((e) => (
                        <button
                          className={`calendar-band ${e.kind}`}
                          key={e.id}
                          onClick={() => open(e)}
                        >
                          {renderEvent(e)}
                        </button>
                      ))}
                    {!filtered.some((e) => within(e, d)) && (
                      <p className="muted">No known events</p>
                    )}
                  </div>
                ))}
              </section>
              <section className="panel legend">
                <h3>Calendar legend</h3>
                <span>
                  <i className="class" />
                  Class · attendance
                </span>
                <span>
                  <i className="assessment" />
                  Assessment / exam
                </span>
                <span>
                  <i className="trip" />
                  Travel
                </span>
                <span>
                  <i className="async" />
                  Asynchronous window
                </span>
              </section>
            </aside>
          </div>
        ) : (
          <div className="agenda panel">
            {[...groups].map(([d, items]) => (
              <details open className="agenda-day" key={d}>
                <summary>
                  {formatDate(localDateTimeToEpoch(d + "T12:00"), {
                    weekday: "long",
                  })}
                  <small>{items.length} commitments</small>
                </summary>
                {items.map((e) => {
                  const s = state.sessions.find((s) => s.id === e.id);
                  return (
                    <div
                      className={`agenda-row ${travel.has(e.id) ? "travel-overlap" : ""}`}
                      key={e.kind + e.id}
                    >
                      <time>
                        {pointDeadline(e)
                          ? `Due ${formatTime(e.start)}`
                          : `${formatTime(e.start)} – ${formatTime(e.end)}`}
                        {dateKey(e.end) !== d && (
                          <small>through {formatDate(e.end)}</small>
                        )}
                      </time>
                      <button className="row-copy" onClick={() => open(e)}>
                        <strong>{e.title}</strong>
                        <span>
                          {label(e)} · {s?.deliveryMode ?? e.kind}
                        </span>
                      </button>
                      {travel.has(e.id) && (
                        <span className="status warning">
                          <Icon name="plane" />
                          Travel overlap
                        </span>
                      )}
                      {s &&
                      s.deliveryMode !== "async" &&
                      s.units.length === 1 ? (
                        <AttendancePicker
                          disabled={readOnly}
                          value={
                            state.attendance.find(
                              (r) => r.unitId === s.units[0].id,
                            )?.status ?? ""
                          }
                          label={`Attendance for ${e.title} ${label(e)}`}
                          onChange={(status) =>
                            onAttendance(s.id, s.units[0].id, status)
                          }
                        />
                      ) : (
                        <span className="muted">
                          {s?.deliveryMode === "async"
                            ? (s.asyncCompletion ?? "unknown")
                            : s
                              ? `${s.units.length} units`
                              : e.kind}
                        </span>
                      )}
                      <button className="text-button" onClick={() => open(e)}>
                        <Icon name="edit" />
                        Edit
                      </button>
                    </div>
                  );
                })}
              </details>
            ))}
            {!groups.size && (
              <p className="empty">No commitments match these filters.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

import { useState } from "react";
import {
  getProjection,
  affectedSessions,
  localDateTimeToEpoch,
  type AppState,
  type Trip,
} from "./domain";
import {
  Icon,
  formatDate,
  formatTime,
  inputDateTime,
  uid,
  courseName,
} from "./ui";
import { PageHeader, TripImage, BudgetStatus, Coverage } from "./Overview";

export function TripSimulator({
  state,
  initialTripId,
  onChange,
  onSession,
  onAssessment,
  onConfirm,
}: {
  state: AppState;
  initialTripId?: string;
  onChange: (
    fn: (s: AppState) => AppState,
    message?: string,
  ) => Promise<boolean>;
  onSession: (id: string) => void;
  onAssessment: (id: string) => void;
  onConfirm: (
    title: string,
    text: string,
    action: () => void | Promise<unknown>,
  ) => void;
}) {
  const initial = state.trips.find((t) => t.id === initialTripId);
  const draftOf = (t?: Trip) => ({
    id: t?.id,
    name: t?.name ?? "",
    departure: inputDateTime(t?.departureAt),
    returnTime: inputDateTime(t?.returnAt),
    status: t?.status ?? ("tentative" as Trip["status"]),
    before: t?.departureBufferMinutes ?? 0,
    after: t?.returnBufferMinutes ?? 0,
    notes: t?.notes ?? "",
  });
  const [draft, setDraft] = useState(() => draftOf(initial));
  const [analysis, setAnalysis] = useState<Trip | null>(initial ?? null);
  const [error, setError] = useState("");
  const [compare, setCompare] = useState<string[]>([]);
  const field = (patch: Partial<typeof draft>) => {
    setDraft({ ...draft, ...patch });
    setAnalysis(null);
  };
  const parse = (): Trip => {
    const departureAt = localDateTimeToEpoch(draft.departure),
      returnAt = localDateTimeToEpoch(draft.returnTime);
    if (!draft.name.trim() || returnAt <= departureAt)
      throw new Error("Enter a trip name and a return after departure.");
    if (
      !Number.isInteger(draft.before) ||
      !Number.isInteger(draft.after) ||
      draft.before < 0 ||
      draft.after < 0
    )
      throw new Error("Travel buffers must be non-negative whole minutes.");
    return {
      id: draft.id ?? "draft-trip",
      name: draft.name.trim(),
      departureAt,
      returnAt,
      status: draft.status,
      departureBufferMinutes: draft.before,
      returnBufferMinutes: draft.after,
      notes: draft.notes,
    };
  };
  const analyze = () => {
    try {
      setAnalysis(parse());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check trip details.");
    }
  };
  const save = async () => {
    try {
      const trip = parse();
      trip.id = draft.id ?? uid("trip");
      const saved = await onChange(
        (s) => ({
          ...s,
          trips: s.trips.some((t) => t.id === trip.id)
            ? s.trips.map((t) => (t.id === trip.id ? { ...t, ...trip } : t))
            : [...s.trips, trip],
        }),
        "Trip saved. Attendance records are unchanged.",
      );
      if (saved) {
        setDraft(draftOf(trip));
        setAnalysis(trip);
        setError("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check trip details.");
    }
  };
  const baselineState = {
    ...state,
    trips: state.trips.filter((t) => t.id !== analysis?.id),
  };
  const baseline = getProjection(baselineState);
  const analyzedState = analysis
    ? { ...baselineState, trips: [...baselineState.trips, analysis] }
    : state;
  const projected = analysis
    ? getProjection(analyzedState, {
        id: "preview",
        name: "Preview",
        enabled: true,
        tripIds: [analysis.id],
      })
    : null;
  const affected = analysis ? affectedSessions(state, analysis) : [];
  const affectedIds = new Set(affected.map((s) => s.courseId));
  const units = affected.reduce((n, s) => n + s.units.length, 0);
  const options = [
    { name: "Current confirmed plans", projection: baseline },
    ...state.trips
      .filter((t) => compare.includes(t.id) && t.status === "tentative")
      .map((t) => ({
        name: t.name,
        projection: getProjection(baselineState, {
          id: "compare",
          name: t.name,
          enabled: true,
          tripIds: [t.id],
        }),
      })),
    ...(projected ? [{ name: "With this trip", projection: projected }] : []),
  ];
  return (
    <>
      <PageHeader />
      <section className="panel simulator">
        <div className="section-heading">
          <div>
            <h2>
              <Icon name="plane" />
              Trip Simulator
            </h2>
            <p>
              Explore potential trips and see how they could affect your
              attendance.
            </p>
          </div>
        </div>
        <div className="notice info">
          <Icon name="info" />
          <div>
            <strong>Scenarios change projections only.</strong>
            <p>
              They never record attendance or confirm a tentative trip for you.
            </p>
          </div>
        </div>
        <div className="trip-workspace">
          <form
            className="panel trip-form"
            onSubmit={(e) => {
              e.preventDefault();
              analyze();
            }}
          >
            <h3>Trip details</h3>
            <div className="field-grid">
              <label className="field full">
                Trip name
                <input
                  value={draft.name}
                  onChange={(e) => field({ name: e.target.value })}
                  placeholder="e.g. Lisbon weekend"
                  required
                />
              </label>
              <label className="field">
                Departure · Madrid time
                <input
                  type="datetime-local"
                  value={draft.departure}
                  onChange={(e) => field({ departure: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                Return · Madrid time
                <input
                  type="datetime-local"
                  value={draft.returnTime}
                  onChange={(e) => field({ returnTime: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                Buffer before departure
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.before}
                  onChange={(e) => field({ before: Number(e.target.value) })}
                />
                <small>Minutes away before departure</small>
              </label>
              <label className="field">
                Buffer after return
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.after}
                  onChange={(e) => field({ after: Number(e.target.value) })}
                />
                <small>Minutes away after return</small>
              </label>
              <label className="field">
                Status
                <select
                  value={draft.status}
                  onChange={(e) =>
                    field({ status: e.target.value as Trip["status"] })
                  }
                >
                  <option value="tentative">Tentative</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label className="field full">
                Notes (optional)
                <textarea
                  rows={3}
                  value={draft.notes}
                  onChange={(e) => field({ notes: e.target.value })}
                  placeholder="Plans, itinerary, or links…"
                />
              </label>
            </div>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button className="button primary" type="submit">
                <Icon name="plane" />
                Analyze trip
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setDraft(draftOf());
                  setAnalysis(null);
                  setError("");
                }}
              >
                Clear form
              </button>
              {draft.id && (
                <button
                  className="text-button danger"
                  type="button"
                  onClick={() =>
                    onConfirm(
                      "Delete trip?",
                      "Attendance records will not change.",
                      async () => {
                        const removed = await onChange((s) => ({
                          ...s,
                          trips: s.trips.filter((t) => t.id !== draft.id),
                          scenarios: s.scenarios.map((v) => ({
                            ...v,
                            tripIds: v.tripIds?.filter((id) => id !== draft.id),
                          })),
                        }));
                        if (removed) {
                          setDraft(draftOf());
                          setAnalysis(null);
                        }
                      },
                    )
                  }
                >
                  Delete trip
                </button>
              )}
            </div>
          </form>
          <section className="panel saved-trips">
            <div className="section-heading">
              <h3>Saved trips</h3>
              <button
                className="text-button"
                onClick={() => {
                  setDraft(draftOf());
                  setAnalysis(null);
                }}
              >
                <Icon name="plus" />
                New trip
              </button>
            </div>
            {state.trips.map((t) => (
              <div className="saved-trip" key={t.id}>
                <button
                  className={
                    "trip-row " + (draft.id === t.id ? "selected" : "")
                  }
                  onClick={() => {
                    setDraft(draftOf(t));
                    setAnalysis(t);
                    setError("");
                  }}
                >
                  <TripImage trip={t} />
                  <span className="row-copy">
                    <strong>{t.name}</strong>
                    <span>
                      {formatDate(t.departureAt)} – {formatDate(t.returnAt)}
                    </span>
                    <small>{t.status}</small>
                  </span>
                  <Icon name="arrow-right" />
                </button>
                {t.status === "tentative" && (
                  <label className="compare-check">
                    <input
                      type="checkbox"
                      checked={compare.includes(t.id)}
                      onChange={(e) =>
                        setCompare(
                          e.target.checked
                            ? [...compare, t.id]
                            : compare.filter((id) => id !== t.id),
                        )
                      }
                    />
                    Compare this option
                  </label>
                )}
              </div>
            ))}
          </section>
        </div>
        {!analysis ? (
          <div className="trip-empty">
            <span className="empty-plane">
              <Icon name="plane" />
            </span>
            <h3>Enter your trip dates to see the impact</h3>
            <p>
              See the affected classes and how this trip fits
              <br />
              within each course’s attendance allowance.
            </p>
          </div>
        ) : (
          projected && (
            <section className="simulation-results">
              <h3>Simulation results</h3>
              <div className="impact-stats">
                <div>
                  <Icon name="calendar" />
                  <span>
                    Total affected attendance units<strong>{units}</strong>
                    <small>across {affected.length} known blocks</small>
                  </span>
                </div>
                <div>
                  <Icon name="alert" />
                  <span>
                    Assessment conflicts
                    <strong>{projected.assessmentConflicts.length}</strong>
                    <small>in this projected plan</small>
                  </span>
                </div>
                <div>
                  <Icon name="book" />
                  <span>
                    Courses affected<strong>{affectedIds.size}</strong>
                    <small>of {state.courses.length} courses</small>
                  </span>
                </div>
              </div>
              <Coverage state={state} />
              {projected.assessmentConflicts.map((a) => (
                <button
                  key={a.id}
                  className="notice error full-width conflict-button"
                  onClick={() => onAssessment(a.id)}
                >
                  <Icon name="alert" />
                  <span>
                    <strong>
                      {a.confidence === "confirmed" &&
                      (a.type === "exam" || a.type === "presentation")
                        ? "High-risk assessment conflict"
                        : "Assessment conflict"}
                      : {a.title}
                    </strong>
                    <small>
                      {courseName(state, a.courseId)} · {formatDate(a.startsAt)}{" "}
                      · {a.confidence}
                    </small>
                  </span>
                  <Icon name="arrow-right" />
                </button>
              ))}
              <h3>Courses affected by this trip</h3>
              <div className="impact-table">
                <div className="impact-row heading">
                  <span>Course</span>
                  <span>Before · remaining</span>
                  <span>Trip units</span>
                  <span>After · remaining</span>
                  <span>Status</span>
                </div>
                {projected.courses
                  .filter(
                    (c) =>
                      affectedIds.has(c.courseId) ||
                      c.projectedAbsences !==
                        baseline.courses.find((v) => v.courseId === c.courseId)
                          ?.projectedAbsences,
                  )
                  .map((c) => {
                    const before = baseline.courses.find(
                      (v) => v.courseId === c.courseId,
                    )!;
                    return (
                      <div className="impact-row" key={c.courseId}>
                        <strong>{courseName(state, c.courseId)}</strong>
                        <span data-label="Before">
                          {before.allowance - before.projectedAbsences} /{" "}
                          {before.allowance}
                        </span>
                        <span data-label="Trip units">
                          {affected
                            .filter((s) => s.courseId === c.courseId)
                            .reduce((n, s) => n + s.units.length, 0)}
                        </span>
                        <span data-label="After">
                          {c.allowance - c.projectedAbsences} / {c.allowance}
                        </span>
                        <BudgetStatus
                          value={c}
                          incomplete={state.scheduleCoverage === "incomplete"}
                        />
                      </div>
                    );
                  })}
              </div>
              {!affected.length && (
                <p className="notice info">
                  No attendance conflicts in the known schedule. Check coverage
                  and assessment conflicts before deciding.
                </p>
              )}
              <details className="affected-details">
                <summary>
                  View all affected class blocks ({affected.length})
                </summary>
                {affected.map((s) => (
                  <button
                    className="unit-ledger-row"
                    key={s.id}
                    onClick={() => onSession(s.id)}
                  >
                    <time>
                      {formatDate(s.startsAt)}
                      <small>{formatTime(s.startsAt)}</small>
                    </time>
                    <strong>
                      {courseName(state, s.courseId)}
                      <small>{s.units.map((u) => u.label).join(" · ")}</small>
                    </strong>
                    <Icon name="arrow-right" />
                  </button>
                ))}
              </details>
              <h3>Scenario comparison</h3>
              <div className="scenario-comparison">
                {options.map((o, i) => (
                  <section className="comparison-option" key={o.name + i}>
                    <h4>{o.name}</h4>
                    {o.projection.courses.map((c) => (
                      <div key={c.courseId}>
                        <span>{courseName(state, c.courseId)}</span>
                        <strong
                          className={
                            c.projectedAbsences > c.allowance ? "danger" : ""
                          }
                        >
                          {c.projectedAbsences} / {c.allowance}
                        </strong>
                      </div>
                    ))}
                    <small>Projected absences / allowance</small>
                  </section>
                ))}
              </div>
              <footer className="simulation-footer">
                <p>
                  <strong>
                    {projected.courses.some(
                      (c) => c.projectedAbsences > c.allowance,
                    )
                      ? "This plan exceeds a course allowance."
                      : projected.assessmentConflicts.length
                        ? "Review assessment conflicts before confirming."
                        : "Review the known impact before confirming."}
                  </strong>
                  <small>
                    Actual attendance is unchanged. Unknown history may change
                    these estimates.
                  </small>
                </p>
                <button className="button primary" onClick={() => void save()}>
                  <Icon name="check" />
                  Save trip
                </button>
              </footer>
            </section>
          )
        )}
      </section>
    </>
  );
}

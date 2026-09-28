import { readPlannerFile } from "./limits";
import { useEffect, useRef, useState } from "react";
import type { AppState, Trip } from "./domain";
import {
  previewCsv,
  previewIcs,
  finalized,
  commitImport,
  suggestedCourseResolutions,
  type ImportAs,
  type ImportCourseResolution,
  type ImportPreview,
  type ImportResolution,
} from "./importers";
import { Icon, formatDate, formatTime } from "./ui";

export function ImportView({
  state,
  onCommit,
  onClose,
}: {
  state: AppState;
  onCommit: (s: AppState) => Promise<boolean>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"csv" | "ics">("csv");
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState("Pasted data");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [resolutions, setResolutions] = useState<
    Record<string, ImportResolution>
  >({});
  const [courseResolutions, setCourseResolutions] = useState<
    Record<string, ImportCourseResolution>
  >({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ count: number; action: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const action = useRef(0);
  const sourceState = useRef(state);
  if (sourceState.current !== state) {
    sourceState.current = state;
    action.current += 1;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      action.current += 1;
    };
  }, []);
  const isCurrentAction = (candidate: number) =>
    mounted.current && action.current === candidate;
  const patch = (id: string, change: Partial<ImportResolution>) =>
    setResolutions((r) => ({ ...r, [id]: { ...r[id], ...change } }));
  const patchCourse = (id: string, change: Partial<ImportCourseResolution>) =>
    setCourseResolutions((current) => ({
      ...current,
      [id]: { ...current[id], ...change },
    }));
  const read = async (file?: File) => {
    if (!file) return;
    const currentAction = ++action.current;
    try {
      const contents = await readPlannerFile(file);
      if (!isCurrentAction(currentAction)) return;
      setSource(contents);
      setFilename(file.name);
      setError("");
    } catch {
      if (!isCurrentAction(currentAction)) return;
      setError(
        "Could not read this file. Use a text file no larger than 2 MiB.",
      );
    }
  };
  const inspect = () => {
    try {
      const p =
        kind === "csv" ? previewCsv(source, state) : previewIcs(source, state);
      setPreview(p);
      setCourseResolutions(suggestedCourseResolutions(p, state));
      setResolutions(
        Object.fromEntries(
          p.rows.map((r) => [
            r.id,
            {
              selected: false,
              importAs: kind === "csv" ? "class" : r.suggestedImportAs,
              courseId: r.courseId ?? r.suggestedCourse?.id,
              unitLabels: r.unitLabels,
              assessmentType: r.assessmentType,
              confidence: r.confidence ?? "unknown",
            },
          ]),
        ),
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not preview this file.");
    }
  };
  const rows = (preview?.rows ?? []).map((row) => {
    const resolution = resolutions[row.id];
    const resolved = finalized(row, state, resolution, courseResolutions);
    const blocked =
      resolved.importAs !== "ignore" &&
      resolved.issues.some((i) => i.level === "error");
    const duplicate =
      !!row.sourceId &&
      [...state.sessions, ...state.trips, ...state.assessments].some(
        (s) => s.source === row.source && s.sourceId === row.sourceId,
      );
    const warning =
      resolved.issues.some((i) => i.level === "warning") || duplicate;
    return { row, resolved, blocked, warning, duplicate };
  });
  const ready = rows.filter(
    (r) => !r.blocked && r.resolved.importAs !== "ignore",
  );
  const selected = ready.filter((r) => r.resolved.selected);
  const blockedSelected = rows.filter((r) => r.blocked && r.resolved.selected);
  const ignored = rows.filter((r) => r.resolved.importAs === "ignore");
  const shown = rows.filter(
    (r) =>
      r.row.title.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "ready" &&
          !r.blocked &&
          r.resolved.importAs !== "ignore") ||
        (filter === "warning" && r.warning) ||
        (filter === "blocked" && r.blocked)),
  );
  const shownGroups = [
    {
      key: "ready",
      title: "Ready to import",
      rows: shown.filter(
        (item) =>
          item.resolved.importAs !== "ignore" &&
          !item.duplicate &&
          !item.blocked &&
          !item.warning,
      ),
    },
    {
      key: "review",
      title: "Needs review",
      rows: shown.filter(
        (item) =>
          item.resolved.importAs !== "ignore" &&
          !item.duplicate &&
          (item.blocked || item.warning),
      ),
    },
    {
      key: "ignored",
      title: "Ignored",
      rows: shown.filter((item) => item.resolved.importAs === "ignore"),
    },
    {
      key: "updates",
      title: "Updates to existing events",
      rows: shown.filter(
        (item) => item.resolved.importAs !== "ignore" && item.duplicate,
      ),
    },
  ].filter((group) => group.rows.length > 0);
  const commit = async () => {
    if (!preview || !selected.length) return;
    const currentAction = ++action.current;
    const selectedCount = selected.length;
    setBusy(true);
    setError("");
    try {
      if (blockedSelected.length)
        throw new Error("Resolve every selected row before importing.");
      const next = commitImport(state, preview, resolutions, courseResolutions);
      if (next === state)
        throw new Error("No selected row changed the planner.");
      const acknowledged = await onCommit(next);
      if (!isCurrentAction(currentAction)) return;
      if (acknowledged)
        setDone({ count: selectedCount, action: currentAction });
      else
        setError(
          "Import was not acknowledged. Review the current planner before trying again.",
        );
    } catch (e) {
      if (!isCurrentAction(currentAction)) return;
      setError(e instanceof Error ? e.message : "Import could not be saved.");
    } finally {
      if (isCurrentAction(currentAction)) setBusy(false);
    }
  };
  return (
    <section
      className={"panel import-page " + (!preview ? "import-start" : "")}
    >
      <ol className="steps">
        <li className={!preview ? "current" : "complete"}>
          <span className="step-marker">1</span>
          <span>Get timetable</span>
        </li>
        <li className={preview && done === null ? "current" : ""}>
          <span className="step-marker">2</span>
          <span>Review import</span>
        </li>
        <li className={done !== null ? "current" : ""}>
          <span className="step-marker">3</span>
          <span>Import saved</span>
        </li>
      </ol>
      {done !== null ? (
        <div className="empty">
          <span className="empty-plane">
            <Icon name="check" />
          </span>
          <h1>Import saved</h1>
          <p>{done.count} reviewed rows saved in this browser.</p>
          <button
            className="button primary"
            onClick={() => {
              if (!isCurrentAction(done.action)) return;
              onClose();
            }}
          >
            Back to overview
          </button>
        </div>
      ) : (
        <>
          <div className="section-heading">
            <div>
              <h1>
                {preview
                  ? "Review and confirm import"
                  : "Import timetable data"}
              </h1>
              <p>
                {preview
                  ? "Check each event, fix issues, and choose what to import. Nothing is saved until you click Import selected."
                  : "Bring in your timetable or calendar events. Review every event before it is added to your planner."}
              </p>
            </div>
            {preview && (
              <button className="button" onClick={() => setPreview(null)}>
                <Icon name="arrow-left" />
                Start over
              </button>
            )}
          </div>
          {!preview ? (
            <>
              <div className="segmented import-tabs">
                <button
                  aria-pressed={kind === "csv"}
                  onClick={() => setKind("csv")}
                >
                  <Icon name="file" />
                  CSV (timetable)
                </button>
                <button
                  aria-pressed={kind === "ics"}
                  onClick={() => setKind("ics")}
                >
                  <Icon name="calendar" />
                  ICS (calendar)
                </button>
              </div>
              {kind === "csv" ? (
                <div className="notice info">
                  <Icon name="file" />
                  <div>
                    <strong>Use our CSV template</strong>
                    <p>
                      Explicit course IDs and numbered units make review easier.
                    </p>
                  </div>
                  <a
                    className="button"
                    href="/session-import-template.csv"
                    download
                  >
                    <Icon name="download" />
                    Download CSV template
                  </a>
                </div>
              ) : (
                <section
                  className="blackboard-help"
                  aria-labelledby="blackboard-help-title"
                >
                  <h2 id="blackboard-help-title">
                    Get your Blackboard timetable
                  </h2>
                  <p>
                    Download the private calendar as <strong>learn.ics</strong>,
                    then upload that file here.
                  </p>
                  <ol>
                    <li>
                      In Blackboard, open <strong>Calendar</strong> →{" "}
                      <strong>Settings</strong> → <strong>More Options</strong>{" "}
                      → <strong>Share Calendar</strong>, then copy the private
                      calendar URL.
                    </li>
                    <li>
                      Open a new browser tab, paste the URL there, and check{" "}
                      <strong>Downloads</strong> for <strong>learn.ics</strong>.
                      A blank tab does not necessarily mean the download failed.
                    </li>
                    <li>
                      Return to Skip Budget, upload <strong>learn.ics</strong>,
                      then preview and review every suggestion before importing.
                    </li>
                  </ol>
                  <p className="notice warning">
                    <Icon name="alert" />
                    <span>
                      <strong>Keep the private calendar URL private.</strong> Do
                      not paste it into Skip Budget, rename an HTML or sign-in
                      page to .ics, or share it with a third-party converter.
                      Skip Budget only needs the downloaded{" "}
                      <strong>learn.ics</strong> file.
                    </span>
                  </p>
                  <p>
                    This is a one-time snapshot, not a sync. Course policy and
                    attendance history remain incomplete until you verify them
                    separately.
                  </p>
                </section>
              )}
              <div
                className="drop-zone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void read(e.dataTransfer.files[0]);
                }}
              >
                <Icon name="upload" />
                <h3>Paste or upload your {kind.toUpperCase()} file</h3>
                <p>Drop a file here, or choose one from your computer.</p>
                <label className="button">
                  Choose file
                  <input
                    className="sr-only"
                    type="file"
                    accept={
                      kind === "csv" ? ".csv,text/csv" : ".ics,text/calendar"
                    }
                    onChange={(e) => void read(e.target.files?.[0])}
                  />
                </label>
                <small>{filename}</small>
              </div>
              <label className="field">
                Or paste the file contents
                <textarea
                  rows={5}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder={
                    kind === "csv"
                      ? "source_id,title,start,end,course_id,unit_labels…"
                      : "BEGIN:VCALENDAR…"
                  }
                />
              </label>
              <button
                className="button primary full-width"
                onClick={inspect}
                disabled={!source.trim()}
              >
                <Icon name="list" />
                Preview imported data <Icon name="arrow-right" />
              </button>
              <div className="import-notes">
                <p>
                  <Icon name="info" />
                  <span>
                    <strong>Events are staged before saving</strong>
                    <small>
                      Only selected, valid rows reach your schedule.
                    </small>
                  </span>
                </p>
                <p>
                  <Icon name="calendar" />
                  <span>
                    <strong>ICS suggestions require your confirmation</strong>
                    <small>
                      Course names, units, assessments, and deadlines are
                      suggestions. Unrelated events stay ignored unless you
                      change them.
                    </small>
                  </span>
                </p>
                <p>
                  <Icon name="data" />
                  <span>
                    <strong>The raw file stays in this browser</strong>
                    <small>
                      Only rows you explicitly import are saved to your private
                      planner.
                    </small>
                  </span>
                </p>
              </div>
            </>
          ) : (
            <>
              {preview.issues.map((i, n) => (
                <p className="notice error" key={n}>
                  {i.message}
                </p>
              ))}
              {Object.values(courseResolutions).length > 0 && (
                <section
                  className="course-suggestions"
                  aria-labelledby="course-suggestions-title"
                >
                  <div>
                    <h2 id="course-suggestions-title">
                      Confirm suggested courses
                    </h2>
                    <p>
                      Names and observed unit numbers came from event titles.
                      Confirm each course and enter its verified policy before
                      mapped rows can be imported.
                    </p>
                  </div>
                  {Object.values(courseResolutions).map((course) => (
                    <fieldset key={course.id}>
                      <legend>{course.name}</legend>
                      <label className="course-confirmation">
                        <input
                          type="checkbox"
                          checked={course.confirmed}
                          onChange={(event) =>
                            patchCourse(course.id, {
                              confirmed: event.target.checked,
                            })
                          }
                        />
                        Create this course when selected rows are imported
                      </label>
                      <div className="field-grid">
                        <label className="field full">
                          Course name
                          <input
                            value={course.name}
                            onChange={(event) =>
                              patchCourse(course.id, {
                                name: event.target.value,
                              })
                            }
                            required
                          />
                        </label>
                        <label className="field">
                          Total attendance units
                          <input
                            type="number"
                            min={Math.max(1, course.observedUnits)}
                            step="1"
                            value={course.totalUnits ?? ""}
                            onChange={(event) =>
                              patchCourse(course.id, {
                                totalUnits: event.target.value
                                  ? Number(event.target.value)
                                  : undefined,
                              })
                            }
                          />
                          <small>
                            Observed through unit {course.observedUnits}; the
                            full total is not inferred.
                          </small>
                        </label>
                        <label className="field">
                          Required attendance (%)
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={
                              course.requiredAttendanceBps === undefined
                                ? ""
                                : course.requiredAttendanceBps / 100
                            }
                            onChange={(event) =>
                              patchCourse(course.id, {
                                requiredAttendanceBps: event.target.value
                                  ? Math.round(Number(event.target.value) * 100)
                                  : undefined,
                              })
                            }
                          />
                          <small>
                            Enter a verified course requirement; the calendar
                            does not contain policy.
                          </small>
                        </label>
                      </div>
                    </fieldset>
                  ))}
                </section>
              )}
              <div className="import-summary">
                <strong>
                  {rows.length} rows reviewed<small>{filename}</small>
                </strong>
                <strong>{ready.length} ready</strong>
                <strong className="warning">
                  {rows.filter((r) => r.warning).length} warnings
                </strong>
                <strong className="danger">
                  {rows.filter((r) => r.blocked).length} blocked
                </strong>
                <strong>{ignored.length} ignored</strong>
              </div>
              <div className="toolbar">
                <div className="segmented">
                  {["all", "ready", "warning", "blocked"].map((v) => (
                    <button
                      key={v}
                      aria-pressed={v === filter}
                      onClick={() => setFilter(v)}
                    >
                      {v === "all"
                        ? "All"
                        : v === "ready"
                          ? "Ready"
                          : v === "warning"
                            ? "Warnings"
                            : "Blocked"}
                    </button>
                  ))}
                </div>
                <label className="field">
                  <span className="sr-only">Search events</span>
                  <input
                    placeholder="Search events…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <button
                  className="button"
                  onClick={() =>
                    setResolutions((r) =>
                      Object.fromEntries(
                        rows.map((v) => [
                          v.row.id,
                          {
                            ...r[v.row.id],
                            selected:
                              !v.blocked && v.resolved.importAs !== "ignore",
                          },
                        ]),
                      ),
                    )
                  }
                >
                  Select valid rows
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    setResolutions((r) =>
                      Object.fromEntries(
                        rows.map((v) => [
                          v.row.id,
                          { ...r[v.row.id], selected: false },
                        ]),
                      ),
                    )
                  }
                >
                  Clear selection
                </button>
              </div>
              <div className="import-rows">
                {shownGroups.map((group) => (
                  <section
                    className={`import-group import-group-${group.key}`}
                    aria-labelledby={`import-group-${group.key}`}
                    key={group.key}
                  >
                    <h2 id={`import-group-${group.key}`}>
                      {group.title} <span>({group.rows.length})</span>
                    </h2>
                    <div className="import-group-rows">
                      {group.rows.map(
                        ({ row, resolved, blocked, duplicate }) => (
                          <article
                            className={`import-row ${
                              blocked
                                ? "import-row-blocked"
                                : resolved.importAs === "ignore"
                                  ? "import-row-ignored"
                                  : duplicate
                                    ? "import-row-update"
                                    : "import-row-ready"
                            }`}
                            key={row.id}
                          >
                            <div className="import-row-main">
                              <input
                                type="checkbox"
                                aria-label={"Select " + row.title}
                                checked={!!resolved.selected}
                                disabled={resolved.importAs === "ignore"}
                                onChange={(e) =>
                                  patch(row.id, { selected: e.target.checked })
                                }
                              />
                              <time>
                                {row.startsAt !== undefined
                                  ? formatDate(row.startsAt)
                                  : "Review time"}
                                <small>
                                  {row.startsAt !== undefined
                                    ? resolved.importAs === "deadline"
                                      ? `Due ${formatTime(row.startsAt)}`
                                      : formatTime(row.startsAt)
                                    : "No scheduled time"}
                                </small>
                              </time>
                              <strong>
                                {row.title}
                                <small>{row.source.toUpperCase()}</small>
                              </strong>
                              <label className="field">
                                <span className="sr-only">
                                  Import {row.title} as
                                </span>
                                <select
                                  value={resolved.importAs ?? ""}
                                  onChange={(e) =>
                                    patch(row.id, {
                                      importAs:
                                        (e.target.value as ImportAs) ||
                                        undefined,
                                      selected: e.target.value
                                        ? resolved.selected
                                        : false,
                                    })
                                  }
                                >
                                  <option value="">
                                    Choose classification…
                                  </option>
                                  <option value="ignore">Ignore</option>
                                  <option value="class">Class</option>
                                  <option value="assessment">Assessment</option>
                                  <option value="deadline">
                                    Deadline (due only)
                                  </option>
                                  <option value="trip">Trip</option>
                                </select>
                              </label>
                              {(resolved.importAs === "class" ||
                                resolved.importAs === "assessment" ||
                                resolved.importAs === "deadline") &&
                              !row.cancelled ? (
                                <>
                                  <label className="field">
                                    <span className="sr-only">
                                      Course for {row.title}
                                    </span>
                                    <select
                                      value={resolved.courseId ?? ""}
                                      onChange={(e) =>
                                        patch(row.id, {
                                          courseId: e.target.value,
                                        })
                                      }
                                    >
                                      <option value="">Choose course…</option>
                                      {state.courses.map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {c.name}
                                        </option>
                                      ))}
                                      {Object.values(courseResolutions).length >
                                        0 && (
                                        <optgroup label="Suggested new courses">
                                          {Object.values(courseResolutions).map(
                                            (course) => (
                                              <option
                                                key={course.id}
                                                value={course.id}
                                              >
                                                {course.name}
                                                {course.confirmed
                                                  ? ""
                                                  : " — confirm above"}
                                              </option>
                                            ),
                                          )}
                                        </optgroup>
                                      )}
                                    </select>
                                  </label>
                                  {resolved.importAs === "class" ? (
                                    <label className="field">
                                      <span className="sr-only">
                                        Units for {row.title}
                                      </span>
                                      <input
                                        aria-label={`Units for ${row.title}`}
                                        value={resolved.labels.join(" | ")}
                                        placeholder="Session 5 | Session 6"
                                        onChange={(e) =>
                                          patch(row.id, {
                                            unitLabels: e.target.value
                                              .split("|")
                                              .map((v) => v.trim()),
                                          })
                                        }
                                      />
                                    </label>
                                  ) : (
                                    <label className="field">
                                      <span className="sr-only">
                                        Assessment type for {row.title}
                                      </span>
                                      <select
                                        aria-label={`Assessment type for ${row.title}`}
                                        value={resolved.assessmentType}
                                        onChange={(event) =>
                                          patch(row.id, {
                                            assessmentType: event.target
                                              .value as NonNullable<
                                              ImportResolution["assessmentType"]
                                            >,
                                          })
                                        }
                                      >
                                        <option value="exam">Exam</option>
                                        <option value="presentation">
                                          Presentation
                                        </option>
                                        <option value="assignment">
                                          Assignment
                                        </option>
                                        <option value="other">Other</option>
                                      </select>
                                    </label>
                                  )}
                                </>
                              ) : resolved.importAs === "trip" &&
                                !row.cancelled ? (
                                <label className="field">
                                  <span className="sr-only">
                                    Trip status for {row.title}
                                  </span>
                                  <select
                                    value={resolved.tripStatus ?? ""}
                                    onChange={(e) =>
                                      patch(row.id, {
                                        tripStatus: e.target
                                          .value as Trip["status"],
                                      })
                                    }
                                  >
                                    <option value="">Choose status…</option>
                                    <option value="tentative">Tentative</option>
                                    <option value="confirmed">Confirmed</option>
                                    <option value="cancelled">Cancelled</option>
                                  </select>
                                </label>
                              ) : (
                                <span />
                              )}
                              <span
                                className={
                                  "status " +
                                  (blocked
                                    ? "danger"
                                    : resolved.importAs === "ignore"
                                      ? ""
                                      : duplicate
                                        ? "warning"
                                        : "success")
                                }
                              >
                                {blocked
                                  ? "Needs review"
                                  : resolved.importAs === "ignore"
                                    ? "Ignored"
                                    : row.cancelled
                                      ? "Cancellation"
                                      : duplicate
                                        ? "Update existing"
                                        : "Ready"}
                              </span>
                            </div>
                            {duplicate && (
                              <p className="row-warning">
                                Existing source event: this row updates the
                                matching record instead of adding a duplicate.
                              </p>
                            )}
                            {resolved.issues.map((i, n) => (
                              <p
                                className={
                                  i.level === "error"
                                    ? "row-error"
                                    : "row-warning"
                                }
                                key={n}
                              >
                                {i.message}
                              </p>
                            ))}
                          </article>
                        ),
                      )}
                    </div>
                  </section>
                ))}
              </div>
              <footer className="import-footer">
                <span>
                  <strong>
                    Every selected event must be valid before anything is
                    imported.
                  </strong>
                  <small>
                    {selected.length} valid rows selected ·{" "}
                    {blockedSelected.length} selected rows still need review
                  </small>
                </span>
                <button
                  className="button primary"
                  disabled={
                    !selected.length || blockedSelected.length > 0 || busy
                  }
                  onClick={() => void commit()}
                >
                  <Icon name="upload" />
                  {busy ? "Saving…" : "Import selected"}
                </button>
              </footer>
            </>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <button className="text-button" onClick={onClose}>
            Cancel
          </button>
        </>
      )}
    </section>
  );
}

export function DataView({
  state,
  onExport,
  onRestore,
  onReset,
  onRecover,
  onExample,
  busy,
  recoveryAvailable,
}: {
  state: AppState;
  onExport: () => void;
  onRestore: (file: File) => void;
  onReset: () => void;
  onRecover: () => void;
  onExample: () => void;
  busy: boolean;
  recoveryAvailable: boolean;
}) {
  return (
    <section className="panel data-page">
      <h1>
        <Icon name="data" />
        Data / Backup / Recovery
      </h1>
      <p>
        Your planner stays in this browser. There is no account, server upload,
        or automatic device sync.
      </p>
      <div className="notice info">
        <Icon name="info" />
        <div>
          <strong>Browser storage is not a backup.</strong>
          <p>
            {state.courses.length} courses · {state.sessions.length} class
            blocks · {state.attendance.length} attendance records ·{" "}
            {state.trips.length} trips
          </p>
          <p>
            Clearing site data or losing this browser profile also removes its
            recovery copy. Export regularly.
          </p>
        </div>
      </div>
      <div className="data-action">
        <Icon name="upload" />
        <div>
          <h3>Export JSON backup</h3>
          <p>
            Download the complete planner. Backups may contain your private
            schedule and notes.
          </p>
        </div>
        <button className="button primary" onClick={onExport}>
          Export JSON
        </button>
      </div>
      <div className="data-action">
        <Icon name="download" />
        <div>
          <h3>Restore JSON backup</h3>
          <p>
            Review a validated backup before replacing the planner. Maximum 2
            MiB.
          </p>
        </div>
        <label className="button">
          Restore JSON
          <input
            className="sr-only"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onRestore(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      <div className="data-action">
        <Icon name="restore" />
        <div>
          <h3>Recover previous planner</h3>
          <p>
            Swap with the copy saved before the last reset, restore, or example
            load.
          </p>
        </div>
        <button
          className="button"
          disabled={busy || !recoveryAvailable}
          onClick={onRecover}
        >
          Recover previous data
        </button>
      </div>
      <div className="data-action">
        <Icon name="flask" />
        <div>
          <h3>Try fictional example data</h3>
          <p>
            Invented courses, uncertain attendance, and overlapping travel near
            today. Your current planner is retained for recovery.
          </p>
        </div>
        <button className="button" disabled={busy} onClick={onExample}>
          Load fictional example
        </button>
      </div>
      <div className="data-action">
        <Icon name="trash" />
        <div>
          <h3>Recoverable reset</h3>
          <p>Start empty and retain one previous planner in this browser.</p>
        </div>
        <button className="button danger" disabled={busy} onClick={onReset}>
          Reset with recovery
        </button>
      </div>
      <p className="data-footnote">
        <Icon name="info" />
        Imports and backups stay on this device. Never attach personal calendar
        files to a public issue.
      </p>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  getProjection,
  type AppState,
  type AttendanceStatus,
  type Course,
  type Assessment,
  type Session,
} from "./domain";
import {
  decodeBackup,
  encodeBackup,
  loadState,
  loadRecovery,
  saveState,
  resetWithRecovery,
} from "./persistence";
import {
  emptyPlannerState,
  initializePlanner,
  recordAttendance,
  applySessionEdit,
  type SessionEdits,
} from "./state";
import { exampleState } from "./seed";
import { readPlannerFile } from "./limits";
import { Icon, Dialog, todayInMadrid } from "./ui";
import { Overview } from "./Overview";
import { Schedule } from "./Schedule";
import { CourseDialog, SessionDialog, AssessmentDialog } from "./Editors";
import { TripSimulator } from "./Trips";
import { ImportView, DataView } from "./Data";

type View = "overview" | "schedule" | "trips" | "import" | "data";
type Attempt = { candidate: AppState; recovery: boolean; message: string };

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const latest = useRef<AppState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [pending, setPending] = useState<Attempt | null>(null);
  const pendingRef = useRef<Attempt | null>(null);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [importBase, setImportBase] = useState<AppState | null>(null);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [courseEditor, setCourseEditor] = useState<string | null>(null);
  const [sessionEditor, setSessionEditor] = useState<string | null>(null);
  const [assessmentEditor, setAssessmentEditor] = useState<string | null>(null);
  const [tripId, setTripId] = useState<string>();
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    text: string;
    action: () => void | Promise<unknown>;
  } | null>(null);

  useEffect(() => {
    let active = true;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (!navigator.locks)
      setLoadError(
        "Use a current browser on localhost or HTTPS. Safe local editing requires Web Locks.",
      );
    else {
      // ponytail: one editor tab per origin; add revision-based merging only if concurrent editing is needed.
      // Let StrictMode finish its setup/cleanup probe before requesting the lock.
      void Promise.resolve()
        .then(() => {
          if (!active) return;
          return navigator.locks.request(
            "skip-budget-local-editor",
            { ifAvailable: true },
            async (lock) => {
              if (!active) return;
              if (!lock) {
                setLoadError(
                  "This planner is already open in another tab. Close that tab, then retry here.",
                );
                return;
              }
              try {
                const planner = await initializePlanner(loadState, saveState);
                const recovery = await loadRecovery();
                if (active) {
                  latest.current = planner;
                  setState(planner);
                  setRecoveryAvailable(Boolean(recovery));
                }
                await held;
              } catch (caught) {
                if (active)
                  setLoadError(
                    caught instanceof Error
                      ? caught.message
                      : "Could not read browser storage.",
                  );
              }
            },
          );
        })
        .catch((caught) => {
          if (active)
            setLoadError(
              caught instanceof Error
                ? caught.message
                : "Could not lock browser storage.",
            );
        });
    }
    return () => {
      active = false;
      release();
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        saving ||
        pending ||
        courseEditor ||
        sessionEditor ||
        assessmentEditor ||
        view === "trips" ||
        view === "import"
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving, pending, courseEditor, sessionEditor, assessmentEditor, view]);

  const closeEditors = () => {
    setCourseEditor(null);
    setSessionEditor(null);
    setAssessmentEditor(null);
  };
  const perform = async (attempt: Attempt, retry = false): Promise<boolean> => {
    if (!latest.current || busy.current || (pendingRef.current && !retry))
      return false;
    busy.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (attempt.recovery)
        await resetWithRecovery(latest.current, attempt.candidate);
      else await saveState(attempt.candidate);
      latest.current = attempt.candidate;
      setState(attempt.candidate);
      pendingRef.current = null;
      setPending(null);
      if (attempt.recovery) {
        setRecoveryAvailable(true);
        setScenarioId(null);
        setWorkspaceKey((key) => key + 1);
      }
      if (retry || attempt.recovery) closeEditors();
      if (retry) {
        setWorkspaceKey((key) => key + 1);
        setView("overview");
      }
      setNotice(attempt.message);
      return true;
    } catch (caught) {
      pendingRef.current = attempt;
      setPending(attempt);
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save browser data.",
      );
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const commit = (candidate: AppState, message = "Saved in this browser.") =>
    perform({ candidate, recovery: false, message });
  const change = (update: (current: AppState) => AppState, message?: string) =>
    latest.current
      ? commit(update(latest.current), message)
      : Promise.resolve(false);
  const confirm = (
    title: string,
    text: string,
    action: () => void | Promise<unknown>,
  ) => setConfirmation({ title, text, action });
  const go = (next: View) => {
    if (
      (view === "trips" || view === "import") &&
      next !== view &&
      !window.confirm(
        "Leave this workspace? Unsaved trip fields or import selections will be discarded.",
      )
    )
      return;
    if (next === "import" && next !== view) setImportBase(latest.current);
    setView(next);
    window.scrollTo({ top: 0 });
  };
  const openTrip = (id?: string) => {
    if (
      view === "trips" &&
      !window.confirm(
        "Open another trip workspace and discard any unsaved trip fields?",
      )
    )
      return;
    setTripId(id);
    setWorkspaceKey((key) => key + 1);
    go("trips");
  };
  const attendance = (
    sessionId: string,
    unitId: string,
    status: AttendanceStatus | "",
  ) =>
    void change(
      (current) => recordAttendance(current, sessionId, unitId, status),
      "Attendance saved in this browser.",
    );
  const saveCourse = async (course: Course) => {
    if (
      await change((current) => ({
        ...current,
        courses: current.courses.some((c) => c.id === course.id)
          ? current.courses.map((c) => (c.id === course.id ? course : c))
          : [...current.courses, course],
      }))
    )
      setCourseEditor(null);
  };
  const saveSession = async (
    session: Session,
    assessment: Assessment | null,
    _previous?: string,
    edits: SessionEdits = { attendance: {}, planned: {} },
  ) => {
    if (
      await change((current) =>
        applySessionEdit(current, session, assessment, edits),
      )
    )
      setSessionEditor(null);
  };
  const saveAssessment = async (assessment: Assessment) => {
    if (
      await change((current) => ({
        ...current,
        assessments: current.assessments.some((a) => a.id === assessment.id)
          ? current.assessments.map((a) =>
              a.id === assessment.id ? assessment : a,
            )
          : [...current.assessments, assessment],
      }))
    )
      setAssessmentEditor(null);
  };
  const deleteCourse = (id: string) => {
    if (latest.current?.sessions.some((s) => s.courseId === id)) {
      setError(
        "Reassign or delete this course’s class blocks before deleting the course.",
      );
      return;
    }
    confirm(
      "Delete course?",
      "Its assessments will also be removed.",
      async () => {
        if (
          await change((current) => ({
            ...current,
            courses: current.courses.filter((c) => c.id !== id),
            assessments: current.assessments.filter((a) => a.courseId !== id),
          }))
        )
          closeEditors();
      },
    );
  };
  const deleteSession = (id: string) =>
    confirm(
      "Delete class block?",
      "Its attendance and attached assessments will also be removed.",
      async () => {
        if (
          await change((current) => {
            const session = current.sessions.find((s) => s.id === id);
            const removedUnits = new Set(session?.units.map((u) => u.id));
            return {
              ...current,
              sessions: current.sessions.filter((s) => s.id !== id),
              attendance: current.attendance.filter((a) => a.sessionId !== id),
              assessments: current.assessments.filter(
                (a) => a.sessionId !== id && a.id !== session?.assessmentId,
              ),
              scenarios: current.scenarios.map((s) => ({
                ...s,
                plannedUnitIds: s.plannedUnitIds?.filter(
                  (u) => !removedUnits.has(u),
                ),
              })),
            };
          })
        )
          closeEditors();
      },
    );
  const deleteAssessment = (id: string) =>
    confirm(
      "Delete assessment?",
      "Attendance will stay unchanged.",
      async () => {
        if (
          await change((current) => ({
            ...current,
            assessments: current.assessments.filter((a) => a.id !== id),
            sessions: current.sessions.map((s) =>
              s.assessmentId === id ? { ...s, assessmentId: undefined } : s,
            ),
          }))
        )
          closeEditors();
      },
    );
  const exportData = (planner = latest.current, suffix = "") => {
    if (!planner) return;
    const url = URL.createObjectURL(
      new Blob([encodeBackup(planner)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `skip-budget-${todayInMadrid()}${suffix}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const replace = (candidate: AppState, message: string) =>
    perform({ candidate, recovery: true, message });
  const restore = async (file: File) => {
    try {
      const result = decodeBackup(await readPlannerFile(file));
      if (!result.ok) {
        setError(result.errors.join(" "));
        return;
      }
      confirm(
        "Restore JSON backup?",
        `Replace this planner with ${result.value.courses.length} courses and ${result.value.sessions.length} class blocks? The current planner will be retained for recovery.`,
        () =>
          replace(
            result.value,
            "Backup restored. Previous planner retained for recovery.",
          ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not read backup.",
      );
    }
  };
  const reset = () =>
    confirm(
      "Reset to an empty planner?",
      "The current planner will be retained as one recovery copy in this browser.",
      () =>
        replace(
          emptyPlannerState(),
          "Planner reset. Previous data retained for recovery.",
        ),
    );
  const loadExample = () =>
    confirm(
      "Load fictional example data?",
      "Replace this planner with invented courses and trips near today. The current planner will be retained for recovery.",
      () =>
        replace(
          exampleState(),
          "Fictional example loaded. Previous planner retained for recovery.",
        ),
    );
  const recover = () =>
    confirm(
      "Recover previous planner?",
      "Swap the current planner with the copy retained before the last reset or restore.",
      async () => {
        try {
          const previous = await loadRecovery();
          if (!previous) throw new Error("No recovery copy is available.");
          await replace(previous, "Previous planner recovered.");
        } catch (caught) {
          setError(
            caught instanceof Error ? caught.message : "Recovery failed.",
          );
        }
      },
    );
  const addScenario = async () => {
    const name = window.prompt("Name this what-if scenario");
    if (!name?.trim()) return;
    const id = crypto.randomUUID();
    if (
      await change((current) => ({
        ...current,
        scenarios: [
          ...current.scenarios,
          {
            id,
            name: name.trim(),
            enabled: false,
            plannedUnitIds: [],
            tripIds: [],
          },
        ],
      }))
    )
      setScenarioId(id);
  };

  if (!state)
    return (
      <main className="loading">
        <span className="brand-mark">SB</span>
        <h1>
          {loadError
            ? "Your planner could not be opened"
            : "Opening your local planner…"}
        </h1>
        {loadError ? (
          <>
            <p role="alert">{loadError}</p>
            <p>Existing planner data has not been replaced.</p>
            <button
              className="button primary"
              onClick={() => window.location.reload()}
            >
              Retry opening planner
            </button>
          </>
        ) : (
          <span className="spinner" role="status" aria-label="Loading" />
        )}
      </main>
    );
  const scenario = state.scenarios.find((s) => s.id === scenarioId);
  const projection = getProjection(
    state,
    scenario ? { ...scenario, enabled: true } : null,
  );
  const nav = [
    ["overview", "Overview", "home"],
    ["schedule", "Schedule", "calendar"],
    ["trips", "Trip Simulator", "plane"],
  ] as const;
  const suspended = saving || Boolean(pending) || Boolean(confirmation);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => go("overview")}>
            <span className="brand-mark">SB</span>
            <span>
              Skip Budget<small>Local edition</small>
            </span>
          </button>
          <nav className="primary-nav" aria-label="Main navigation">
            {nav.map(([id, label]) => (
              <button
                key={id}
                className="nav-button"
                aria-current={view === id ? "page" : undefined}
                onClick={() => (id === "trips" ? openTrip() : go(id))}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="top-actions">
            <button className="button primary" onClick={() => go("import")}>
              <Icon name="upload" />
              Import
            </button>
            <button className="button" onClick={() => go("data")}>
              <Icon name="data" />
              Data / Backup
            </button>
          </div>
        </div>
      </header>
      <main className="page" id="main" inert={saving || Boolean(pending)}>
        {state.source?.source === "Fictional example data" && (
          <p className="notice info">
            Fictional example data — these are invented records. Reset in Data /
            Backup before entering your own planner.
          </p>
        )}
        {view === "overview" && (
          <>
            <Overview
              state={state}
              projection={projection}
              confirmed={getProjection(state)}
              scenarioId={scenarioId}
              onScenario={setScenarioId}
              onCourse={setCourseEditor}
              onSession={setSessionEditor}
              onTrip={openTrip}
              onSchedule={() => go("schedule")}
              onAttendance={attendance}
            />
            <div className="form-actions">
              <button className="button" onClick={addScenario}>
                <Icon name="flask" />
                New what-if scenario
              </button>
              <button className="button" onClick={loadExample}>
                Load fictional example
              </button>
            </div>
            {scenario && (
              <p className="muted">
                Add planned skips in a class editor.{" "}
                <button
                  className="text-button"
                  onClick={() =>
                    confirm(
                      "Delete scenario?",
                      "This does not change actual attendance.",
                      async () => {
                        if (
                          await change((current) => ({
                            ...current,
                            scenarios: current.scenarios.filter(
                              (s) => s.id !== scenario.id,
                            ),
                          }))
                        )
                          setScenarioId(null);
                      },
                    )
                  }
                >
                  Delete this scenario
                </button>
              </p>
            )}
          </>
        )}
        {view === "schedule" && (
          <Schedule
            state={state}
            onSession={setSessionEditor}
            onAssessment={setAssessmentEditor}
            onTrip={openTrip}
            onAttendance={attendance}
          />
        )}
        {view === "trips" && (
          <TripSimulator
            key={workspaceKey}
            state={state}
            initialTripId={tripId}
            onChange={change}
            onSession={setSessionEditor}
            onAssessment={setAssessmentEditor}
            onConfirm={confirm}
          />
        )}
        {view === "import" && (
          <ImportView
            key={workspaceKey}
            state={importBase ?? state}
            onCommit={(next) =>
              commit(next, "Reviewed import saved in this browser.")
            }
            onClose={() => setView("overview")}
          />
        )}
        {view === "data" && (
          <DataView
            state={state}
            onExport={() => exportData()}
            onRestore={restore}
            onReset={reset}
            onRecover={recover}
            recoveryAvailable={recoveryAvailable}
            busy={saving}
            onExample={loadExample}
          />
        )}
      </main>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {nav.map(([id, label, icon]) => (
          <button
            key={id}
            aria-current={view === id ? "page" : undefined}
            onClick={() => (id === "trips" ? openTrip() : go(id))}
          >
            <Icon name={icon} />
            {id === "trips" ? "Trips" : label}
          </button>
        ))}
        <button
          aria-current={
            view === "data" || view === "import" ? "page" : undefined
          }
          onClick={() => go("data")}
        >
          <Icon name="data" />
          More
        </button>
      </nav>
      {courseEditor && (
        <CourseDialog
          key={courseEditor}
          open={!suspended}
          course={state.courses.find((c) => c.id === courseEditor)}
          state={state}
          projection={projection}
          scenarioId={scenarioId}
          onClose={() => setCourseEditor(null)}
          onSave={saveCourse}
          onDelete={deleteCourse}
          onSession={(id) => {
            setCourseEditor(null);
            setSessionEditor(id);
          }}
        />
      )}
      {sessionEditor && (
        <SessionDialog
          key={sessionEditor}
          open={!suspended}
          session={state.sessions.find((s) => s.id === sessionEditor)}
          state={state}
          scenarioId={scenarioId}
          onClose={() => setSessionEditor(null)}
          onSave={saveSession}
          onDelete={deleteSession}
        />
      )}
      {assessmentEditor && (
        <AssessmentDialog
          key={assessmentEditor}
          open={!suspended}
          assessment={state.assessments.find((a) => a.id === assessmentEditor)}
          state={state}
          onClose={() => setAssessmentEditor(null)}
          onSave={saveAssessment}
          onDelete={deleteAssessment}
        />
      )}
      <Dialog
        open={Boolean(confirmation)}
        title={confirmation?.title ?? "Confirm change"}
        onClose={() => setConfirmation(null)}
        footer={
          <>
            <button className="button" onClick={() => setConfirmation(null)}>
              Cancel
            </button>
            <button
              className="button danger"
              onClick={() => {
                const action = confirmation?.action;
                setConfirmation(null);
                void action?.();
              }}
            >
              Confirm
            </button>
          </>
        }
      >
        <p>{confirmation?.text}</p>
      </Dialog>
      <Dialog
        open={Boolean(pending)}
        title="Change not saved"
        dismissible={false}
        onClose={() => {}}
        footer={
          <>
            <button
              className="button primary"
              disabled={saving}
              onClick={() => {
                if (pending) void perform(pending, true);
              }}
            >
              Retry save
            </button>
            <button
              className="button"
              onClick={() => {
                if (pending) exportData(pending.candidate, "-unsaved");
              }}
            >
              Export unsaved change
            </button>
            <button
              className="button"
              disabled={saving}
              onClick={() => {
                if (
                  window.confirm(
                    "Discard the attempted change? The saved planner will stay unchanged.",
                  )
                ) {
                  pendingRef.current = null;
                  setPending(null);
                  setError("");
                  closeEditors();
                  setWorkspaceKey((key) => key + 1);
                }
              }}
            >
              Discard attempted change
            </button>
          </>
        }
      >
        <p role="alert">{error}</p>
        <p>
          Your saved planner is unchanged. The attempted document remains in
          this tab. Retry it or export it before leaving.
        </p>
      </Dialog>
      {saving && (
        <div className="save-indicator" role="status">
          Saving in this browser…
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {error && !pending && (
        <div className="error-banner" role="alert">
          <Icon name="alert" />
          <p>{error}</p>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  );
}

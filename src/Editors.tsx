import type { SessionEdits } from "./state";
import { useState, type FormEvent } from "react";
import {
  MADRID_TIMEZONE,
  localDateTimeToEpoch,
  maxAbsences,
  getProjection,
  assessmentConflicts,
  isPointDeadline,
  assessmentDueAtAfterTimingChange,
  type AppState,
  type Course,
  type Session,
  type Assessment,
  type AttendanceStatus,
} from "./domain";
import {
  Dialog,
  Icon,
  AttendancePicker,
  uid,
  inputDateTime,
  formatDate,
  formatTime,
} from "./ui";
export function CourseDialog({
  open,
  course,
  state,
  projection,
  scenarioId,
  onClose,
  onSave,
  onDelete,
  onSession,
}: {
  open: boolean;
  course?: Course;
  state: AppState;
  projection: ReturnType<typeof getProjection>;
  scenarioId: string | null;
  onClose: () => void;
  onSave: (course: Course) => void;
  onDelete?: (id: string) => void;
  onSession: (id: string) => void;
}) {
  const [name, setName] = useState(course?.name ?? "");
  const [totalUnits, setTotalUnits] = useState(course?.totalUnits ?? 15);
  const [requiredPercent, setRequiredPercent] = useState(
    (course?.requiredAttendanceBps ?? 8000) / 100,
  );
  const [excused, setExcused] = useState<
    NonNullable<Course["excusedTreatment"]>
  >(course?.excusedTreatment ?? "unresolved");
  const [notes, setNotes] = useState(
    course?.policyNotes ??
      "Institutional sanction, resit, and exception rules are not verified here.",
  );
  const [sourceUrl, setSourceUrl] = useState(course?.sourceUrl ?? "");
  const [verifiedAt, setVerifiedAt] = useState(course?.verifiedAt ?? "");
  const [formError, setFormError] = useState("");
  const item = course
    ? projection.courses.find((value) => value.courseId === course.id)
    : undefined;
  const selectedPlannedIds = new Set(
    scenarioId
      ? (state.scenarios.find((scenario) => scenario.id === scenarioId)
          ?.plannedUnitIds ?? [])
      : [],
  );
  const countedSessions = course
    ? state.sessions.filter(
        (session) =>
          session.courseId === course.id &&
          (projection.affectedSessions.some((item) => item.id === session.id) ||
            session.units.some((unit) => selectedPlannedIds.has(unit.id))),
      )
    : [];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (
      !name.trim() ||
      !Number.isInteger(totalUnits) ||
      totalUnits < 1 ||
      requiredPercent < 0 ||
      requiredPercent > 100
    ) {
      setFormError(
        "Enter a course name, a positive whole-unit total, and a requirement from 0 to 100%.",
      );
      return;
    }
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
      setFormError("Policy source links must start with http:// or https://.");
      return;
    }
    onSave({
      ...(course ?? {}),
      id: course?.id ?? uid("course"),
      name: name.trim(),
      totalUnits,
      requiredAttendanceBps: Math.round(requiredPercent * 100),
      excusedTreatment: excused,
      policyNotes: notes.trim(),
      sourceUrl: sourceUrl.trim() || undefined,
      verifiedAt: verifiedAt || undefined,
    });
  };
  const baseline = getProjection(state).courses.find(
    (c) => c.courseId === course?.id,
  );
  return (
    <Dialog
      wide
      open={open}
      title={course ? course.name : "Add course"}
      onClose={onClose}
      footer={
        <>
          {course && onDelete && (
            <button
              className="button danger push-left"
              onClick={() => onDelete(course.id)}
            >
              <Icon name="trash" />
              Delete course
            </button>
          )}
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" form="course-form">
            Save changes
          </button>
        </>
      }
    >
      <div className="course-detail-layout">
        <div className="course-detail-main">
          <div className="course-intro">
            <div>
              <p>Madrid, Spain · Europe/Madrid</p>
              <h3>Your course, unit by unit.</h3>
              <p>
                Review what is recorded, what is planned, and what still needs
                checking.
              </p>
            </div>
          </div>
          {item && (
            <section className="panel attendance-summary">
              <h3>Attendance summary</h3>
              <div className="summary-stats">
                <div>
                  <small>Recorded absences</small>
                  <strong>{item.actualAbsences}</strong>
                </div>
                <div>
                  <small>Past attendance unknown</small>
                  <strong>{item.unknownPastUnits}</strong>
                </div>
                <div>
                  <small>Confirmed planned units</small>
                  <strong>{baseline?.plannedAbsences ?? 0}</strong>
                </div>
                <div>
                  <small>Scenario only units</small>
                  <strong>
                    {item.plannedAbsences - (baseline?.plannedAbsences ?? 0)}
                  </strong>
                </div>
              </div>
              <div
                className={
                  item.projectedAbsences > item.allowance
                    ? "notice error"
                    : "notice info"
                }
              >
                <Icon name="info" />
                <div>
                  <strong>
                    {item.projectedAbsences} projected absences /{" "}
                    {item.allowance} allowed
                  </strong>
                  <p>{item.status} · Unknown history remains unresolved.</p>
                </div>
              </div>
            </section>
          )}
          <section className="panel">
            <h3>Unit-by-unit attendance ledger</h3>
            <div className="unit-ledger">
              {state.sessions
                .filter((s) => s.courseId === course?.id)
                .sort((a, b) => a.startsAt - b.startsAt)
                .flatMap((s) =>
                  s.units.map((u) => {
                    const record = state.attendance.find(
                      (r) => r.unitId === u.id,
                    );
                    const planned =
                      projection.affectedSessions.some((v) => v.id === s.id) ||
                      selectedPlannedIds.has(u.id);
                    const future = s.endsAt >= Date.now();
                    const status =
                      record?.status ??
                      (s.deliveryMode === "async"
                        ? (s.asyncCompletion ?? "unknown")
                        : future
                          ? planned
                            ? "Planned skip"
                            : "Scheduled"
                          : "Unknown");
                    return (
                      <button
                        className="unit-ledger-row"
                        key={u.id}
                        onClick={() => onSession(s.id)}
                      >
                        <time>
                          {formatDate(s.startsAt)}
                          <small>{formatTime(s.startsAt)}</small>
                        </time>
                        <strong>
                          {u.label}
                          <small>
                            {s.title ??
                              (s.deliveryMode === "async"
                                ? "Asynchronous"
                                : "Class block")}
                          </small>
                        </strong>
                        <span
                          className={
                            "status " +
                            (status === "absent"
                              ? "danger"
                              : status === "attended"
                                ? "success"
                                : "")
                          }
                        >
                          {status}
                        </span>
                        <Icon name="arrow-right" />
                      </button>
                    );
                  }),
                )}
            </div>
            {!course && (
              <p className="empty">
                Save this course to start adding class blocks.
              </p>
            )}
          </section>
        </div>
        <form
          id="course-form"
          onSubmit={submit}
          className="course-policy panel"
        >
          <h3>Course policy & rules</h3>
          <label className="field">
            Course name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <div className="field-grid">
            <label className="field">
              Total attendance units
              <input
                type="number"
                min="1"
                step="1"
                value={totalUnits}
                onChange={(e) => setTotalUnits(Number(e.target.value))}
                required
              />
            </label>
            <label className="field">
              Required attendance %
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={requiredPercent}
                onChange={(e) => setRequiredPercent(Number(e.target.value))}
                required
              />
            </label>
          </div>
          <p className="allowance-output">
            Planning allowance{" "}
            <strong>
              {Number.isInteger(totalUnits) &&
              totalUnits > 0 &&
              requiredPercent >= 0 &&
              requiredPercent <= 100
                ? maxAbsences(totalUnits, Math.round(requiredPercent * 100))
                : "—"}{" "}
              units
            </strong>
          </p>
          <label className="field">
            Excused absences
            <select
              value={excused}
              onChange={(e) => setExcused(e.target.value as typeof excused)}
            >
              <option value="unresolved">
                Unresolved — count conservatively
              </option>
              <option value="count">Count as absence</option>
              <option value="exclude">Do not count</option>
            </select>
          </label>
          <label className="field">
            Policy notes
            <textarea
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <label className="field">
            Policy source link
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://…"
            />
          </label>
          <label className="field">
            Last verified
            <input
              type="date"
              value={verifiedAt}
              onChange={(e) => setVerifiedAt(e.target.value)}
            />
          </label>
          <p className="notice info">
            <Icon name="info" />
            Verify the course policy before relying on planning estimates.
          </p>
          {formError && (
            <p className="notice error" role="alert">
              {formError}
            </p>
          )}
        </form>
      </div>
    </Dialog>
  );
}

export function SessionDialog({
  open,
  session,
  state,
  scenarioId,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  session?: Session;
  state: AppState;
  scenarioId: string | null;
  onClose: () => void;
  onSave: (
    session: Session,
    assessment: Assessment | null,
    previousAssessmentId?: string,
    edits?: SessionEdits,
  ) => void;
  onDelete?: (id: string) => void;
}) {
  const existingAssessment = session
    ? state.assessments.find(
        (item) =>
          item.id === session.assessmentId || item.sessionId === session.id,
      )
    : undefined;
  const [attendanceDraft, setAttendanceDraft] = useState<
    Record<string, AttendanceStatus | "">
  >({});
  const [plannedDraft, setPlannedDraft] = useState<Record<string, boolean>>({});
  const [courseId, setCourseId] = useState(
    session?.courseId ?? state.courses[0]?.id ?? "",
  );
  const [title, setTitle] = useState(session?.title ?? "");
  const [start, setStart] = useState(inputDateTime(session?.startsAt));
  const [end, setEnd] = useState(inputDateTime(session?.endsAt));
  const [delivery, setDelivery] = useState(
    session?.deliveryMode ?? "in-person",
  );
  const [labels, setLabels] = useState(
    session?.units.map((unit) => unit.label).join(" | ") ?? "Session ",
  );
  const [notes, setNotes] = useState(session?.notes ?? "");
  const [completion, setCompletion] = useState<
    NonNullable<Session["asyncCompletion"]>
  >(session?.asyncCompletion ?? "unknown");
  const [dueAt, setDueAt] = useState(inputDateTime(session?.asyncDueAt));
  const [assessmentTitle, setAssessmentTitle] = useState(
    existingAssessment?.title ?? "",
  );
  const [assessmentType, setAssessmentType] = useState<
    NonNullable<Assessment["type"]>
  >(existingAssessment?.type ?? "other");
  const [confidence, setConfidence] = useState(
    existingAssessment?.confidence ?? "unknown",
  );
  const [formError, setFormError] = useState("");
  const scenario = state.scenarios.find(
    (item) => item.id === (scenarioId ?? state.scenarios[0]?.id),
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const unitLabels = labels
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!courseId || !start || !end || !unitLabels.length) {
      setFormError(
        "Choose a course, add valid start/end times, and name every attendance unit.",
      );
      return;
    }
    try {
      const startsAt = localDateTimeToEpoch(start);
      const endsAt = localDateTimeToEpoch(end);
      if (endsAt <= startsAt) throw new Error("End must be after start.");
      const id = session?.id ?? uid("session");
      const units = unitLabels.map((label, index) => ({
        id: session?.units[index]?.id ?? uid("unit"),
        label,
      }));
      const assessmentId = assessmentTitle.trim()
        ? (existingAssessment?.id ?? uid("assessment"))
        : undefined;
      const next: Session = {
        ...(session ?? {}),
        id,
        courseId,
        title: title.trim() || undefined,
        startsAt,
        endsAt,
        timezone: MADRID_TIMEZONE,
        units,
        deliveryMode: delivery,
        notes: notes.trim() || undefined,
        asyncCompletion: delivery === "async" ? completion : undefined,
        asyncDueAt:
          delivery === "async" && dueAt
            ? localDateTimeToEpoch(dueAt)
            : undefined,
        publishedWindow: delivery === "async",
        assessmentId,
      };
      const assessment = assessmentId
        ? ({
            ...(existingAssessment ?? {}),
            id: assessmentId,
            courseId,
            sessionId: id,
            title: assessmentTitle.trim(),
            startsAt,
            endsAt,
            confidence,
            type: assessmentType,
          } as Assessment)
        : null;
      onSave(next, assessment, existingAssessment?.id, {
        attendance: attendanceDraft,
        planned: plannedDraft,
        scenarioId: scenario?.id,
      });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Check the Madrid date and time values.",
      );
    }
  };
  return (
    <Dialog
      open={open}
      title={
        delivery === "async"
          ? "Asynchronous class editor"
          : session
            ? "Class block editor"
            : "Add class block"
      }
      onClose={onClose}
      footer={
        <>
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" form="session-form">
            Save class
          </button>
        </>
      }
    >
      {session && delivery !== "async" && (
        <section className="attendance-first">
          <h3>Record attendance</h3>
          <p className="drawer-note">
            Each unit shares this block’s time. Changes stay in this draft until
            Save.
          </p>
          {session.units.map((unit) => {
            const attendance =
              attendanceDraft[unit.id] ??
              state.attendance.find(
                (record) =>
                  record.sessionId === session.id && record.unitId === unit.id,
              )?.status ??
              "";
            const planned =
              plannedDraft[unit.id] ??
              scenario?.plannedUnitIds?.includes(unit.id) ??
              false;
            return (
              <div className="unit-row" key={unit.id}>
                <strong>{unit.label}</strong>
                <AttendancePicker
                  value={attendance}
                  onChange={(status) =>
                    setAttendanceDraft((current) => ({
                      ...current,
                      [unit.id]: status,
                    }))
                  }
                  label={`Attendance for ${unit.label}`}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={planned}
                    disabled={!scenario}
                    onChange={(event) =>
                      setPlannedDraft((current) => ({
                        ...current,
                        [unit.id]: event.target.checked,
                      }))
                    }
                  />{" "}
                  Planned skip in {scenario?.name ?? "what-if"}
                </label>
              </div>
            );
          })}
        </section>
      )}
      <form id="session-form" onSubmit={submit}>
        <p className="drawer-note">
          Times are interpreted in Europe/Madrid. A double block needs two
          explicit unit labels; duration never decides the attendance cost.
        </p>
        <div className="field-grid">
          <label className="field full">
            <span>Course</span>
            <select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
            >
              {state.courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field full">
            <span>Block title (optional)</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Class, workshop, presentation…"
            />
          </label>
          <label className="field">
            <span>Starts · Madrid time</span>
            <input
              type="datetime-local"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Ends · Madrid time</span>
            <input
              type="datetime-local"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Delivery mode</span>
            <select
              value={delivery}
              onChange={(event) =>
                setDelivery(event.target.value as Session["deliveryMode"])
              }
            >
              <option value="in-person">In person</option>
              <option value="online">Live online</option>
              <option value="async">Asynchronous</option>
            </select>
          </label>
          <label className="field">
            <span>Numbered attendance units</span>
            <input
              value={labels}
              onChange={(event) => setLabels(event.target.value)}
              placeholder="Session 7 | Session 8"
            />
            <small>Separate units with a vertical bar.</small>
          </label>
          {delivery === "async" ? (
            <>
              <label className="field">
                <span>Completion</span>
                <select
                  value={completion}
                  onChange={(event) =>
                    setCompletion(
                      event.target.value as NonNullable<
                        Session["asyncCompletion"]
                      >,
                    )
                  }
                >
                  <option value="unknown">Unknown</option>
                  <option value="not-started">Not started</option>
                  <option value="in-progress">In progress</option>
                  <option value="complete">Complete</option>
                </select>
              </label>
              <label className="field">
                <span>Due time, if verified</span>
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
                <small>
                  Leave blank for a published window with no known deadline.
                </small>
              </label>
            </>
          ) : null}
          <label className="field full">
            <span>Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>
        <div className="unit-editor">
          <h3>Assessment in this block</h3>
          <div className="field-grid">
            <label className="field full">
              <span>Assessment title (optional)</span>
              <input
                value={assessmentTitle}
                onChange={(event) => setAssessmentTitle(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Type</span>
              <select
                value={assessmentType}
                onChange={(event) =>
                  setAssessmentType(
                    event.target.value as NonNullable<Assessment["type"]>,
                  )
                }
              >
                <option value="exam">Exam</option>
                <option value="presentation">Presentation</option>
                <option value="assignment">Assignment</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="field">
              <span>Confidence</span>
              <select
                value={confidence}
                onChange={(event) =>
                  setConfidence(event.target.value as Assessment["confidence"])
                }
              >
                <option value="confirmed">Confirmed</option>
                <option value="tentative">Tentative</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
          </div>
        </div>
        {formError ? (
          <p className="notice error" role="alert">
            {formError}
          </p>
        ) : null}
      </form>

      {session && onDelete ? (
        <div className="form-actions">
          <button
            className="button danger"
            type="button"
            onClick={() => onDelete(session.id)}
          >
            <Icon name="trash" /> Delete class block
          </button>
        </div>
      ) : null}
    </Dialog>
  );
}

export function AssessmentDialog({
  open,
  assessment,
  state,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  assessment?: Assessment;
  state: AppState;
  onClose: () => void;
  onSave: (assessment: Assessment) => void;
  onDelete?: (id: string) => void;
}) {
  const [courseId, setCourseId] = useState(
    assessment?.courseId ?? state.courses[0]?.id ?? "",
  );
  const [title, setTitle] = useState(assessment?.title ?? "");
  const [start, setStart] = useState(inputDateTime(assessment?.startsAt));
  const [end, setEnd] = useState(inputDateTime(assessment?.endsAt));
  const [deadline, setDeadline] = useState(
    assessment ? isPointDeadline(assessment) : false,
  );
  const [due, setDue] = useState(
    inputDateTime(assessment?.dueAt ?? assessment?.startsAt),
  );
  const [type, setType] = useState<NonNullable<Assessment["type"]>>(
    assessment?.type ?? "exam",
  );
  const [confidence, setConfidence] = useState(
    assessment?.confidence ?? "unknown",
  );
  const [notes, setNotes] = useState(assessment?.notes ?? "");
  const [formError, setFormError] = useState("");
  const conflicts = assessment
    ? assessmentConflicts({ ...state, assessments: [assessment] })
    : [];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      if (!title.trim() || !courseId)
        throw new Error("Enter a title and course.");
      const startsAt = localDateTimeToEpoch(deadline ? due : start);
      const endsAt = deadline ? startsAt : localDateTimeToEpoch(end);
      if (!deadline && endsAt <= startsAt)
        throw new Error("Enter an end after the start.");
      onSave({
        ...(assessment ?? {}),
        id: assessment?.id ?? uid("assessment"),
        courseId,
        title: title.trim(),
        startsAt,
        endsAt,
        dueAt: assessmentDueAtAfterTimingChange(assessment, deadline, startsAt),
        type,
        confidence,
        notes: notes.trim() || undefined,
      });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Check the assessment details.",
      );
    }
  };
  return (
    <Dialog
      open={open}
      title={
        assessment
          ? "Edit assessment or deadline"
          : "Add assessment or deadline"
      }
      onClose={onClose}
      footer={
        <>
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            form="assessment-form"
          >
            Save
          </button>
        </>
      }
    >
      {conflicts.length > 0 && (
        <div className="notice error">
          <Icon name="alert" />
          <div>
            <strong>
              {assessment?.confidence === "confirmed" &&
              (type === "exam" || type === "presentation")
                ? "High-risk conflict"
                : "Assessment conflict"}
            </strong>
            <p>
              Confirmed travel overlaps this assessment. Spare attendance
              allowance does not remove the conflict.
            </p>
          </div>
        </div>
      )}
      <form id="assessment-form" onSubmit={submit}>
        <div className="field-grid">
          <label className="field full">
            <span>Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </label>
          <label className="field full">
            <span>Course</span>
            <select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
            >
              {state.courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field full">
            <span>Timing</span>
            <select
              value={deadline ? "deadline" : "range"}
              onChange={(event) =>
                setDeadline(event.target.value === "deadline")
              }
            >
              <option value="range">Scheduled time range</option>
              <option value="deadline">Due time only</option>
            </select>
          </label>
          {deadline ? (
            <label className="field full">
              <span>Due · Madrid time</span>
              <input
                type="datetime-local"
                value={due}
                onChange={(event) => setDue(event.target.value)}
                required
              />
              <small>A due-only deadline has no invented duration.</small>
            </label>
          ) : (
            <>
              <label className="field">
                <span>Starts · Madrid time</span>
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Ends · Madrid time</span>
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  required
                />
              </label>
            </>
          )}
          <label className="field">
            <span>Type</span>
            <select
              value={type}
              onChange={(event) =>
                setType(event.target.value as NonNullable<Assessment["type"]>)
              }
            >
              <option value="exam">Exam</option>
              <option value="presentation">Presentation</option>
              <option value="assignment">Assignment</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="field">
            <span>Confidence</span>
            <select
              value={confidence}
              onChange={(event) =>
                setConfidence(event.target.value as Assessment["confidence"])
              }
            >
              <option value="confirmed">Confirmed</option>
              <option value="tentative">Tentative</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label className="field full">
            <span>Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>
        {formError ? (
          <p className="notice error" role="alert">
            {formError}
          </p>
        ) : null}
      </form>
      {assessment && onDelete ? (
        <div className="form-actions">
          <button
            className="button danger"
            onClick={() => onDelete(assessment.id)}
          >
            <Icon name="trash" /> Delete assessment
          </button>
        </div>
      ) : null}
    </Dialog>
  );
}

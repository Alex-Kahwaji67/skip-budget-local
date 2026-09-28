import type { AppState } from "./domain";
import { checkTextSize, MAX_RECORDS } from "./limits";

const DB_NAME = "skip-budget-local";
const STORE_NAME = "documents";
const CURRENT_KEY = "current";
const RECOVERY_KEY = "pre-reset";

export type ValidationResult<T> =
  { ok: true; value: T; errors: [] } | { ok: false; errors: string[] };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const textValue = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const finite = (value: unknown) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= 8_640_000_000_000_000;
const optionalText = (value: unknown) =>
  value === undefined || typeof value === "string";
const optionalFinite = (value: unknown) => value === undefined || finite(value);
const oneOf = (value: unknown, values: string[]) =>
  typeof value === "string" && values.includes(value);
const validZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export function validateState(value: unknown): ValidationResult<AppState> {
  const errors: string[] = [];
  if (!record(value))
    return { ok: false, errors: ["Backup data must be an object."] };
  if (value.schemaVersion !== 1)
    errors.push("Only Skip Budget schema version 1 is supported.");
  if (value.timezone !== "Europe/Madrid")
    errors.push("The workspace timezone must be Europe/Madrid.");
  if (
    value.scheduleCoverage !== "incomplete" &&
    value.scheduleCoverage !== "complete"
  ) {
    errors.push("Schedule coverage must be declared complete or incomplete.");
  }

  const keys = [
    "courses",
    "sessions",
    "attendance",
    "assessments",
    "trips",
    "scenarios",
  ] as const;
  for (const key of keys) {
    if (!Array.isArray(value[key])) errors.push(`${key} must be an array.`);
    else if (value[key].length > MAX_RECORDS)
      errors.push(`${key} must contain no more than ${MAX_RECORDS} records.`);
  }
  if (
    value.source !== undefined &&
    (!record(value.source) || !optionalText(value.source.source))
  )
    errors.push("Invalid planner source metadata.");
  if (errors.length) return { ok: false, errors };

  const courses = value.courses as unknown[];
  const sessions = value.sessions as unknown[];
  const attendance = value.attendance as unknown[];
  const assessments = value.assessments as unknown[];
  const trips = value.trips as unknown[];
  const scenarios = value.scenarios as unknown[];
  const ids = (items: unknown[], label: string) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (!record(item) || !textValue(item.id))
        errors.push(`${label} ${index + 1} needs an id.`);
      else if (seen.has(item.id))
        errors.push(`${label} id “${item.id}” is duplicated.`);
      else seen.add(item.id);
    });
    return seen;
  };

  const courseIds = ids(courses, "Course");
  const sessionIds = ids(sessions, "Session");
  ids(attendance, "Attendance record");
  ids(assessments, "Assessment");
  const tripIds = ids(trips, "Trip");
  ids(scenarios, "Scenario");

  courses.forEach((course, index) => {
    if (!record(course)) return;
    if (!textValue(course.name))
      errors.push(`Course ${index + 1} needs a name.`);
    if (
      !Number.isInteger(course.totalUnits) ||
      Number(course.totalUnits) < 1 ||
      Number(course.totalUnits) > 1_000_000
    )
      errors.push(
        `Course ${index + 1} needs a whole-unit total between 1 and 1,000,000.`,
      );
    if (
      !optionalText(course.policyNotes) ||
      !optionalText(course.sourceUrl) ||
      !optionalText(course.verifiedAt)
    )
      errors.push(`Course ${index + 1} has malformed optional fields.`);
    if (
      !Number.isInteger(course.requiredAttendanceBps) ||
      Number(course.requiredAttendanceBps) < 0 ||
      Number(course.requiredAttendanceBps) > 10_000
    ) {
      errors.push(`Course ${index + 1} has an invalid attendance requirement.`);
    }
    if (
      course.excusedTreatment !== undefined &&
      !oneOf(course.excusedTreatment, ["count", "exclude", "unresolved"])
    )
      errors.push(
        `Course ${index + 1} has an invalid excused-absence treatment.`,
      );
  });

  const unitKeys = new Set<string>();
  const sessionUnitKeys = new Set<string>();
  sessions.forEach((session, index) => {
    if (!record(session)) return;
    if (!textValue(session.courseId) || !courseIds.has(session.courseId))
      errors.push(`Session ${index + 1} has no matching course.`);
    if (
      !finite(session.startsAt) ||
      !finite(session.endsAt) ||
      Number(session.endsAt) <= Number(session.startsAt)
    )
      errors.push(`Session ${index + 1} has invalid times.`);
    if (!oneOf(session.deliveryMode, ["in-person", "online", "async"]))
      errors.push(`Session ${index + 1} has an invalid delivery mode.`);
    if (
      session.timezone !== undefined &&
      (!textValue(session.timezone) || !validZone(session.timezone))
    )
      errors.push(`Session ${index + 1} has an invalid timezone.`);
    if (
      session.asyncCompletion !== undefined &&
      !oneOf(session.asyncCompletion, [
        "not-started",
        "in-progress",
        "complete",
        "unknown",
      ])
    )
      errors.push(
        `Session ${index + 1} has an invalid async completion status.`,
      );
    if (
      !optionalFinite(session.asyncDueAt) ||
      !optionalText(session.title) ||
      !optionalText(session.notes)
    )
      errors.push(`Session ${index + 1} has malformed optional fields.`);
    if (!Array.isArray(session.units) || session.units.length === 0)
      errors.push(
        `Session ${index + 1} needs at least one explicit attendance unit.`,
      );
    else if (session.units.length > MAX_RECORDS)
      errors.push(`Session ${index + 1} has too many units.`);
    else
      session.units.forEach((unit, unitIndex) => {
        if (!record(unit) || !textValue(unit.id) || !textValue(unit.label))
          errors.push(
            `Session ${index + 1}, unit ${unitIndex + 1} is invalid.`,
          );
        else if (unitKeys.has(unit.id))
          errors.push(`Session unit id “${unit.id}” is duplicated.`);
        else {
          unitKeys.add(unit.id);
          if (textValue(session.id))
            sessionUnitKeys.add(`${session.id}:${unit.id}`);
        }
      });
  });

  const attendanceKeys = new Set<string>();
  attendance.forEach((entry, index) => {
    if (!record(entry)) return;
    if (!textValue(entry.sessionId) || !sessionIds.has(entry.sessionId))
      errors.push(`Attendance record ${index + 1} has no matching session.`);
    if (
      !textValue(entry.unitId) ||
      !textValue(entry.sessionId) ||
      !sessionUnitKeys.has(`${entry.sessionId}:${entry.unitId}`)
    )
      errors.push(
        `Attendance record ${index + 1} has no matching attendance unit.`,
      );
    else {
      const identity = `${entry.sessionId}:${entry.unitId}`;
      if (attendanceKeys.has(identity))
        errors.push(
          `Attendance record ${index + 1} duplicates a session/unit record.`,
        );
      else attendanceKeys.add(identity);
    }
    if (
      !oneOf(entry.status, ["attended", "absent", "excused"]) ||
      !optionalText(entry.recordedAt) ||
      !optionalText(entry.notes)
    )
      errors.push(`Attendance record ${index + 1} has malformed fields.`);
  });

  assessments.forEach((assessment, index) => {
    if (!record(assessment)) return;
    if (!textValue(assessment.courseId) || !courseIds.has(assessment.courseId))
      errors.push(`Assessment ${index + 1} has no matching course.`);
    if (
      assessment.sessionId !== undefined &&
      (!textValue(assessment.sessionId) ||
        !sessionIds.has(assessment.sessionId))
    )
      errors.push(`Assessment ${index + 1} has no matching session.`);
    const timed =
      finite(assessment.startsAt) &&
      finite(assessment.endsAt) &&
      Number(assessment.endsAt) > Number(assessment.startsAt);
    const deadline =
      finite(assessment.startsAt) &&
      finite(assessment.endsAt) &&
      finite(assessment.dueAt) &&
      Number(assessment.startsAt) === Number(assessment.endsAt) &&
      Number(assessment.dueAt) === Number(assessment.startsAt);
    if (!textValue(assessment.title) || (!timed && !deadline))
      errors.push(`Assessment ${index + 1} has invalid fields or times.`);
    if (
      !oneOf(assessment.confidence, ["confirmed", "tentative", "unknown"]) ||
      (assessment.type !== undefined &&
        !oneOf(assessment.type, [
          "exam",
          "presentation",
          "assignment",
          "other",
        ])) ||
      !optionalFinite(assessment.dueAt) ||
      !optionalText(assessment.notes)
    )
      errors.push(`Assessment ${index + 1} has malformed optional fields.`);
  });

  trips.forEach((trip, index) => {
    if (!record(trip)) return;
    if (
      !textValue(trip.name) ||
      !finite(trip.departureAt) ||
      !finite(trip.returnAt) ||
      Number(trip.returnAt) <= Number(trip.departureAt)
    )
      errors.push(`Trip ${index + 1} has invalid fields or times.`);
    if (
      !oneOf(trip.status, ["tentative", "confirmed", "cancelled"]) ||
      !optionalText(trip.notes)
    )
      errors.push(`Trip ${index + 1} has malformed fields.`);
    for (const field of ["departureBufferMinutes", "returnBufferMinutes"])
      if (
        trip[field] !== undefined &&
        (!Number.isInteger(trip[field]) || Number(trip[field]) < 0)
      )
        errors.push(`Trip ${index + 1} has an invalid ${field}.`);
  });

  scenarios.forEach((scenario, index) => {
    if (!record(scenario)) return;
    if (!textValue(scenario.name) || typeof scenario.enabled !== "boolean")
      errors.push(`Scenario ${index + 1} has invalid fields.`);
    for (const [field, references] of [
      ["tripIds", tripIds],
      ["plannedUnitIds", unitKeys],
    ] as const) {
      if (scenario[field] === undefined) continue;
      if (!Array.isArray(scenario[field])) {
        errors.push(`Scenario ${index + 1} ${field} must be an array.`);
        continue;
      }
      const seen = new Set<string>();
      for (const reference of scenario[field]) {
        if (!textValue(reference) || !references.has(reference))
          errors.push(
            `Scenario ${index + 1} has an invalid ${field} reference.`,
          );
        else if (seen.has(reference))
          errors.push(`Scenario ${index + 1} duplicates a ${field} reference.`);
        else seen.add(reference);
      }
    }
  });

  if (unitKeys.size > 10_000)
    errors.push("A planner supports at most 10,000 attendance units.");
  sessions.forEach((session, index) => {
    if (!record(session) || session.assessmentId === undefined) return;
    if (
      !textValue(session.assessmentId) ||
      !assessments.some(
        (a) =>
          record(a) &&
          a.id === session.assessmentId &&
          a.courseId === session.courseId,
      )
    )
      errors.push(
        `Session ${index + 1} has no matching assessment in its course.`,
      );
  });
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: value as unknown as AppState, errors: [] };
}

export function encodeBackup(
  state: AppState,
  exportedAt = new Date().toISOString(),
): string {
  return JSON.stringify(
    { format: "skip-budget-backup", backupVersion: 1, exportedAt, state },
    null,
    2,
  );
}

export function decodeBackup(text: string): ValidationResult<AppState> {
  let parsed: unknown;
  try {
    checkTextSize(text);
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      errors: [
        error instanceof SyntaxError
          ? "This file is not valid JSON."
          : error instanceof Error
            ? error.message
            : "Could not read backup.",
      ],
    };
  }
  if (
    !record(parsed) ||
    parsed.format !== "skip-budget-backup" ||
    parsed.backupVersion !== 1
  ) {
    return {
      ok: false,
      errors: ["This is not a supported Skip Budget backup."],
    };
  }
  return validateState(parsed.state);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open local storage."));
    request.onblocked = () =>
      reject(
        new Error(
          "Browser storage is blocked. Close other planner tabs and retry.",
        ),
      );
  });
}

async function readDocument(key: string): Promise<unknown> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE_NAME)
        .objectStore(STORE_NAME)
        .get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not read local data."));
    });
  } finally {
    db.close();
  }
}

export async function loadState(): Promise<AppState | null> {
  const value = await readDocument(CURRENT_KEY);
  if (value === undefined) return null;
  const result = validateState(value);
  if (!result.ok)
    throw new Error(`Stored data is invalid: ${result.errors.join(" ")}`);
  return result.value;
}

export async function saveState(state: AppState): Promise<void> {
  checkTextSize(encodeBackup(state));
  const checked = validateState(state);
  if (!checked.ok)
    throw new Error(
      `Refusing to save invalid data: ${checked.errors.join(" ")}`,
    );
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(state, CURRENT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Could not save local data."));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Local save was aborted."));
    });
  } finally {
    db.close();
  }
}

export async function resetWithRecovery(
  current: AppState,
  fresh: AppState,
): Promise<void> {
  checkTextSize(encodeBackup(current));
  checkTextSize(encodeBackup(fresh));
  const currentCheck = validateState(current);
  const freshCheck = validateState(fresh);
  if (!currentCheck.ok || !freshCheck.ok)
    throw new Error("Reset data did not pass validation.");
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(current, RECOVERY_KEY);
      store.put(fresh, CURRENT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Could not create the recovery copy."));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Replacement was aborted."));
    });
  } finally {
    db.close();
  }
}

export async function loadRecovery(): Promise<AppState | null> {
  const value = await readDocument(RECOVERY_KEY);
  if (value === undefined) return null;
  const checked = validateState(value);
  if (!checked.ok)
    throw new Error(
      `The recovery copy is invalid: ${checked.errors.join(" ")}`,
    );
  return checked.value;
}

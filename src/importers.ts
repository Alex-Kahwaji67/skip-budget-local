import {
  MADRID_TIMEZONE,
  assessmentDueAtAfterTimingChange,
  localDateTimeToEpoch,
  type AppState,
  type Confidence,
  type Course,
  type DeliveryMode,
  type SessionUnit,
  type TripStatus,
} from "./domain";
import { checkTextSize, MAX_RECORDS } from "./limits";

export type ImportKind = "csv" | "ics";
export type ImportAs = "ignore" | "class" | "assessment" | "deadline" | "trip";
export type ImportIssue = { level: "error" | "warning"; message: string };
export type CourseSuggestion = { courseId: string; name: string };
export type SuggestedCourse = {
  id: string;
  name: string;
  observedUnits: number;
};

export interface ImportRow {
  id: string;
  source: ImportKind;
  sourceId?: string;
  sequence?: number;
  title: string;
  notes?: string;
  startsAt?: number;
  endsAt?: number;
  deliveryMode: DeliveryMode;
  courseId?: string;
  courseSuggestions: CourseSuggestion[];
  suggestedCourse?: SuggestedCourse;
  suggestedImportAs?: ImportAs;
  assessmentType?: "exam" | "presentation" | "assignment" | "other";
  confidence?: Confidence;
  dueAt?: number;
  unitLabels: string[];
  selected: boolean;
  cancelled?: boolean;
  generic?: boolean;
  issues: ImportIssue[];
}

export interface ImportPreview {
  kind: ImportKind;
  rows: ImportRow[];
  issues: ImportIssue[];
}
export interface ImportResolution {
  rowId?: string;
  selected?: boolean;
  importAs?: ImportAs;
  courseId?: string;
  unitLabels?: string[];
  tripStatus?: TripStatus;
  assessmentType?: "exam" | "presentation" | "assignment" | "other";
  confidence?: Confidence;
}
export type ImportResolutions =
  Record<string, ImportResolution> | ImportResolution[];
export interface ImportCourseResolution {
  id: string;
  name: string;
  observedUnits: number;
  totalUnits?: number;
  requiredAttendanceBps?: number;
  confirmed: boolean;
}
export type ImportCourseResolutions = Record<string, ImportCourseResolution>;

const error = (message: string): ImportIssue => ({ level: "error", message });
const warning = (message: string): ImportIssue => ({
  level: "warning",
  message,
});
const clean = (value: string | undefined) => value?.trim() ?? "";
const key = (value: string) => value.trim().toLowerCase();
const comparable = (value: string) =>
  key(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
const stableId = (value: string) => `import-${hash(value)}`;
const hash = (value: string) => {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++)
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return (result >>> 0).toString(36);
};
const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};
const uniqueLabels = (labels: string[]) => [
  ...new Map(
    labels
      .map(clean)
      .filter(Boolean)
      .map((label) => [comparable(label), label]),
  ).values(),
];
const sourceIdentity = (row: ImportRow) =>
  `${row.source}:${row.sourceId ?? row.id}`;
const suggestedCourses = (courses: Course[], value: string) => {
  const match = comparable(value);
  return courses
    .filter(
      (course) =>
        comparable(course.id) === match || comparable(course.name) === match,
    )
    .map(({ id, name }) => ({ courseId: id, name }));
};

type TitleClassification = Pick<
  ImportRow,
  | "deliveryMode"
  | "unitLabels"
  | "suggestedCourse"
  | "suggestedImportAs"
  | "assessmentType"
>;
function classifyTitle(title: string): TitleClassification {
  const match = title.match(
    /^(.+?)\s*\(Ses\.\s*(\d+)(?:\s*[-–—]\s*(\d+))?\)\s*(Live in-person|Asynchronous)\s*$/i,
  );
  if (match) {
    const first = Number(match[2]);
    const last = Number(match[3] ?? match[2]);
    if (first > 0 && last >= first && last - first < 50) {
      const name = clean(match[1]);
      return {
        deliveryMode: /asynchronous/i.test(match[4]) ? "async" : "in-person",
        unitLabels: Array.from(
          { length: last - first + 1 },
          (_, index) => `Session ${first + index}`,
        ),
        suggestedCourse: {
          id: stableId(`course:${comparable(name)}`),
          name,
          observedUnits: last,
        },
        suggestedImportAs: "class",
      };
    }
  }
  const assessmentType = /\b(exam|midterm|quiz|test)\b/i.test(title)
    ? "exam"
    : /\b(presentation|pitch)\b/i.test(title)
      ? "presentation"
      : /\b(assignment|deadline|due|submission|project|deliverable)\b/i.test(
            title,
          )
        ? "assignment"
        : "other";
  return {
    deliveryMode: "in-person",
    unitLabels: [],
    suggestedImportAs:
      assessmentType === "other"
        ? "ignore"
        : /\b(deadline|due|submission)\b/i.test(title)
          ? "deadline"
          : "assessment",
    assessmentType,
  };
}

export function suggestedCourseResolutions(
  preview: ImportPreview,
  state: AppState,
): ImportCourseResolutions {
  const result: ImportCourseResolutions = {};
  for (const row of preview.rows) {
    const suggestion = row.suggestedCourse;
    if (
      !suggestion ||
      row.courseId ||
      state.courses.some((course) => course.id === suggestion.id)
    )
      continue;
    const current = result[suggestion.id];
    result[suggestion.id] = {
      id: suggestion.id,
      name: suggestion.name,
      observedUnits: Math.max(
        current?.observedUnits ?? 0,
        suggestion.observedUnits,
      ),
      totalUnits: Math.max(current?.totalUnits ?? 0, suggestion.observedUnits),
      requiredAttendanceBps: current?.requiredAttendanceBps,
      confirmed: false,
    };
  }
  return result;
}

/** RFC 4180-style parser. Import text is returned only as plain string fields. */
export function parseCsv(text: string): string[][] {
  checkTextSize(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += char;
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (rows.length > MAX_RECORDS + 1)
        throw new Error(`Imports support at most ${MAX_RECORDS} data rows.`);
    } else field += char;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length > MAX_RECORDS + 1)
    throw new Error(`Imports support at most ${MAX_RECORDS} data rows.`);
  return rows.filter((values) => values.some((value) => value.trim()));
}

function csvEpoch(
  value: string,
  timezone: string,
  issues: ImportIssue[],
  field: string,
): number | undefined {
  if (!value) {
    issues.push(error(`${field} is required.`));
    return undefined;
  }
  if (/Z$/i.test(value)) {
    try {
      return localDateTimeToEpoch(value.slice(0, -1), "UTC");
    } catch {
      issues.push(error(`${field} is not a valid UTC date/time.`));
      return undefined;
    }
  }
  if (!validZone(timezone)) {
    issues.push(error(`Unknown timezone “${timezone}”.`));
    return undefined;
  }
  try {
    return localDateTimeToEpoch(value, timezone);
  } catch {
    issues.push(error(`${field} is not a valid date/time.`));
    return undefined;
  }
}

export function previewCsv(text: string, state: AppState): ImportPreview {
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (cause) {
    return {
      kind: "csv",
      rows: [],
      issues: [
        error(cause instanceof Error ? cause.message : "Could not parse CSV."),
      ],
    };
  }
  if (!table.length)
    return { kind: "csv", rows: [], issues: [error("CSV is empty.")] };
  const headers = table[0].map((header) => key(header));
  const required = ["source_id", "title", "start", "end"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length)
    return {
      kind: "csv",
      rows: [],
      issues: [error(`CSV needs columns: ${missing.join(", ")}.`)],
    };
  const index = (name: string) => headers.indexOf(name);
  const value = (row: string[], name: string) => clean(row[index(name)]);
  const rows = table.slice(1).map((fields, offset): ImportRow => {
    const issues: ImportIssue[] = [];
    const sourceId = value(fields, "source_id");
    const timezone = value(fields, "timezone") || MADRID_TIMEZONE;
    const title = value(fields, "title");
    if (!sourceId)
      issues.push(error("source_id is required for safe deduplication."));
    if (!title) issues.push(error("title is required."));
    const courseValue = value(fields, "course_id") || value(fields, "course");
    const suggestions = suggestedCourses(state.courses, courseValue);
    const courseId =
      suggestions.length === 1 ? suggestions[0].courseId : undefined;
    if (!courseId)
      issues.push(
        error("Map this row to an existing course before importing."),
      );
    const labels = uniqueLabels(value(fields, "unit_labels").split("|"));
    if (!labels.length)
      issues.push(
        error("Add one or more explicit unit labels before importing."),
      );
    const delivery = value(fields, "delivery_mode") || "in-person";
    const deliveryMode: DeliveryMode =
      delivery === "online" || delivery === "async" || delivery === "in-person"
        ? delivery
        : "in-person";
    if (delivery !== deliveryMode)
      issues.push(error("delivery_mode must be in-person, online, or async."));
    return {
      id: `csv-${offset + 2}`,
      source: "csv",
      sourceId: sourceId || undefined,
      title,
      notes: value(fields, "notes") || undefined,
      startsAt: csvEpoch(value(fields, "start"), timezone, issues, "start"),
      endsAt: csvEpoch(value(fields, "end"), timezone, issues, "end"),
      deliveryMode,
      courseId,
      courseSuggestions: suggestions,
      unitLabels: labels,
      selected: false,
      issues,
    };
  });
  rows.forEach((row) => {
    if (
      row.startsAt !== undefined &&
      row.endsAt !== undefined &&
      row.endsAt <= row.startsAt
    )
      row.issues.push(error("end must be after start."));
  });
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    if (row.sourceId)
      counts.set(row.sourceId, (counts.get(row.sourceId) ?? 0) + 1);
  });
  rows.forEach((row) => {
    if (row.sourceId && counts.get(row.sourceId)! > 1)
      row.issues.push(
        error("This file repeats a source_id; resolve it before importing."),
      );
  });
  return { kind: "csv", rows, issues: [] };
}

type IcsProperty = {
  name: string;
  value: string;
  params: Record<string, string>;
};
function icsEvents(text: string): IcsProperty[][] {
  checkTextSize(text);
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .reduce<string[]>((all, line) => {
      if (/^[ \t]/.test(line) && all.length)
        all[all.length - 1] += line.slice(1);
      else all.push(line);
      return all;
    }, []);
  const events: IcsProperty[][] = [];
  let event: IcsProperty[] | undefined;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      event = [];
      continue;
    }
    if (line === "END:VEVENT") {
      if (event) events.push(event);
      if (events.length > MAX_RECORDS)
        throw new Error(
          `Imports support at most ${MAX_RECORDS} calendar events.`,
        );
      event = undefined;
      continue;
    }
    if (!event) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [name, ...parameters] = line.slice(0, colon).split(";");
    const params: Record<string, string> = {};
    parameters.forEach((parameter) => {
      const equals = parameter.indexOf("=");
      if (equals > 0)
        params[parameter.slice(0, equals).toUpperCase()] = parameter
          .slice(equals + 1)
          .replace(/^"|"$/g, "");
    });
    event.push({
      name: name.toUpperCase(),
      value: line.slice(colon + 1),
      params,
    });
  }
  return events;
}
const property = (event: IcsProperty[], name: string) =>
  event.find((item) => item.name === name);
const anyProperty = (event: IcsProperty[], names: string[]) =>
  event.filter((item) => names.includes(item.name));
function icsEpoch(
  prop: IcsProperty | undefined,
  label: string,
  issues: ImportIssue[],
): number | undefined {
  if (!prop) {
    issues.push(error(`${label} is required.`));
    return undefined;
  }
  if (prop.params.VALUE === "DATE" || /^\d{8}$/.test(prop.value)) {
    issues.push(warning(`${label} is all-day and has no attendance time.`));
    issues.push(error(`${label} all-day events require manual scheduling.`));
    return undefined;
  }
  const match = prop.value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/,
  );
  if (!match) {
    issues.push(error(`${label} is not a supported ICS date/time.`));
    return undefined;
  }
  const [, year, month, day, hour, minute, second = "00", utc] = match;
  if (utc) {
    try {
      return localDateTimeToEpoch(
        `${year}-${month}-${day} ${hour}:${minute}:${second}`,
        "UTC",
      );
    } catch {
      issues.push(error(`${label} is not a valid UTC date/time.`));
      return undefined;
    }
  }
  const timezone = prop.params.TZID;
  if (!timezone) {
    issues.push(warning(`${label} is floating; interpreted as Europe/Madrid.`));
    return localDateTimeToEpoch(
      `${year}-${month}-${day} ${hour}:${minute}:${second}`,
      MADRID_TIMEZONE,
    );
  }
  if (!validZone(timezone)) {
    issues.push(error(`Unknown TZID “${timezone}”.`));
    return undefined;
  }
  return localDateTimeToEpoch(
    `${year}-${month}-${day} ${hour}:${minute}:${second}`,
    timezone,
  );
}

export function previewIcs(
  text: string,
  state: AppState,
  defaultZone = MADRID_TIMEZONE,
): ImportPreview {
  if (defaultZone !== MADRID_TIMEZONE)
    return {
      kind: "ics",
      rows: [],
      issues: [error("Skip Budget imports are normalized to Europe/Madrid.")],
    };
  const rows = icsEvents(text).map((event, index): ImportRow => {
    const issues: ImportIssue[] = [];
    const uid = clean(property(event, "UID")?.value);
    const recurrence = clean(property(event, "RECURRENCE-ID")?.value);
    const sourceId = uid
      ? `${uid}${recurrence ? `/${recurrence}` : ""}`
      : undefined;
    if (!uid)
      issues.push(
        error("VEVENT is missing UID; it cannot be safely deduplicated."),
      );
    const sequenceText = clean(property(event, "SEQUENCE")?.value);
    const sequence = sequenceText ? Number(sequenceText) : undefined;
    if (sequenceText && (!Number.isInteger(sequence) || sequence! < 0))
      issues.push(error("SEQUENCE must be a non-negative integer."));
    const recurrenceProps = anyProperty(event, ["RRULE", "RDATE", "EXDATE"]);
    if (recurrenceProps.length)
      issues.push(
        error(
          `Unsupported recurrence data (${recurrenceProps.map((item) => item.name).join(", ")}); it was not expanded.`,
        ),
      );
    if (property(event, "DURATION"))
      issues.push(error("DURATION is unsupported; provide an explicit DTEND."));
    const title =
      clean(property(event, "SUMMARY")?.value) || "(Untitled calendar event)";
    const classified = classifyTitle(title);
    const cancelled =
      clean(property(event, "STATUS")?.value).toUpperCase() === "CANCELLED";
    const existingSession = sourceId
      ? state.sessions.find(
          (item) => item.source === "ics" && item.sourceId === sourceId,
        )
      : undefined;
    const existingTrip = sourceId
      ? state.trips.find(
          (item) => item.source === "ics" && item.sourceId === sourceId,
        )
      : undefined;
    const existingAssessment = sourceId
      ? state.assessments.find(
          (item) => item.source === "ics" && item.sourceId === sourceId,
        )
      : undefined;
    const existing = existingSession ?? existingTrip ?? existingAssessment;
    const existingKind: ImportAs | undefined = existingSession
      ? "class"
      : existingTrip
        ? "trip"
        : existingAssessment
          ? existingAssessment.startsAt === existingAssessment.endsAt &&
            existingAssessment.dueAt === existingAssessment.startsAt
            ? "deadline"
            : "assessment"
          : undefined;
    if (cancelled)
      issues.push(
        warning(
          "Calendar event is cancelled; importing this row removes only its matching source item.",
        ),
      );
    const startsAt = cancelled
      ? undefined
      : icsEpoch(property(event, "DTSTART"), "DTSTART", issues);
    const endProperty = property(event, "DTEND");
    const endsAt = cancelled
      ? undefined
      : endProperty
        ? icsEpoch(endProperty, "DTEND", issues)
        : classified.suggestedImportAs === "deadline" && startsAt !== undefined
          ? startsAt
          : icsEpoch(undefined, "DTEND", issues);
    if (!cancelled && !endProperty && startsAt === endsAt)
      issues.push(
        warning("No DTEND was supplied; review this as a due-only deadline."),
      );
    if (startsAt !== undefined && endsAt !== undefined && endsAt < startsAt)
      issues.push(error("DTEND must not be before DTSTART."));
    if (startsAt !== undefined && endsAt === startsAt)
      issues.push(
        warning(
          "Zero-duration calendar point: import only as a due-only deadline.",
        ),
      );
    if (
      existing?.sequence !== undefined &&
      sequence !== undefined &&
      sequence < existing.sequence
    )
      issues.push(
        error(
          `SEQUENCE ${sequence} is older than the imported version ${existing.sequence}.`,
        ),
      );
    const courseSuggestions = classified.suggestedCourse
      ? suggestedCourses(state.courses, classified.suggestedCourse.name)
      : [];
    const courseId =
      existingSession?.courseId ??
      existingAssessment?.courseId ??
      (courseSuggestions.length === 1
        ? courseSuggestions[0].courseId
        : undefined);
    if (
      startsAt !== undefined &&
      endsAt !== undefined &&
      [...state.sessions, ...state.assessments].some(
        (item) =>
          (item.source !== "ics" || item.sourceId !== sourceId) &&
          item.startsAt === startsAt &&
          item.endsAt === endsAt &&
          comparable(item.title ?? "") === comparable(title),
      )
    )
      issues.push(
        warning(
          "The same title and time already exist under another source identity; review for a possible legacy duplicate.",
        ),
      );
    if (
      startsAt !== undefined &&
      endsAt !== undefined &&
      state.trips.some(
        (item) =>
          (item.source !== "ics" || item.sourceId !== sourceId) &&
          item.departureAt === startsAt &&
          item.returnAt === endsAt &&
          comparable(item.name) === comparable(title),
      )
    )
      issues.push(
        warning(
          "The same title and time already exist under another source identity; review for a possible legacy duplicate.",
        ),
      );
    return {
      id: `ics-${index + 1}`,
      source: "ics",
      sourceId,
      sequence: Number.isInteger(sequence) ? sequence : undefined,
      title,
      notes: clean(property(event, "DESCRIPTION")?.value) || undefined,
      startsAt,
      endsAt,
      dueAt: startsAt === endsAt ? startsAt : undefined,
      deliveryMode: classified.deliveryMode,
      courseId,
      courseSuggestions,
      suggestedCourse: classified.suggestedCourse,
      suggestedImportAs: cancelled
        ? existingKind
        : startsAt === endsAt
          ? "deadline"
          : (existingKind ?? classified.suggestedImportAs),
      assessmentType: existingAssessment?.type ?? classified.assessmentType,
      confidence: existingAssessment?.confidence,
      unitLabels:
        existingSession?.units.map((unit) => unit.label) ??
        classified.unitLabels,
      selected: false,
      cancelled,
      generic: !classified.suggestedCourse,
      issues,
    };
  });
  const sourceCounts = new Map<string, number>();
  rows.forEach((row) => {
    if (row.sourceId)
      sourceCounts.set(row.sourceId, (sourceCounts.get(row.sourceId) ?? 0) + 1);
  });
  rows.forEach((row) => {
    if (row.sourceId && sourceCounts.get(row.sourceId)! > 1)
      row.issues.push(
        error(
          "This file repeats the same UID/RECURRENCE-ID; resolve the calendar export before importing.",
        ),
      );
  });
  return {
    kind: "ics",
    rows,
    issues: rows.length ? [] : [error("ICS contains no VEVENT entries.")],
  };
}

const resolutionFor = (
  resolutions: ImportResolutions | undefined,
  row: ImportRow,
) =>
  Array.isArray(resolutions)
    ? resolutions.find(
        (item) =>
          (item as ImportResolution & { rowId?: string }).rowId === row.id,
      )
    : resolutions?.[row.id];
const sourceSession = (state: AppState, row: ImportRow) =>
  state.sessions.find(
    (item) => item.source === row.source && item.sourceId === row.sourceId,
  );
const sourceTrip = (state: AppState, row: ImportRow) =>
  state.trips.find(
    (item) => item.source === row.source && item.sourceId === row.sourceId,
  );
const sourceAssessment = (state: AppState, row: ImportRow) =>
  state.assessments.find(
    (item) => item.source === row.source && item.sourceId === row.sourceId,
  );
const referencedUnitIds = (state: AppState) =>
  new Set([
    ...state.attendance.map((record) => record.unitId),
    ...state.scenarios.flatMap((scenario) => scenario.plannedUnitIds ?? []),
  ]);
export function finalized(
  row: ImportRow,
  state: AppState,
  resolution?: ImportResolution,
  courseResolutions: ImportCourseResolutions = {},
) {
  const selected = resolution?.selected ?? row.selected;
  const importAs =
    resolution && "importAs" in resolution
      ? resolution.importAs
      : row.source === "csv"
        ? "class"
        : row.suggestedImportAs;
  const needsCourse =
    importAs === "class" ||
    importAs === "assessment" ||
    importAs === "deadline";
  const courseId = needsCourse
    ? (resolution?.courseId ?? row.courseId)
    : undefined;
  const labels = uniqueLabels(resolution?.unitLabels ?? row.unitLabels);
  const assessmentType =
    resolution?.assessmentType ?? row.assessmentType ?? "other";
  const confidence = resolution?.confidence ?? row.confidence ?? "unknown";
  if (importAs === "ignore")
    return {
      selected: false,
      importAs,
      courseId,
      labels,
      tripStatus: resolution?.tripStatus,
      assessmentType,
      confidence,
      issues: row.issues,
    };
  const issues = row.issues.filter(
    (issue) =>
      !/Map this row|Add one or more explicit unit labels/.test(issue.message),
  );
  const existingSession = sourceSession(state, row);
  const existingTrip = sourceTrip(state, row);
  const existingAssessment = sourceAssessment(state, row);
  if (!importAs)
    issues.push(
      error(
        "Choose Ignore, Class, Assessment, Deadline, or Trip before importing this calendar event.",
      ),
    );
  if (row.cancelled) {
    const matchingKind = existingSession
      ? "class"
      : existingTrip
        ? "trip"
        : existingAssessment
          ? existingAssessment.startsAt === existingAssessment.endsAt &&
            existingAssessment.dueAt === existingAssessment.startsAt
            ? "deadline"
            : "assessment"
          : undefined;
    if (!matchingKind)
      issues.push(
        error("No matching imported item exists for this cancellation."),
      );
    else if (importAs !== matchingKind)
      issues.push(
        error(`Choose ${matchingKind} to remove the matching imported item.`),
      );
    if (
      existingSession?.units.some((unit) =>
        referencedUnitIds(state).has(unit.id),
      )
    )
      issues.push(
        error(
          "This cancellation would remove a class with recorded attendance or a planned skip. Clear those references explicitly first.",
        ),
      );
    if (
      existingAssessment &&
      state.sessions.some(
        (session) => session.assessmentId === existingAssessment.id,
      )
    )
      issues.push(
        error(
          "This cancellation would remove an assessment linked to a class. Unlink it explicitly first.",
        ),
      );
    if (
      existingTrip &&
      state.scenarios.some((scenario) =>
        scenario.tripIds?.includes(existingTrip.id),
      )
    )
      issues.push(
        error(
          "This cancellation would remove a trip used by a scenario. Remove that scenario reference explicitly first.",
        ),
      );
    return {
      selected,
      importAs,
      courseId,
      labels,
      tripStatus: resolution?.tripStatus,
      assessmentType,
      confidence,
      issues,
    };
  }
  const course = state.courses.find((item) => item.id === courseId);
  const proposed = courseId ? courseResolutions[courseId] : undefined;
  if (needsCourse && !courseId)
    issues.push(error("Map this row to a confirmed course before importing."));
  else if (needsCourse && !course) {
    if (!proposed?.confirmed)
      issues.push(error("Confirm this suggested course before importing."));
    if (!proposed?.name.trim())
      issues.push(error("Enter a course name before importing."));
    if (
      !proposed ||
      !Number.isInteger(proposed.totalUnits) ||
      proposed.totalUnits! < Math.max(1, proposed.observedUnits)
    )
      issues.push(
        error(
          `Enter a total unit count at least as high as the ${proposed?.observedUnits ?? 1} units observed in this file.`,
        ),
      );
    if (
      !proposed ||
      !Number.isInteger(proposed.requiredAttendanceBps) ||
      proposed.requiredAttendanceBps! < 0 ||
      proposed.requiredAttendanceBps! > 10_000
    )
      issues.push(
        error(
          "Enter the verified required attendance percentage for this course.",
        ),
      );
  }
  if (importAs === "class") {
    if (!labels.length)
      issues.push(
        error("Add one or more explicit unit labels before importing."),
      );
    if (
      row.startsAt !== undefined &&
      row.endsAt !== undefined &&
      row.endsAt <= row.startsAt
    )
      issues.push(error("Class blocks require an end after the start."));
    if (existingSession) {
      const existingKeys = existingSession.units.map((unit) =>
        comparable(unit.label),
      );
      if (new Set(existingKeys).size !== existingKeys.length)
        issues.push(
          error(
            "Existing unit labels are ambiguous; edit the class before reimporting it.",
          ),
        );
      const nextKeys = new Set(labels.map(comparable));
      const referenced = referencedUnitIds(state);
      if (
        existingSession.units.some(
          (unit) =>
            !nextKeys.has(comparable(unit.label)) && referenced.has(unit.id),
        )
      )
        issues.push(
          error(
            "This update would remove a unit with recorded attendance or a planned skip. Clear that reference explicitly before reimporting.",
          ),
        );
    }
  }
  if (importAs === "trip" && !resolution?.tripStatus)
    issues.push(error("Choose a trip status before importing."));
  if (
    (importAs === "trip" || importAs === "assessment") &&
    row.startsAt !== undefined &&
    row.endsAt !== undefined &&
    row.endsAt <= row.startsAt
  )
    issues.push(
      error(
        `${importAs === "trip" ? "Trips" : "Assessments"} require an end after the start.`,
      ),
    );
  if (
    importAs === "deadline" &&
    (row.startsAt === undefined ||
      row.endsAt !== row.startsAt ||
      row.dueAt !== row.startsAt)
  )
    issues.push(
      error(
        "A deadline must be one exact due time with DTSTART, DTEND, and due time equal.",
      ),
    );
  const changingSessionKind = existingSession && importAs !== "class";
  if (
    changingSessionKind &&
    existingSession.units.some((unit) => referencedUnitIds(state).has(unit.id))
  )
    issues.push(
      error(
        "This change would remove a class with recorded attendance or a planned skip. Clear those references explicitly first.",
      ),
    );
  if (
    existingAssessment &&
    importAs !== "assessment" &&
    importAs !== "deadline" &&
    state.sessions.some(
      (session) => session.assessmentId === existingAssessment.id,
    )
  )
    issues.push(
      error(
        "This change would remove an assessment linked to a class. Unlink it explicitly first.",
      ),
    );
  if (
    existingTrip &&
    importAs !== "trip" &&
    state.scenarios.some((scenario) =>
      scenario.tripIds?.includes(existingTrip.id),
    )
  )
    issues.push(
      error(
        "This change would remove a trip used by a scenario. Remove that scenario reference explicitly first.",
      ),
    );
  return {
    selected,
    importAs,
    courseId,
    labels,
    tripStatus: resolution?.tripStatus,
    assessmentType,
    confidence,
    issues,
  };
}

/** Applies only rows explicitly selected and valid after their course/unit review. */
export function commitImport(
  state: AppState,
  preview: ImportPreview,
  resolutions?: ImportResolutions,
  courseResolutions: ImportCourseResolutions = {},
): AppState {
  const reviewed = preview.rows.map((row) => ({
    row,
    resolved: finalized(
      row,
      state,
      resolutionFor(resolutions, row),
      courseResolutions,
    ),
  }));
  const selected = reviewed.filter(
    (item) => item.resolved.selected && item.resolved.importAs !== "ignore",
  );
  if (
    !selected.length ||
    selected.some((item) =>
      item.resolved.issues.some((issue) => issue.level === "error"),
    )
  )
    return state;
  const courses = [...state.courses];
  const sessions = [...state.sessions];
  const trips = [...state.trips];
  const assessments = [...state.assessments];
  let changed = false;
  for (const { row, resolved } of selected) {
    const needsCourse =
      resolved.importAs === "class" ||
      resolved.importAs === "assessment" ||
      resolved.importAs === "deadline";
    if (
      !row.cancelled &&
      needsCourse &&
      resolved.courseId &&
      !courses.some((course) => course.id === resolved.courseId)
    ) {
      const proposed = courseResolutions[resolved.courseId];
      courses.push({
        id: proposed.id,
        name: proposed.name.trim(),
        totalUnits: proposed.totalUnits!,
        requiredAttendanceBps: proposed.requiredAttendanceBps!,
        source: preview.kind,
        sourceId: `course:${comparable(proposed.name)}`,
        importedAt: new Date().toISOString(),
      });
      changed = true;
    }
  }
  for (const { row, resolved } of selected) {
    if (row.cancelled) {
      const items =
        resolved.importAs === "trip"
          ? trips
          : resolved.importAs === "class"
            ? sessions
            : assessments;
      const index = items.findIndex(
        (item) => item.source === row.source && item.sourceId === row.sourceId,
      );
      if (index >= 0) {
        items.splice(index, 1);
        changed = true;
      }
      continue;
    }
    if (
      !row.sourceId ||
      row.startsAt === undefined ||
      row.endsAt === undefined ||
      !resolved.importAs
    )
      continue;
    const identity = sourceIdentity(row);
    if (resolved.importAs === "trip") {
      const classIndex = sessions.findIndex(
        (session) =>
          session.source === row.source && session.sourceId === row.sourceId,
      );
      if (classIndex >= 0) {
        sessions.splice(classIndex, 1);
        changed = true;
      }
      const assessmentIndex = assessments.findIndex(
        (item) => item.source === row.source && item.sourceId === row.sourceId,
      );
      if (assessmentIndex >= 0) {
        assessments.splice(assessmentIndex, 1);
        changed = true;
      }
      const existing = trips.find(
        (trip) => trip.source === row.source && trip.sourceId === row.sourceId,
      );
      const next = {
        id: existing?.id ?? stableId(`trip:${identity}`),
        name: row.title,
        departureAt: row.startsAt,
        returnAt: row.endsAt,
        status: resolved.tripStatus!,
        notes: row.notes,
        source: row.source,
        sourceId: row.sourceId,
        sequence: row.sequence,
        importedAt: new Date().toISOString(),
      };
      if (existing) trips[trips.indexOf(existing)] = { ...existing, ...next };
      else trips.push(next);
      changed = true;
      continue;
    }
    if (!resolved.courseId) continue;
    const tripIndex = trips.findIndex(
      (trip) => trip.source === row.source && trip.sourceId === row.sourceId,
    );
    if (tripIndex >= 0) {
      trips.splice(tripIndex, 1);
      changed = true;
    }
    if (
      resolved.importAs === "assessment" ||
      resolved.importAs === "deadline"
    ) {
      const classIndex = sessions.findIndex(
        (session) =>
          session.source === row.source && session.sourceId === row.sourceId,
      );
      if (classIndex >= 0) {
        sessions.splice(classIndex, 1);
        changed = true;
      }
      const existing = assessments.find(
        (item) => item.source === row.source && item.sourceId === row.sourceId,
      );
      const dueAt = assessmentDueAtAfterTimingChange(
        existing,
        resolved.importAs === "deadline",
        row.startsAt,
      );
      const next = {
        id: existing?.id ?? stableId(`assessment:${identity}`),
        courseId: resolved.courseId,
        title: row.title,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        dueAt,
        confidence: resolved.confidence,
        type: resolved.assessmentType,
        notes: row.notes,
        source: row.source,
        sourceId: row.sourceId,
        sequence: row.sequence,
        importedAt: new Date().toISOString(),
      };
      if (existing)
        assessments[assessments.indexOf(existing)] = { ...existing, ...next };
      else assessments.push(next);
      changed = true;
      continue;
    }
    const assessmentIndex = assessments.findIndex(
      (item) => item.source === row.source && item.sourceId === row.sourceId,
    );
    if (assessmentIndex >= 0) {
      assessments.splice(assessmentIndex, 1);
      changed = true;
    }
    const existing = sessions.find(
      (session) =>
        session.source === row.source && session.sourceId === row.sourceId,
    );
    const id = existing?.id ?? stableId(identity);
    const existingUnits = new Map(
      existing?.units.map((unit) => [comparable(unit.label), unit]) ?? [],
    );
    const units: SessionUnit[] = resolved.labels.map((label) => ({
      id:
        existingUnits.get(comparable(label))?.id ??
        stableId(`${id}:unit:${comparable(label)}`),
      label,
    }));
    const next = {
      id,
      courseId: resolved.courseId,
      title: row.title,
      notes: row.notes,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      timezone: MADRID_TIMEZONE,
      units,
      deliveryMode: row.deliveryMode,
      source: row.source,
      sourceId: row.sourceId,
      sequence: row.sequence,
      importedAt: new Date().toISOString(),
    };
    if (existing) {
      sessions[sessions.indexOf(existing)] = { ...existing, ...next };
      changed = true;
    } else {
      sessions.push(next);
      changed = true;
    }
  }
  if (!changed) return state;
  const sessionIds = new Set(sessions.map((session) => session.id));
  const unitIds = new Set(
    sessions.flatMap((session) => session.units.map((unit) => unit.id)),
  );
  return {
    ...state,
    courses,
    sessions,
    trips,
    attendance: state.attendance.filter(
      (record) =>
        sessionIds.has(record.sessionId) && unitIds.has(record.unitId),
    ),
    assessments: assessments.map((assessment) =>
      assessment.sessionId && !sessionIds.has(assessment.sessionId)
        ? { ...assessment, sessionId: undefined }
        : assessment,
    ),
    scenarios: state.scenarios.map((scenario) => ({
      ...scenario,
      plannedUnitIds: scenario.plannedUnitIds?.filter((unitId) =>
        unitIds.has(unitId),
      ),
      tripIds: scenario.tripIds?.filter((id) =>
        trips.some((trip) => trip.id === id),
      ),
    })),
  };
}

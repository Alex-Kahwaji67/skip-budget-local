import { localDateTimeToEpoch, type AppState, type Session } from "./domain";

/** Fictional examples relative to a supplied date; no personal calendar records. */
export function exampleState(now = Date.now()): AppState {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  const at = (offset: number, time: string) => {
    const day = new Date(`${date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    return localDateTimeToEpoch(`${day.toISOString().slice(0, 10)}T${time}`);
  };
  const session = (
    id: string,
    courseId: string,
    offset: number,
    count: number,
    deliveryMode: Session["deliveryMode"] = "in-person",
  ): Session => ({
    id,
    courseId,
    startsAt: at(offset, "10:00"),
    endsAt: at(offset, count === 2 ? "12:00" : "11:00"),
    units: Array.from({ length: count }, (_, i) => ({
      id: `${id}-u${i + 1}`,
      label: `Unit ${i + 1}`,
    })),
    deliveryMode,
  });
  return {
    schemaVersion: 1,
    timezone: "Europe/Madrid",
    scheduleCoverage: "incomplete",
    source: { source: "Fictional example data" },
    courses: [
      {
        id: "data",
        name: "Data Analysis",
        totalUnits: 10,
        requiredAttendanceBps: 8000,
      },
      {
        id: "design",
        name: "Design Studio",
        totalUnits: 12,
        requiredAttendanceBps: 7500,
      },
      {
        id: "writing",
        name: "Academic Writing",
        totalUnits: 8,
        requiredAttendanceBps: 7500,
      },
    ],
    sessions: [
      session("past-data", "data", -3, 1),
      session("double-data", "data", 1, 2),
      session("past-design", "design", -2, 1),
      session("design-class", "design", 2, 1),
      session("writing-class", "writing", 3, 2),
      {
        ...session("reading", "writing", 4, 1, "async"),
        asyncDueAt: at(4, "17:00"),
        asyncCompletion: "not-started",
      },
    ],
    attendance: [
      {
        id: "recorded-absence",
        sessionId: "past-data",
        unitId: "past-data-u1",
        status: "absent",
      },
    ],
    assessments: [
      {
        id: "presentation",
        courseId: "writing",
        title: "Example presentation",
        startsAt: at(3, "14:00"),
        endsAt: at(3, "15:00"),
        confidence: "tentative",
        type: "presentation",
      },
    ],
    trips: [
      {
        id: "weekend",
        name: "Example weekend away",
        departureAt: at(2, "08:00"),
        returnAt: at(4, "19:00"),
        status: "confirmed",
      },
      {
        id: "early",
        name: "Example earlier departure",
        departureAt: at(1, "08:00"),
        returnAt: at(3, "19:00"),
        status: "tentative",
      },
    ],
    scenarios: [
      {
        id: "what-if",
        name: "What-if: Leave a day earlier",
        enabled: false,
        tripIds: ["early"],
        plannedUnitIds: [],
      },
    ],
  };
}

// Fixed clock for regression fixtures; the UI calls exampleState() explicitly.
export const seedState = exampleState(Date.UTC(2026, 8, 7, 12));

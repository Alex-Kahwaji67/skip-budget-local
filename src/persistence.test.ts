import { describe, expect, it } from "vitest";
import { type AppState } from "./domain";
import { decodeBackup, encodeBackup, validateState } from "./persistence";

const valid = (): AppState => ({
  schemaVersion: 1,
  timezone: "Europe/Madrid",
  scheduleCoverage: "incomplete",
  courses: [
    {
      id: "course",
      name: "Course",
      totalUnits: 2,
      requiredAttendanceBps: 8000,
    },
  ],
  sessions: [
    {
      id: "session",
      courseId: "course",
      startsAt: 1,
      endsAt: 2,
      units: [{ id: "unit", label: "Unit" }],
      deliveryMode: "in-person",
    },
  ],
  attendance: [],
  assessments: [],
  trips: [],
  scenarios: [],
});

describe("backup validation", () => {
  it("rejects malformed linked records rather than restoring them", () => {
    const state = valid();
    state.sessions[0].deliveryMode = "paper" as never;
    state.attendance = [
      { id: "a", sessionId: "session", unitId: "unit", status: "attended" },
      { id: "b", sessionId: "session", unitId: "unit", status: "absent" },
    ];
    state.assessments = [
      {
        id: "assessment",
        courseId: "missing",
        title: "Exam",
        startsAt: 3,
        endsAt: 2,
        confidence: "confirmed",
        type: "not-real" as never,
      },
    ];
    state.trips = [
      {
        id: "trip",
        name: "Trip",
        departureAt: 3,
        returnAt: 2,
        status: "later" as never,
      },
    ];
    state.scenarios = [
      {
        id: "scenario",
        name: "Scenario",
        enabled: true,
        tripIds: ["missing"],
        plannedUnitIds: ["missing"],
      },
    ];
    const result = validateState(state);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.join(" ")).toMatch(
        /delivery mode.*duplicates.*Assessment.*Trip.*Scenario/,
      );
  });

  it("round-trips exact due-only deadlines without accepting other zero or reversed spans", () => {
    const point = valid();
    point.assessments = [
      {
        id: "deadline",
        courseId: "course",
        title: "Submit",
        startsAt: 10,
        endsAt: 10,
        dueAt: 10,
        confidence: "unknown",
        type: "assignment",
      },
    ];
    expect(validateState(point).ok).toBe(true);
    expect(decodeBackup(encodeBackup(point)).ok).toBe(true);
    for (const assessment of [
      { ...point.assessments[0], dueAt: undefined },
      { ...point.assessments[0], dueAt: 11 },
      { ...point.assessments[0], dueAt: Number.NaN },
      { ...point.assessments[0], startsAt: 11, endsAt: 10, dueAt: undefined },
    ]) {
      expect(validateState({ ...point, assessments: [assessment] }).ok).toBe(
        false,
      );
    }
  });
});

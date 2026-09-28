import { describe, expect, it } from "vitest";
import {
  affectedSessions,
  assessmentConflicts,
  getProjection,
  localDateTimeToEpoch,
  maxAbsences,
} from "./domain";
import { exampleState } from "./seed";

const now = Date.UTC(2026, 8, 7, 12);
const state = () => exampleState(now);
const planned = (projection: ReturnType<typeof getProjection>) =>
  projection.courses.reduce((sum, course) => sum + course.plannedAbsences, 0);

describe("attendance planning with an explicit clock", () => {
  it("rounds required attendance upward in whole units", () => {
    expect(maxAbsences(15, 8000)).toBe(3);
    expect(maxAbsences(10, 8500)).toBe(1);
    expect(maxAbsences(7, 8000)).toBe(1);
    expect(() => maxAbsences(0, 8000)).toThrow();
  });
  it("keeps actual records, unknown history, and travel projections separate", () => {
    const projection = getProjection(state(), null, now);
    expect(projection.courses.find((c) => c.courseId === "data")).toMatchObject(
      { actualAbsences: 1, plannedAbsences: 0 },
    );
    expect(
      projection.courses.find((c) => c.courseId === "design"),
    ).toMatchObject({
      actualAbsences: 0,
      unknownPastUnits: 1,
      plannedAbsences: 1,
    });
    expect(planned(projection)).toBe(3);
    expect(projection.scheduleCoverage).toBe("incomplete");
  });
  it("counts overlapping trip and manual causes once per unit", () => {
    const s = state();
    const scenario = {
      ...s.scenarios[0],
      enabled: true,
      plannedUnitIds: ["double-data-u1", "double-data-u2", "writing-class-u1"],
    };
    expect(planned(getProjection(s, scenario, now))).toBe(5);
    expect(
      getProjection(s, scenario, now).courses.find((c) => c.courseId === "data")
        ?.status,
    ).toBe("Projected over limit");
    expect(s.attendance).toHaveLength(1);
  });
  it("supports partial double blocks without counting recorded units again", () => {
    const s = state();
    s.attendance.push({
      id: "partial",
      sessionId: "double-data",
      unitId: "double-data-u1",
      status: "attended",
    });
    expect(
      getProjection(s, { ...s.scenarios[0], enabled: true }, now).courses.find(
        (c) => c.courseId === "data",
      )?.plannedAbsences,
    ).toBe(1);
  });
  it("does not treat past plans or asynchronous work as absences", () => {
    const s = state();
    expect(
      planned(
        getProjection(
          s,
          { ...s.scenarios[0], enabled: true },
          Date.UTC(2027, 0, 1),
        ),
      ),
    ).toBe(0);
    expect(
      getProjection(s, null, now).asyncDuringTrips.map((s) => s.id),
    ).toEqual(["reading"]);
    expect(
      getProjection(s, null, now).courses.find((c) => c.courseId === "writing")
        ?.plannedAbsences,
    ).toBe(2);
  });
  it("excludes cancelled trips and respects disabled scenarios", () => {
    const s = state();
    s.trips[0].status = "cancelled";
    expect(planned(getProjection(s, s.scenarios[0], now))).toBe(0);
    expect(assessmentConflicts(s, s.trips[0])).toEqual([]);
  });
  it("uses half-open boundaries for classes and point deadlines", () => {
    const s = state(),
      session = s.sessions[1];
    expect(
      affectedSessions(s, {
        id: "boundary",
        name: "Boundary",
        departureAt: session.endsAt,
        returnAt: session.endsAt + 1,
        status: "confirmed",
      }),
    ).not.toContain(session);
    s.assessments = [
      {
        id: "deadline",
        courseId: "data",
        title: "Submit",
        startsAt: 100,
        endsAt: 100,
        dueAt: 100,
        confidence: "unknown",
      },
    ];
    expect(
      assessmentConflicts(s, {
        id: "trip",
        name: "Trip",
        departureAt: 100,
        returnAt: 200,
        status: "confirmed",
      }),
    ).toHaveLength(1);
    expect(
      assessmentConflicts(s, {
        id: "trip",
        name: "Trip",
        departureAt: 0,
        returnAt: 100,
        status: "confirmed",
      }),
    ).toHaveLength(0);
  });
  it("handles daylight-saving boundaries and rejects ambiguous wall times", () => {
    expect(
      localDateTimeToEpoch("2026-03-29 03:30") -
        localDateTimeToEpoch("2026-03-29 01:30"),
    ).toBe(3_600_000);
    expect(
      localDateTimeToEpoch("2026-10-25 03:30") -
        localDateTimeToEpoch("2026-10-25 01:30"),
    ).toBe(10_800_000);
    expect(() => localDateTimeToEpoch("2026-03-29 02:30")).toThrow(
      /Nonexistent/,
    );
    expect(() => localDateTimeToEpoch("2026-10-25 02:30")).toThrow(/Ambiguous/);
  });
});

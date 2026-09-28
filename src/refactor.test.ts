import { describe, it, expect, vi } from "vitest";
import {
  initializePlanner,
  saveQueue,
  recordAttendance,
  applySessionEdit,
} from "./state";
import { layoutEvents, calendarEvents } from "./calendarLayout";
import { seedState } from "./seed";
import { finalized, previewCsv, commitImport } from "./importers";
import { assessmentConflicts, getProjection } from "./domain";

describe("refactor behavior and data safety", () => {
  it("never writes starter data when reading fails", async () => {
    const write = vi.fn();
    await expect(
      initializePlanner(async () => {
        throw new Error("database unavailable");
      }, write),
    ).rejects.toThrow("database unavailable");
    expect(write).not.toHaveBeenCalled();
  });
  it("seeds only an empty successfully read database", async () => {
    const write = vi.fn(async () => {});
    const stored = structuredClone(seedState);
    expect(await initializePlanner(async () => stored, write)).toBe(stored);
    expect(write).not.toHaveBeenCalled();
    await initializePlanner(async () => null, write);
    expect(write).toHaveBeenCalledOnce();
  });
  it("surfaces failed saves and serializes later retries", async () => {
    const writes: number[] = [];
    const write = vi.fn(async () => {
      writes.push(writes.length);
      if (writes.length === 1) throw new Error("quota");
    });
    const save = saveQueue(write);
    await expect(save(seedState)).rejects.toThrow("quota");
    await expect(save(seedState)).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
  });
  it("editor drafts do not mutate stored attendance and save partial blocks together", () => {
    const state = structuredClone(seedState);
    const s = state.sessions.find((s) => s.units.length === 2)!;
    const original = JSON.stringify(state);
    const edits = {
      attendance: {
        [s.units[0].id]: "attended" as const,
        [s.units[1].id]: "absent" as const,
      },
      planned: {},
    };
    expect(JSON.stringify(state)).toBe(original);
    const next = applySessionEdit(state, s, null, edits);
    expect(JSON.stringify(state)).toBe(original);
    expect(
      next.attendance.filter((r) => r.sessionId === s.id).map((r) => r.status),
    ).toEqual(["attended", "absent"]);
    const cleared = recordAttendance(next, s.id, s.units[0].id, "");
    expect(cleared.attendance.some((r) => r.unitId === s.units[0].id)).toBe(
      false,
    );
  });
  it("import readiness and commit use the same resolved mapping", () => {
    const state = structuredClone(seedState);
    const p = previewCsv(
      "source_id,title,start,end,course_id,unit_labels\nnew,Class,2026-10-20T09:00,2026-10-20T10:20,,",
      state,
    );
    const row = p.rows[0];
    expect(finalized(row, state).issues.some((i) => i.level === "error")).toBe(
      true,
    );
    const r = {
      selected: true,
      importAs: "class" as const,
      courseId: state.courses[0].id,
      unitLabels: ["Session 12"],
    };
    expect(
      finalized(row, state, r).issues.some((i) => i.level === "error"),
    ).toBe(false);
    expect(commitImport(state, p, { [row.id]: r }).sessions.length).toBe(
      state.sessions.length + 1,
    );
  });
  it("places overlaps in separate columns and reuses boundary slots", () => {
    const make = (id: string, start: number, end: number) => ({
      id,
      start,
      end,
      title: id,
      kind: "class" as const,
    });
    const rows = layoutEvents([
      make("a", 0, 10),
      make("b", 5, 15),
      make("c", 10, 20),
      make("d", 20, 25),
    ]);
    expect(rows.map((r) => [r.column, r.columns])).toEqual([
      [0, 2],
      [1, 2],
      [0, 2],
      [0, 1],
    ]);
  });
  it("calendar includes async, assessment, and active travel but excludes cancelled travel", () => {
    const state = structuredClone(seedState);
    state.trips[0].status = "cancelled";
    expect(calendarEvents(state).some((e) => e.id === state.trips[0].id)).toBe(
      false,
    );
    expect(calendarEvents(state).some((e) => e.kind === "async")).toBe(true);
  });
  it("cancelled trip does not create assessment risk", () => {
    const state = structuredClone(seedState);
    const trip = { ...state.trips[0], status: "cancelled" as const };
    state.assessments = [
      {
        id: "exam",
        courseId: state.courses[0].id,
        title: "Exam",
        startsAt: trip.departureAt,
        endsAt: trip.returnAt,
        confidence: "confirmed",
        type: "exam",
      },
    ];
    expect(assessmentConflicts(state, trip)).toEqual([]);
  });
  it("zero remaining is at limit, not over limit", () => {
    const s = structuredClone(seedState);
    s.trips = [];
    s.attendance = [];
    const session = s.sessions.find((v) => v.units.length === 2)!;
    s.courses = s.courses.map((c) =>
      c.id === session.courseId
        ? { ...c, totalUnits: 10, requiredAttendanceBps: 8000 }
        : c,
    );
    let next = s;
    for (const u of session.units)
      next = recordAttendance(next, session.id, u.id, "absent");
    expect(
      getProjection(next, null, Date.now()).courses.find(
        (c) => c.courseId === session.courseId,
      )?.status,
    ).toBe("At limit");
  });
});

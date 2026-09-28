import { describe, expect, it } from "vitest";
import { localDateTimeToEpoch, type AppState } from "./domain";
import { decodeBackup, encodeBackup } from "./persistence";
import {
  commitImport,
  finalized,
  parseCsv,
  previewCsv,
  previewIcs,
  suggestedCourseResolutions,
} from "./importers";

const state = (): AppState => ({
  schemaVersion: 1,
  timezone: "Europe/Madrid",
  scheduleCoverage: "incomplete",
  courses: [
    {
      id: "finance",
      name: "AI for Finance",
      totalUnits: 15,
      requiredAttendanceBps: 8000,
    },
  ],
  sessions: [],
  attendance: [],
  assessments: [],
  trips: [],
  scenarios: [],
});
const csv = (title = "Seminar, week 1") =>
  [
    "source_id,course_id,title,start,end,timezone,unit_labels,delivery_mode",
    `csv-1,finance,"${title.replaceAll('"', '""')}",2026-09-11 09:30,2026-09-11 10:50,Europe/Madrid,Session 1,in-person`,
  ].join("\n");

describe("CSV imports", () => {
  it("parses quoted fields and updates the stable source identity without duplicates", () => {
    expect(parseCsv('a,b\n"one, two","say ""hi"""')[1]).toEqual([
      "one, two",
      'say "hi"',
    ]);
    const first = previewCsv(csv(), state());
    expect(first.rows[0].title).toBe("Seminar, week 1");
    const imported = commitImport(state(), first, {
      "csv-2": { selected: true },
    });
    expect(imported.sessions).toHaveLength(1);
    const updated = commitImport(
      imported,
      previewCsv(csv("Changed title"), imported),
      { "csv-2": { selected: true } },
    );
    expect(updated.sessions).toHaveLength(1);
    expect(updated.sessions[0]).toMatchObject({
      title: "Changed title",
      source: "csv",
      sourceId: "csv-1",
    });
  });

  it("keeps imported sessions valid through a backup round trip", () => {
    const preview = previewCsv(csv(), state());
    const imported = commitImport(state(), preview, {
      "csv-2": { selected: true },
    });
    const restored = decodeBackup(
      encodeBackup(imported, "2026-09-01T00:00:00.000Z"),
    );
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value.sessions).toEqual(imported.sessions);
  });

  it("blocks an update that would remove referenced units", () => {
    const twoUnits = csv().replace(
      "Session 1,in-person",
      "Session 1|Session 2,in-person",
    );
    const first = commitImport(state(), previewCsv(twoUnits, state()), {
      "csv-2": { selected: true },
    });
    const session = first.sessions[0];
    const withReferences: AppState = {
      ...first,
      attendance: [
        {
          id: "a1",
          sessionId: session.id,
          unitId: session.units[0].id,
          status: "attended",
        },
        {
          id: "a2",
          sessionId: session.id,
          unitId: session.units[1].id,
          status: "absent",
        },
      ],
      scenarios: [
        {
          id: "plan",
          name: "Plan",
          enabled: true,
          plannedUnitIds: session.units.map((unit) => unit.id),
        },
      ],
    };
    const updated = commitImport(
      withReferences,
      previewCsv(csv("Changed"), withReferences),
      { "csv-2": { selected: true } },
    );
    expect(updated).toBe(withReferences);
    expect(updated.attendance.map((record) => record.unitId)).toEqual(
      session.units.map((unit) => unit.id),
    );
    expect(updated.scenarios[0].plannedUnitIds).toEqual(
      session.units.map((unit) => unit.id),
    );
  });
});

describe("ICS imports", () => {
  it("normalizes TZID events to Madrid epochs and surfaces UID/SEQUENCE", () => {
    const preview = previewIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:ny-class",
        "SEQUENCE:4",
        "DTSTART;TZID=America/New_York:20260911T093000",
        "DTEND;TZID=America/New_York:20260911T105000",
        "SUMMARY:AI for Finance",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
      state(),
    );
    expect(preview.rows[0]).toMatchObject({
      sourceId: "ny-class",
      sequence: 4,
      generic: true,
    });
    expect(preview.rows[0].startsAt).toBe(
      localDateTimeToEpoch("2026-09-11 15:30"),
    );
    const imported = commitImport(state(), preview, {
      "ics-1": {
        selected: true,
        importAs: "class",
        courseId: "finance",
        unitLabels: ["Session 1"],
      },
    });
    expect(imported.sessions[0]).toMatchObject({
      source: "ics",
      sourceId: "ny-class",
      timezone: "Europe/Madrid",
    });
  });

  it("warns on all-day/floating events and blocks recurrence and unknown TZIDs", () => {
    const preview = previewIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:all-day",
        "DTSTART;VALUE=DATE:20260911",
        "DTEND;VALUE=DATE:20260912",
        "SUMMARY:Holiday",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:floating",
        "DTSTART:20260911T093000",
        "DTEND:20260911T105000",
        "SUMMARY:Personal event",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:repeat",
        "DTSTART;TZID=Not/AZone:20260911T093000",
        "DTEND;TZID=Not/AZone:20260911T105000",
        "RRULE:FREQ=WEEKLY",
        "SUMMARY:Repeat",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
      state(),
    );
    expect(
      preview.rows[0].issues.map((issue) => issue.message).join(" "),
    ).toMatch(/all-day/);
    expect(
      preview.rows[1].issues.map((issue) => issue.message).join(" "),
    ).toMatch(/floating/);
    expect(preview.rows[1].generic).toBe(true);
    expect(preview.rows[1].courseId).toBeUndefined();
    expect(
      preview.rows[2].issues.map((issue) => issue.message).join(" "),
    ).toMatch(/Unsupported recurrence.*Unknown TZID/);
    const initial = state();
    expect(
      commitImport(initial, preview, {
        "ics-2": {
          selected: true,
          importAs: "class",
          courseId: "finance",
          unitLabels: ["Session 2"],
        },
        "ics-3": {
          selected: true,
          importAs: "class",
          courseId: "finance",
          unitLabels: ["Session 3"],
        },
      }),
    ).toBe(initial);
    const imported = commitImport(initial, preview, {
      "ics-2": {
        selected: true,
        importAs: "class",
        courseId: "finance",
        unitLabels: ["Session 2"],
      },
    });
    expect(imported.sessions).toHaveLength(1);
    expect(imported.sessions[0].sourceId).toBe("floating");
  });

  it("uses UID plus RECURRENCE-ID as the update identity", () => {
    const event = (summary: string) =>
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:series",
        "RECURRENCE-ID:20260911T093000Z",
        "SEQUENCE:2",
        "DTSTART:20260911T093000Z",
        "DTEND:20260911T105000Z",
        `SUMMARY:${summary}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n");
    const first = commitImport(state(), previewIcs(event("First"), state()), {
      "ics-1": {
        selected: true,
        importAs: "class",
        courseId: "finance",
        unitLabels: ["Session 1"],
      },
    });
    const secondPreview = previewIcs(event("Updated"), first);
    const second = commitImport(first, secondPreview, {
      "ics-1": {
        selected: true,
        importAs: "class",
        courseId: "finance",
        unitLabels: ["Session 1"],
      },
    });
    expect(second.sessions).toHaveLength(1);
    expect(second.sessions[0]).toMatchObject({
      title: "Updated",
      sourceId: "series/20260911T093000Z",
    });
    const older = event("Stale").replace("SEQUENCE:2", "SEQUENCE:1");
    const stalePreview = previewIcs(older, second);
    expect(
      stalePreview.rows[0].issues.map((issue) => issue.message).join(" "),
    ).toMatch(/older than/);
    expect(
      commitImport(second, stalePreview, {
        "ics-1": {
          selected: true,
          importAs: "class",
          courseId: "finance",
          unitLabels: ["Session 1"],
        },
      }).sessions[0].title,
    ).toBe("Updated");
  });

  it("blocks cancellation when class units have attendance or plan references", () => {
    const active = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:cancel-me",
      "DTSTART:20260911T093000Z",
      "DTEND:20260911T105000Z",
      "SUMMARY:Class",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const first = commitImport(state(), previewIcs(active, state()), {
      "ics-1": {
        selected: true,
        importAs: "class",
        courseId: "finance",
        unitLabels: ["Session 1"],
      },
    });
    const session = first.sessions[0];
    const withReferences: AppState = {
      ...first,
      attendance: [
        {
          id: "a",
          sessionId: session.id,
          unitId: session.units[0].id,
          status: "absent",
        },
      ],
      scenarios: [
        {
          id: "plan",
          name: "Plan",
          enabled: true,
          plannedUnitIds: [session.units[0].id],
        },
      ],
    };
    const cancelled = previewIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:cancel-me",
        "STATUS:CANCELLED",
        "SUMMARY:Class",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
      withReferences,
    );
    expect(
      cancelled.rows[0].issues.map((issue) => issue.message).join(" "),
    ).toMatch(/cancelled/);
    const result = commitImport(withReferences, cancelled, {
      "ics-1": { selected: true, importAs: "class" },
    });
    expect(result).toBe(withReferences);
    expect(
      finalized(cancelled.rows[0], withReferences, {
        selected: true,
        importAs: "class",
      })
        .issues.map((issue) => issue.message)
        .join(" "),
    ).toMatch(/recorded attendance or a planned skip/);
    expect(
      commitImport(
        first,
        previewIcs(
          [
            "BEGIN:VCALENDAR",
            "BEGIN:VEVENT",
            "UID:cancel-me",
            "STATUS:CANCELLED",
            "SUMMARY:Class",
            "END:VEVENT",
            "END:VCALENDAR",
          ].join("\n"),
          first,
        ),
        { "ics-1": { selected: true, importAs: "class" } },
      ).sessions,
    ).toHaveLength(0);
  });

  it("requires an explicit travel choice and status, then updates a trip by UID", () => {
    const event = (sequence: number, title = "Valencia") =>
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:travel-1",
        `SEQUENCE:${sequence}`,
        "DTSTART:20260911T100000Z",
        "DTEND:20260913T160000Z",
        `SUMMARY:${title}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n");
    const initial = state();
    const preview = previewIcs(event(1), initial);
    expect(
      commitImport(initial, preview, { "ics-1": { selected: true } }),
    ).toBe(initial);
    expect(
      commitImport(initial, preview, {
        "ics-1": { selected: true, importAs: "trip" },
      }),
    ).toBe(initial);
    const first = commitImport(initial, preview, {
      "ics-1": { selected: true, importAs: "trip", tripStatus: "tentative" },
    });
    expect(first.trips[0]).toMatchObject({
      name: "Valencia",
      status: "tentative",
      source: "ics",
      sourceId: "travel-1",
      sequence: 1,
    });
    const updated = commitImport(
      first,
      previewIcs(event(2, "Valencia weekend"), first),
      {
        "ics-1": { selected: true, importAs: "trip", tripStatus: "confirmed" },
      },
    );
    expect(updated.trips).toHaveLength(1);
    expect(updated.trips[0]).toMatchObject({
      name: "Valencia weekend",
      status: "confirmed",
      sequence: 2,
    });
    const cancellation = previewIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:travel-1",
        "STATUS:CANCELLED",
        "SUMMARY:Valencia weekend",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
      updated,
    );
    expect(
      commitImport(updated, cancellation, {
        "ics-1": { selected: true, importAs: "trip" },
      }).trips,
    ).toHaveLength(0);
  });

  it("moves a UID between class and trip instead of keeping both", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:reclassify",
      "DTSTART:20260911T100000Z",
      "DTEND:20260913T160000Z",
      "SUMMARY:Weekend",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const preview = previewIcs(text, state());
    const asClass = commitImport(state(), preview, {
      "ics-1": {
        selected: true,
        importAs: "class",
        courseId: "finance",
        unitLabels: ["Session 1"],
      },
    });
    const asTrip = commitImport(asClass, previewIcs(text, asClass), {
      "ics-1": { selected: true, importAs: "trip", tripStatus: "tentative" },
    });
    expect(asTrip.sessions).toHaveLength(0);
    expect(asTrip.trips).toHaveLength(1);
  });

  it("does not create a retained suggested course when a Blackboard class is reviewed as travel", () => {
    const empty = { ...state(), courses: [] };
    const preview = previewIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:travel-from-class",
        "DTSTART:20260911T100000Z",
        "DTEND:20260913T160000Z",
        "SUMMARY:SPORTS MARKETING (Ses. 1) Live in-person",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
      empty,
    );
    const proposed = suggestedCourseResolutions(preview, empty);
    const course = Object.values(proposed)[0];
    const resolution = {
      "ics-1": {
        selected: true,
        importAs: "trip" as const,
        courseId: course.id,
        tripStatus: "tentative" as const,
      },
    };
    expect(
      finalized(preview.rows[0], empty, resolution["ics-1"], proposed).courseId,
    ).toBeUndefined();
    const imported = commitImport(empty, preview, resolution, proposed);
    expect(imported.courses).toEqual([]);
    expect(imported.trips).toHaveLength(1);
  });

  it("suggests Blackboard courses and numbered units but creates them only after explicit review", () => {
    const empty = { ...state(), courses: [] };
    const preview = previewIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:class-double",
        "DTSTART;TZID=Europe/Madrid:20260911T093000",
        "DTEND;TZID=Europe/Madrid:20260911T105000",
        "SUMMARY:SPORTS MARKETING & VALUE CREATION (Ses. 2-3) Live in-person",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:class-async",
        "DTSTART;TZID=Europe/Madrid:20261026T093000",
        "DTEND;TZID=Europe/Madrid:20261026T105000",
        "SUMMARY:SPORTS MARKETING & VALUE CREATION (Ses. 4) Asynchronous",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:deadline",
        "DTSTART;TZID=Europe/Madrid:20260912T120000",
        "DTEND;TZID=Europe/Madrid:20260912T120000",
        "SUMMARY:Final project submission deadline",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:presentation",
        "DTSTART;TZID=Europe/Madrid:20260913T120000",
        "DTEND;TZID=Europe/Madrid:20260913T130000",
        "SUMMARY:Final presentation",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:institutional",
        "DTSTART;TZID=Europe/Madrid:20260914T120000",
        "DTEND;TZID=Europe/Madrid:20260914T130000",
        "SUMMARY:Campus welcome",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
      empty,
    );
    expect(preview.rows.map((row) => row.suggestedImportAs)).toEqual([
      "class",
      "class",
      "deadline",
      "assessment",
      "ignore",
    ]);
    expect(preview.rows[0]).toMatchObject({
      unitLabels: ["Session 2", "Session 3"],
      deliveryMode: "in-person",
    });
    expect(preview.rows[1]).toMatchObject({
      unitLabels: ["Session 4"],
      deliveryMode: "async",
    });
    const proposed = suggestedCourseResolutions(preview, empty);
    const course = Object.values(proposed)[0];
    expect(course).toMatchObject({ observedUnits: 4, confirmed: false });
    const rows = {
      "ics-1": {
        selected: true,
        importAs: "class" as const,
        courseId: course.id,
        unitLabels: preview.rows[0].unitLabels,
      },
      "ics-2": {
        selected: true,
        importAs: "class" as const,
        courseId: course.id,
        unitLabels: preview.rows[1].unitLabels,
      },
      "ics-3": {
        selected: true,
        importAs: "deadline" as const,
        courseId: course.id,
        assessmentType: "assignment" as const,
        confidence: "unknown" as const,
      },
      "ics-4": {
        selected: true,
        importAs: "assessment" as const,
        courseId: course.id,
        assessmentType: "presentation" as const,
        confidence: "unknown" as const,
      },
    };
    expect(commitImport(empty, preview, rows, proposed)).toBe(empty);
    const reviewedCourses = {
      [course.id]: {
        ...course,
        confirmed: true,
        totalUnits: 12,
        requiredAttendanceBps: 8000,
      },
    };
    const imported = commitImport(empty, preview, rows, reviewedCourses);
    expect(imported.courses).toEqual([
      expect.objectContaining({
        id: course.id,
        totalUnits: 12,
        requiredAttendanceBps: 8000,
      }),
    ]);
    expect(
      imported.sessions.map((session) => [
        session.deliveryMode,
        session.units.map((unit) => unit.label),
      ]),
    ).toEqual([
      ["in-person", ["Session 2", "Session 3"]],
      ["async", ["Session 4"]],
    ]);
    expect(imported.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "deadline",
          startsAt: preview.rows[2].startsAt,
          endsAt: preview.rows[2].startsAt,
          dueAt: preview.rows[2].startsAt,
          type: "assignment",
        }),
        expect.objectContaining({
          sourceId: "presentation",
          dueAt: undefined,
          type: "presentation",
        }),
      ]),
    );
    expect(decodeBackup(encodeBackup(imported)).ok).toBe(true);
  });

  it("preserves unit identities by label across reordered reimports and blocks referenced removal", () => {
    const event = (sequence: number) =>
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:stable-units",
        `SEQUENCE:${sequence}`,
        "DTSTART:20260911T093000Z",
        "DTEND:20260911T105000Z",
        "SUMMARY:AI for Finance (Ses. 2-3) Live in-person",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n");
    const first = commitImport(state(), previewIcs(event(1), state()), {
      "ics-1": {
        selected: true,
        importAs: "class",
        courseId: "finance",
        unitLabels: ["Session 2", "Session 3"],
      },
    });
    const ids = Object.fromEntries(
      first.sessions[0].units.map((unit) => [unit.label, unit.id]),
    );
    const withReferences: AppState = {
      ...first,
      attendance: [
        {
          id: "attendance",
          sessionId: first.sessions[0].id,
          unitId: ids["Session 2"],
          status: "attended",
        },
      ],
      scenarios: [
        {
          id: "scenario",
          name: "Scenario",
          enabled: true,
          plannedUnitIds: [ids["Session 3"]],
        },
      ],
    };
    const reordered = commitImport(
      withReferences,
      previewIcs(event(2), withReferences),
      {
        "ics-1": {
          selected: true,
          importAs: "class",
          courseId: "finance",
          unitLabels: ["Session 3", "Session 2"],
        },
      },
    );
    expect(
      Object.fromEntries(
        reordered.sessions[0].units.map((unit) => [unit.label, unit.id]),
      ),
    ).toEqual(ids);
    expect(reordered.attendance[0].unitId).toBe(ids["Session 2"]);
    expect(reordered.scenarios[0].plannedUnitIds).toEqual([ids["Session 3"]]);
    expect(
      commitImport(reordered, previewIcs(event(3), reordered), {
        "ics-1": {
          selected: true,
          importAs: "class",
          courseId: "finance",
          unitLabels: ["Session 3"],
        },
      }),
    ).toBe(reordered);
  });

  it("upserts assessments by UID and keeps reviewed mapping, type, confidence, and sequence", () => {
    const event = (sequence: number, title: string) =>
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:assessment-uid",
        `SEQUENCE:${sequence}`,
        "DTSTART:20260911T093000Z",
        "DTEND:20260911T105000Z",
        `SUMMARY:${title}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n");
    const first = commitImport(
      state(),
      previewIcs(event(2, "Final presentation"), state()),
      {
        "ics-1": {
          selected: true,
          importAs: "assessment",
          courseId: "finance",
          assessmentType: "presentation",
          confidence: "confirmed",
        },
      },
    );
    const dueAt = first.assessments[0].endsAt + 86_400_000;
    const withDueAt = {
      ...first,
      assessments: [{ ...first.assessments[0], dueAt }],
    };
    const nextPreview = previewIcs(event(3, "Updated presentation"), withDueAt);
    expect(nextPreview.rows[0]).toMatchObject({
      courseId: "finance",
      assessmentType: "presentation",
      confidence: "confirmed",
    });
    const updated = commitImport(withDueAt, nextPreview, {
      "ics-1": {
        selected: true,
        importAs: "assessment",
        courseId: "finance",
        assessmentType: "presentation",
        confidence: "confirmed",
      },
    });
    expect(updated.assessments).toHaveLength(1);
    expect(updated.assessments[0]).toMatchObject({
      id: first.assessments[0].id,
      title: "Updated presentation",
      sequence: 3,
      dueAt,
    });
    const stale = previewIcs(event(1, "Stale presentation"), updated);
    expect(
      commitImport(updated, stale, {
        "ics-1": {
          selected: true,
          importAs: "assessment",
          courseId: "finance",
        },
      }),
    ).toBe(updated);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  checkTextSize,
  MAX_RECORDS,
  MAX_TEXT_BYTES,
  readPlannerFile,
} from "./limits";
import { parseCsv, previewCsv, previewIcs } from "./importers";
import { decodeBackup, encodeBackup, validateState } from "./persistence";
import { emptyPlannerState } from "./state";

describe("untrusted import boundaries", () => {
  it("rejects oversized files before reading and measures pasted UTF-8 bytes", async () => {
    const text = vi.fn();
    await expect(
      readPlannerFile({ size: MAX_TEXT_BYTES + 1, text } as unknown as File),
    ).rejects.toThrow(/2 MiB/);
    expect(text).not.toHaveBeenCalled();
    expect(() => checkTextSize("é".repeat(MAX_TEXT_BYTES / 2 + 1))).toThrow(
      /2 MiB/,
    );
    expect(decodeBackup("x".repeat(MAX_TEXT_BYTES + 1))).toMatchObject({
      ok: false,
    });
  });
  it("bounds CSV records and ICS events before rendering a preview", () => {
    expect(parseCsv("a,b\n" + "1,2\n".repeat(MAX_RECORDS))).toHaveLength(
      MAX_RECORDS + 1,
    );
    expect(() => parseCsv("a,b\n" + "1,2\n".repeat(MAX_RECORDS + 1))).toThrow(
      /data rows/,
    );
    expect(() =>
      previewIcs(
        "BEGIN:VEVENT\nEND:VEVENT\n".repeat(MAX_RECORDS + 1),
        emptyPlannerState(),
      ),
    ).toThrow(/calendar events/);
    const many = {
      ...emptyPlannerState(),
      courses: Array.from({ length: MAX_RECORDS + 1 }, (_, i) => ({
        id: String(i),
        name: "Course",
        totalUnits: 10,
        requiredAttendanceBps: 8000,
      })),
    };
    expect(validateState(many).ok).toBe(false);
  });
  it("rejects impossible UTC dates instead of rolling them into another day", () => {
    for (const date of [
      "20260230T100000Z",
      "20261301T100000Z",
      "20260201T240000Z",
      "20260201T106000Z",
    ]) {
      const preview = previewIcs(
        `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:bad\nDTSTART:${date}\nDTEND:20270302T110000Z\nSUMMARY:Exam\nEND:VEVENT\nEND:VCALENDAR`,
        emptyPlannerState(),
      );
      expect(
        preview.rows[0].issues.some(
          (issue) => issue.level === "error" && /UTC/.test(issue.message),
        ),
      ).toBe(true);
      expect(preview.rows[0].startsAt).toBeUndefined();
    }
    expect(
      previewCsv(
        "source_id,title,start,end\nx,Exam,2026-02-30T10:00Z,2026-03-02T11:00Z",
        emptyPlannerState(),
      ).rows[0].issues.some((i) => /UTC/.test(i.message)),
    ).toBe(true);
  });
  it("blocks duplicate CSV source identities within one import", () => {
    const preview = previewCsv(
      "source_id,title,start,end\nx,One,2026-09-01T10:00Z,2026-09-01T11:00Z\nx,Two,2026-09-02T10:00Z,2026-09-02T11:00Z",
      emptyPlannerState(),
    );
    expect(
      preview.rows.every((row) =>
        row.issues.some((i) => /repeats a source_id/.test(i.message)),
      ),
    ).toBe(true);
  });
  it("keeps an empty planner portable and rejects broken assessment references", () => {
    expect(decodeBackup(encodeBackup(emptyPlannerState())).ok).toBe(true);
    expect(
      validateState({
        ...emptyPlannerState(),
        courses: [
          {
            id: "c",
            name: "Course",
            totalUnits: 10,
            requiredAttendanceBps: 8000,
          },
        ],
        sessions: [
          {
            id: "s",
            courseId: "c",
            startsAt: 1,
            endsAt: 2,
            units: [{ id: "u", label: "Unit" }],
            deliveryMode: "in-person",
            assessmentId: "missing",
          },
        ],
      }).ok,
    ).toBe(false);
  });
});

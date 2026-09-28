import { describe, expect, it } from "vitest";
import { occursWithin, type CalendarEvent } from "./calendarLayout";

const event = (start: number, end: number): CalendarEvent => ({
  id: "event",
  kind: "assessment",
  title: "Deadline",
  start,
  end,
});

describe("calendar point placement", () => {
  it("includes midnight on its own day and keeps the end boundary exclusive", () => {
    expect(occursWithin(event(100, 100), 100, 200)).toBe(true);
    expect(occursWithin(event(200, 200), 100, 200)).toBe(false);
    expect(occursWithin(event(150, 150), 100, 200)).toBe(true);
  });
});

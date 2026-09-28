import type { AppState } from "./domain";
export interface CalendarEvent {
  id: string;
  kind: "class" | "assessment" | "trip" | "async";
  title: string;
  start: number;
  end: number;
  courseId?: string;
}
export const occursWithin = (
  event: CalendarEvent,
  start: number,
  end: number,
) =>
  event.start === event.end
    ? event.start >= start && event.start < end
    : event.start < end && event.end > start;
export function calendarEvents(state: AppState): CalendarEvent[] {
  return [
    ...state.sessions.map((s) => ({
      id: s.id,
      kind:
        s.deliveryMode === "async" ? ("async" as const) : ("class" as const),
      title: state.courses.find((c) => c.id === s.courseId)?.name ?? "Class",
      start: s.startsAt,
      end: s.endsAt,
      courseId: s.courseId,
    })),
    ...state.assessments.map((a) => ({
      id: a.id,
      kind: "assessment" as const,
      title: a.title,
      start: a.startsAt,
      end: a.endsAt,
      courseId: a.courseId,
    })),
    ...state.trips
      .filter((t) => t.status !== "cancelled")
      .map((t) => ({
        id: t.id,
        kind: "trip" as const,
        title: t.name,
        start: t.departureAt - (t.departureBufferMinutes ?? 0) * 60000,
        end: t.returnAt + (t.returnBufferMinutes ?? 0) * 60000,
      })),
  ].sort((a, b) => a.start - b.start);
}
/** Interval clusters share column widths; events touching at a boundary do not overlap. */
export function layoutEvents(
  events: CalendarEvent[],
): (CalendarEvent & { column: number; columns: number })[] {
  const output: (CalendarEvent & { column: number; columns: number })[] = [];
  let cluster: typeof output = [];
  let ends: number[] = [];
  let maxEnd = -Infinity;
  const flush = () => {
    cluster.forEach((e) => output.push({ ...e, columns: ends.length }));
    cluster = [];
    ends = [];
  };
  for (const event of [...events].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  )) {
    if (event.start >= maxEnd) {
      flush();
      maxEnd = -Infinity;
    }
    let column = ends.findIndex((end) => end <= event.start);
    if (column < 0) column = ends.length;
    ends[column] = event.end;
    maxEnd = Math.max(maxEnd, event.end);
    cluster.push({ ...event, column, columns: 1 });
  }
  flush();
  return output;
}

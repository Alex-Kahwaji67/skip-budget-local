// A semester-sized planner, not a bulk calendar archive.
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_RECORDS = 2_000;

export function checkTextSize(text: string): void {
  if (
    text.length > MAX_TEXT_BYTES ||
    new TextEncoder().encode(text).length > MAX_TEXT_BYTES
  )
    throw new Error("Files and pasted data must be 2 MiB or smaller.");
}

export async function readPlannerFile(file: File): Promise<string> {
  if (file.size > MAX_TEXT_BYTES)
    throw new Error("Files must be 2 MiB or smaller.");
  const text = await file.text();
  checkTextSize(text);
  return text;
}

import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-28T12:00:00Z"));
});

async function savedState(page: Page) {
  return page.evaluate(
    () =>
      new Promise<any>((resolve, reject) => {
        const request = indexedDB.open("skip-budget-local", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db
            .transaction("documents")
            .objectStore("documents")
            .get("current");
          read.onsuccess = () => {
            db.close();
            resolve(read.result);
          };
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
        };
      }),
  );
}
async function example(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Course attendance ledger" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load fictional example", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(
    page.getByText("Fictional example data —", { exact: false }),
  ).toBeVisible();
}
async function dataPage(page: Page) {
  await page
    .getByRole("button", { name: "Data / Backup", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Data / Backup / Recovery" }),
  ).toBeVisible();
}
async function confirm(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".save-indicator")).toBeHidden();
}

test("local planner: scenarios, partial attendance, backup, reset, recovery, restore, responsive screenshots", async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await example(page);
  const original = await savedState(page);
  expect(original.courses).toHaveLength(3);
  await page
    .getByRole("button", { name: "Leave a day earlier", exact: true })
    .click();
  await expect(
    page.getByText("Hypothetical scenario:", { exact: false }),
  ).toBeVisible();
  expect(await savedState(page)).toEqual(original);

  const screenshots = process.env.CAPTURE_DOCS
    ? path.resolve("docs/screenshots")
    : testInfo.outputPath("screenshots");
  await mkdir(screenshots, { recursive: true });
  await page
    .getByRole("button", { name: "Confirmed plans", exact: true })
    .click();
  const dismissNotice = page.getByRole("button", {
    name: "Dismiss notification",
  });
  if (await dismissNotice.isVisible()) await dismissNotice.click();
  await page.screenshot({
    path: path.join(screenshots, "overview.png"),
    fullPage: true,
  });
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (width === 390)
      await page.screenshot({
        path: path.join(screenshots, "mobile.png"),
        fullPage: false,
      });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Record units", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Class block editor" });
  await dialog
    .getByLabel("Attendance for Unit 1", { exact: true })
    .selectOption("attended");
  await dialog
    .getByLabel("Attendance for Unit 2", { exact: true })
    .selectOption("absent");
  await dialog.getByRole("button", { name: "Save class", exact: true }).click();
  await expect(dialog).toBeHidden();
  const edited = await savedState(page);
  expect(
    edited.attendance
      .filter((a: any) => a.sessionId === "double-data")
      .map((a: any) => a.status),
  ).toEqual(["attended", "absent"]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Course attendance ledger" }),
  ).toBeVisible();
  expect(await savedState(page)).toEqual(edited);

  await dataPage(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const file = await (await download).path();
  expect(file).toBeTruthy();
  expect(JSON.parse(await readFile(file!, "utf8")).state).toEqual(edited);
  await page.getByRole("button", { name: "Reset with recovery" }).click();
  await confirm(page);
  expect((await savedState(page)).courses).toHaveLength(0);
  await page.getByRole("button", { name: "Recover previous data" }).click();
  await confirm(page);
  expect(await savedState(page)).toEqual(edited);
  await page.getByLabel("Restore JSON", { exact: true }).setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"wrong"}'),
  });
  await expect(page.getByRole("alert")).toContainText("not a supported");
  expect(await savedState(page)).toEqual(edited);
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await page.getByRole("button", { name: "Reset with recovery" }).click();
  await confirm(page);
  await page.getByLabel("Restore JSON", { exact: true }).setInputFiles(file!);
  await confirm(page);
  expect(await savedState(page)).toEqual(edited);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("CSV review imports only selected valid rows; cancellation does not save", async ({
  page,
}) => {
  await example(page);
  const before = await savedState(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const csv =
    "source_id,course_id,title,start,end,timezone,unit_labels,delivery_mode\nfixture,data,Synthetic workshop,2027-01-12 09:00,2027-01-12 10:00,Europe/Madrid,Workshop 1,in-person\nbad,data,Invalid workshop,2027-01-12 11:00,2027-01-12 10:00,Europe/Madrid,Workshop 2,in-person";
  await page.getByLabel("Or paste the file contents").fill(csv);
  await page.getByRole("button", { name: "Preview imported data" }).click();
  await page
    .getByRole("checkbox", { name: "Select Synthetic workshop", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Select Invalid workshop", exact: true })
    .check();
  await expect(
    page.getByRole("button", { name: "Import selected", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "Select Invalid workshop", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await savedState(page)).toEqual(before);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByLabel("Or paste the file contents").fill(csv);
  await page.getByRole("button", { name: "Preview imported data" }).click();
  await page
    .getByRole("checkbox", { name: "Select Synthetic workshop", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Import selected", exact: true })
    .click();
  await expect
    .poll(async () => (await savedState(page)).sessions.length)
    .toBe(before.sessions.length + 1);
  await expect(
    page.getByRole("heading", { name: "Import saved", exact: true }),
  ).toBeVisible();
  expect(
    (await savedState(page)).sessions.some(
      (s: any) => s.title === "Invalid workshop",
    ),
  ).toBe(false);
});

test("aborted local writes retain the candidate; retry saves once; a second tab cannot overwrite", async ({
  page,
  context,
}) => {
  await example(page);
  const before = await savedState(page);
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByRole("alert")).toContainText(
    "already open in another tab",
  );
  await second.close();
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<typeof original>
    ) {
      const tx = original.apply(this, args);
      if (args[1] === "readwrite" && (window as any).__abortWrites)
        queueMicrotask(() => tx.abort());
      return tx;
    };
    (window as any).__abortWrites = true;
  });
  await dataPage(page);
  await page.getByRole("button", { name: "Reset with recovery" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  const retained = page.getByRole("dialog", { name: "Change not saved" });
  await expect(retained).toBeVisible();
  expect(await savedState(page)).toEqual(before);
  const download = page.waitForEvent("download");
  await retained.getByRole("button", { name: "Export unsaved change" }).click();
  const candidate = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  ).state;
  expect(candidate.courses).toHaveLength(0);
  await page.evaluate(() => {
    (window as any).__abortWrites = false;
  });
  await retained.getByRole("button", { name: "Retry save" }).click();
  await expect(retained).toBeHidden();
  expect((await savedState(page)).courses).toHaveLength(0);
  await dataPage(page);
  await page.getByRole("button", { name: "Recover previous data" }).click();
  await confirm(page);
  expect(await savedState(page)).toEqual(before);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(
    reopened.getByRole("heading", { name: "Course attendance ledger" }),
  ).toBeVisible();
  expect(await savedState(reopened)).toEqual(before);
});

test("a failed initial read does not initialize or overwrite stored data", async ({
  page,
}) => {
  await example(page);
  const before = await savedState(page);
  await page.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<typeof original>
    ) {
      if (!(window as any).__readAllowed)
        throw new Error("Synthetic read failure");
      return original.apply(this, args);
    };
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Synthetic read failure");
  await page.evaluate(() => {
    (window as any).__readAllowed = true;
  });
  expect(await savedState(page)).toEqual(before);
});

test("an empty planner supports manual courses, classes, and what-if skips", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add your first course" }).click();
  const course = page.getByRole("dialog", { name: "Add course", exact: true });
  await course
    .getByLabel("Course name", { exact: true })
    .fill("Synthetic seminar");
  await course.getByLabel("Total attendance units").fill("10");
  await course.getByRole("button", { name: "Save changes" }).click();
  await expect(course).toBeHidden();
  expect((await savedState(page)).courses).toHaveLength(1);
  page.once("dialog", (dialog) => dialog.accept("Synthetic what-if"));
  await page.getByRole("button", { name: "New what-if scenario" }).click();
  await expect(
    page.getByRole("button", { name: "Synthetic what-if", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Schedule", exact: true })
    .click();
  await page.getByRole("button", { name: "Add a class" }).click();
  const block = page.getByRole("dialog", { name: "Add class block" });
  await block
    .getByLabel("Block title (optional)", { exact: true })
    .fill("Synthetic double block");
  await block
    .getByLabel("Starts · Madrid time", { exact: true })
    .fill("2030-01-15T10:00");
  await block
    .getByLabel("Ends · Madrid time", { exact: true })
    .fill("2030-01-15T12:00");
  await block.getByLabel("Numbered attendance units").fill("Part 1 | Part 2");
  await block.getByRole("button", { name: "Save class" }).click();
  await expect(block).toBeHidden();
  expect((await savedState(page)).sessions[0].units).toHaveLength(2);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await page.getByRole("button", { name: "Record units", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Class block editor" });
  await edit
    .getByRole("checkbox", { name: "Planned skip in Synthetic what-if" })
    .first()
    .check();
  await edit.getByRole("button", { name: "Save class" }).click();
  await expect(edit).toBeHidden();
  const stored = await savedState(page);
  expect(stored.scenarios[0].plannedUnitIds).toHaveLength(1);
  expect(stored.attendance).toHaveLength(0);
});

test("trip analysis does not save; explicit save leaves attendance untouched", async ({
  page,
}) => {
  await example(page);
  const before = await savedState(page);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Trip Simulator" })
    .click();
  await page
    .getByLabel("Trip name", { exact: true })
    .fill("Synthetic alternative");
  await page
    .getByLabel("Departure · Madrid time", { exact: true })
    .fill("2030-01-15T09:00");
  await page
    .getByLabel("Return · Madrid time", { exact: true })
    .fill("2030-01-17T18:00");
  await page.getByRole("button", { name: "Analyze trip", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Scenario comparison" }),
  ).toBeVisible();
  expect(await savedState(page)).toEqual(before);
  await page.getByRole("button", { name: "Save trip", exact: true }).click();
  await expect
    .poll(async () => (await savedState(page)).trips.length)
    .toBe(before.trips.length + 1);
  expect((await savedState(page)).attendance).toEqual(before.attendance);
  await page.getByRole("button", { name: "Save trip", exact: true }).click();
  await expect(page.locator(".save-indicator")).toBeHidden();
  expect((await savedState(page)).trips).toHaveLength(before.trips.length + 1);
});

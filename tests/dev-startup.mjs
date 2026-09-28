import { createServer } from "vite";
import { chromium } from "@playwright/test";

const server = await createServer({
  server: { host: "127.0.0.1", port: 5190, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5190");
  await page
    .getByRole("heading", { name: "Course attendance ledger" })
    .waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: "Course attendance ledger" })
    .waitFor();
  console.log("Development StrictMode startup and reload passed.");
} finally {
  await browser?.close();
  await server.close();
}

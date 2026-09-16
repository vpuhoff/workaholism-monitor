import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, X509Certificate } from "node:crypto";
const base = process.env.TEST_URL || "http://localhost:4173";
const tlsArgs = [];
if (process.env.TEST_TLS_CERT) {
  // Trust only this certificate's public key in the isolated test browser.
  // The actual CA chain and hostname are verified separately with curl --cacert.
  const certificate = new X509Certificate(
    readFileSync(process.env.TEST_TLS_CERT),
  );
  const spki = certificate.publicKey.export({ type: "spki", format: "der" });
  tlsArgs.push(
    `--ignore-certificate-errors-spki-list=${createHash("sha256").update(spki).digest("base64")}`,
  );
  tlsArgs.push(`--host-resolver-rules=MAP ${new URL(base).hostname} 127.0.0.1`);
}
const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--no-sandbox",
    ...tlsArgs,
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1200 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base);
assert.equal(
  await page.evaluate(
    () =>
      window.isSecureContext &&
      typeof navigator.mediaDevices?.getUserMedia === "function",
  ),
  true,
);
await page
  .getByRole("heading", { name: "Меньше переработок. Больше жизни." })
  .waitFor();
await page.screenshot({ path: "/tmp/workaholism-desktop.png", fullPage: true });
await page.getByRole("button", { name: "Настройки", exact: true }).click();
await page.getByLabel("Диагностика камеры").check();
await page.getByLabel("Частота обработки").selectOption("2");
await page.getByRole("button", { name: "Закрыть", exact: true }).click();
await page.reload();
await page.getByRole("button", { name: "Настройки", exact: true }).click();
assert.equal(await page.getByLabel("Частота обработки").inputValue(), "2");
await page.getByRole("button", { name: "Закрыть", exact: true }).click();
await page.getByRole("button", { name: "Начать работу", exact: true }).click();
await page
  .getByRole("button", { name: "Завершить сессию", exact: true })
  .waitFor({ timeout: 60000 });
await page.getByText("Лица нет в кадре", { exact: true }).waitFor();
await page.waitForTimeout(1500);
assert.equal(await page.locator(".notices").count(), 0);
assert.ok(
  await page
    .locator("video")
    .evaluate(
      (v) =>
        v.currentTime > 0 &&
        v.srcObject.getVideoTracks()[0].readyState === "live",
    ),
);
await page
  .getByRole("button", { name: "Завершить сессию", exact: true })
  .click();
assert.equal(await page.locator("video").evaluate((v) => v.srcObject), null);
await page.getByRole("button", { name: "Вся статистика" }).click();
await page.getByRole("heading", { name: "Статистика", exact: true }).waitFor();
assert.equal(
  await page.getByRole("button", { name: "JSON", exact: true }).isDisabled(),
  true,
);
await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("workaholism-monitor", 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  await new Promise((resolve, reject) => {
    const tx = db.transaction("events", "readwrite");
    for (const [state, duration] of [
      ["WORK", 1500],
      ["OVERTIME", 300],
      ["REST", 300],
    ])
      tx.objectStore("events").put({
        id: `test-${state}`,
        session_id: "test-session",
        date,
        state,
        time_start: "10:00:00",
        time_end: "10:25:00",
        started_at: now.getTime(),
        ended_at: now.getTime(),
        duration_seconds: duration,
        completed: true,
      });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
});
await page.reload();
await page.getByRole("button", { name: "Вся статистика" }).click();
await page.getByText("Сохранено событий: 3", { exact: true }).waitFor();
assert.equal(await page.locator(".donut strong").innerText(), "17%");
const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "JSON", exact: true }).click();
const download = await downloadPromise;
const stream = await download.createReadStream();
const chunks = [];
for await (const chunk of stream) chunks.push(chunk);
assert.equal(JSON.parse(Buffer.concat(chunks).toString()).length, 3);
await page.getByRole("button", { name: "Закрыть статистику" }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: "/tmp/workaholism-mobile.png", fullPage: true });
assert.ok(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
);
await page.evaluate(async () => {
  const registration = await navigator.serviceWorker.ready;
  if (!registration.active) throw new Error("Service worker not active");
});
await page.reload();
await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
await context.setOffline(true);
await page.reload();
await page
  .getByRole("button", { name: "Начать работу", exact: true })
  .waitFor();
assert.ok(
  await page.evaluate(
    async () => (await fetch("/mediapipe/face_landmarker.task")).ok,
  ),
);
await page.getByRole("button", { name: "Начать работу", exact: true }).click();
await page
  .getByRole("button", { name: "Завершить сессию", exact: true })
  .waitFor({ timeout: 60000 });
await page
  .getByRole("button", { name: "Завершить сессию", exact: true })
  .click();
assert.deepEqual(errors, []);
await context.close();
const deniedContext = await browser.newContext();
const denied = await deniedContext.newPage();
await denied.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    throw new DOMException("Denied", "NotAllowedError");
  };
});
await denied.goto(base);
await denied
  .getByRole("button", { name: "Начать работу", exact: true })
  .click();
await denied
  .getByRole("alert")
  .filter({ hasText: "Нет доступа к камере" })
  .waitFor();
await denied
  .getByRole("button", { name: "Начать работу", exact: true })
  .waitFor();
await browser.close();
console.log(
  "Browser smoke passed: UI, mobile layout, settings, real MediaPipe inference with fake camera, camera cleanup, denied permission, offline PWA + model.",
);

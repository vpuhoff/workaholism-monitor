import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
const root = resolve(import.meta.dirname, "..");
const dir = await mkdtemp(join(tmpdir(), "monitor-sync-test-"));
const env = {
  ...process.env,
  DATABASE_URL: `file:${dir}/events.db`,
  HOST: "127.0.0.1",
  PORT: "3001",
};
const children = [];
let browser;
function start(command, args, cwd = root) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  child.output = () => output;
  children.push(child);
  return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await done;
}
async function ready(url, child) {
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw new Error(child.output());
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Not ready: ${url}\n${child.output()}`);
}
const api = "http://127.0.0.1:3001/api";
async function call(path, code, method = "GET", body) {
  return fetch(`${api}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${code}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const event = (id) => ({
  id,
  session_id: `session-${id}`,
  date: "2026-09-17",
  state: "WORK",
  time_start: "10:00:00",
  time_end: "10:25:00",
  started_at: 1789628400000,
  ended_at: 1789629900000,
  duration_seconds: 1500,
  completed: true,
});
async function seed(page, records) {
  await page.evaluate(async (records) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("workaholism-monitor");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const stores = ["events"];
      if (db.objectStoreNames.contains("outbox")) stores.push("outbox");
      const tx = db.transaction(stores, "readwrite");
      for (const record of records) {
        tx.objectStore("events").put(record);
        if (stores.includes("outbox"))
          tx.objectStore("outbox").put({ id: record.id });
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    window.dispatchEvent(new Event("monitor-local-event"));
  }, records);
}
async function count(page, expected) {
  await page.waitForFunction(async (expected) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("workaholism-monitor");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const actual = await new Promise((resolve, reject) => {
      const r = db.transaction("events").objectStore("events").count();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return actual === expected;
  }, expected);
}
async function settings(page) {
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
}
async function synced(page) {
  await page.getByText("История синхронизирована", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Синхронизировать сейчас" }).waitFor();
}
try {
  const migrate = start(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    join(root, "server"),
  );
  assert.equal(
    await new Promise((resolve) => migrate.once("exit", resolve)),
    0,
    migrate.output(),
  );
  let backend = start(
    process.execPath,
    ["--import", "tsx", "index.ts"],
    join(root, "server"),
  );
  await ready(`${api}/health`, backend);
  const a = randomBytes(32).toString("hex"),
    b = randomBytes(32).toString("hex"),
    rotated = randomBytes(32).toString("hex");
  assert.equal((await fetch(`${api}/events`)).status, 401);
  assert.equal((await call("vault", a, "POST", { code: a })).status, 201);
  assert.equal((await call("vault", b, "POST", { code: b })).status, 201);
  assert.equal(
    (await call("events", a, "PUT", { events: [event("one")] })).status,
    200,
  );
  assert.equal(
    (
      await call("events", a, "PUT", {
        events: [{ ...event("one"), duration_seconds: 1 }],
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await call("events", a)).json()).events[0].duration_seconds,
    1500,
  );
  assert.deepEqual((await (await call("events", b)).json()).events, []);
  assert.equal(
    (
      await call("events", a, "PUT", {
        events: [event("atomic"), { ...event("bad"), video: "forbidden" }],
      })
    ).status,
    400,
  );
  assert.equal((await (await call("events", a)).json()).events.length, 1);
  assert.equal(
    (
      await call("events", a, "PUT", {
        events: Array.from({ length: 201 }, (_, i) => event(`too-many-${i}`)),
      })
    ).status,
    400,
  );
  for (let batch = 0; batch < 2; batch++)
    assert.equal(
      (
        await call("events", a, "PUT", {
          events: Array.from({ length: 200 }, (_, i) =>
            event(`page-${batch}-${i}`),
          ),
        })
      ).status,
      200,
    );
  let after = 0,
    ids = [];
  for (;;) {
    const data = await (await call(`events?after=${after}`, a)).json();
    ids.push(...data.events.map((e) => e.id));
    after = data.cursor;
    if (!data.more) break;
  }
  assert.equal(new Set(ids).size, 401);
  assert.equal(
    (await call("vault/code", a, "PUT", { code: rotated })).status,
    200,
  );
  assert.equal((await call("events", a)).status, 401);
  assert.equal(
    (await call("events", a, "PUT", { events: [event("revoked")] })).status,
    401,
  );
  await stop(backend);
  backend = start(
    process.execPath,
    ["--import", "tsx", "index.ts"],
    join(root, "server"),
  );
  await ready(`${api}/health`, backend);
  assert.equal(
    (await (await call("events", rotated)).json()).events.length,
    200,
  );
  console.log(
    "API passed: auth, isolation, immutable IDs, atomic validation, pagination, rotation, persistence.",
  );
  const preview = start(process.execPath, [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4175",
    "--strictPort",
  ]);
  await ready("http://127.0.0.1:4175", preview);
  browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const desktop = await browser.newContext();
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const p1 = await desktop.newPage(),
    p2 = await phone.newPage();
  const errors = [];
  for (const page of [p1, p2])
    page.on("pageerror", (e) => errors.push(e.message));
  await p1.goto("http://127.0.0.1:4175");
  await p2.goto("http://127.0.0.1:4175");
  await seed(p1, [event("desktop")]);
  await seed(p2, [event("phone")]);
  await settings(p1);
  await p1
    .getByRole("button", { name: "Включить синхронизацию", exact: true })
    .click();
  await synced(p1);
  const code = await p1.getByLabel("Ваш код синхронизации").inputValue();
  assert.match(code, /^[a-f0-9]{64}$/);
  await settings(p2);
  await p2.getByLabel("Код с другого устройства").fill("invalid");
  await p2.getByRole("button", { name: "Подключить по коду" }).click();
  await p2
    .getByText("Введите полный код синхронизации из 64 символов.")
    .waitFor();
  await p2.getByLabel("Код с другого устройства").fill(code);
  await p2.getByRole("button", { name: "Подключить по коду" }).click();
  await synced(p2);
  await count(p2, 2);
  await p1.getByRole("button", { name: "Закрыть", exact: true }).click();
  await p1.getByRole("button", { name: "Вся статистика" }).click();
  await count(p1, 2);
  await p1.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await p1.reload();
  await p1.waitForFunction(() => navigator.serviceWorker.controller);
  await desktop.setOffline(true);
  await seed(p1, [event("offline")]);
  await p1.reload();
  await count(p1, 3);
  await settings(p1);
  await p1
    .getByText("Нет сети. История сохраняется на устройстве.", { exact: false })
    .waitFor();
  await desktop.setOffline(false);
  await synced(p1);
  await p2.getByRole("button", { name: "Синхронизировать сейчас" }).click();
  await count(p2, 3);
  assert.ok(
    await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  const puts = [];
  const cursors = [];
  const eventsApi = /\/api\/events(?:\?|$)/;
  await p2.route(eventsApi, async (route) => {
    const request = route.request();
    if (request.method() === "PUT")
      puts.push(
        JSON.parse(request.postData() || "{}").events.map((item) => item.id),
      );
    if (request.method() === "GET")
      cursors.push(new URL(request.url()).searchParams.get("after"));
    await route.continue();
  });
  const idleGet = p2.waitForRequest(
    (request) => request.method() === "GET" && eventsApi.test(request.url()),
  );
  await p2.getByRole("button", { name: "Синхронизировать сейчас" }).click();
  await idleGet;
  await synced(p2);
  assert.deepEqual(puts, []);
  assert.ok(cursors.every((value) => value && value !== "0"));
  puts.length = 0;
  const uploaded = p2.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      eventsApi.test(request.url()) &&
      (request.postData() || "").includes("incremental"),
  );
  await seed(p2, [event("incremental")]);
  await uploaded;
  await synced(p2);
  assert.deepEqual(puts, [["incremental"]]);
  await p2.unroute(eventsApi);
  await p1.getByRole("button", { name: "Синхронизировать сейчас" }).click();
  await count(p1, 4);
  await p2
    .getByRole("button", { name: "Удалить локальную историю", exact: true })
    .click();
  await p2
    .getByRole("button", {
      name: "Подтвердить удаление локальной истории",
      exact: true,
    })
    .click();
  await count(p2, 0);
  await p2.getByRole("button", { name: "Синхронизировать сейчас" }).click();
  await count(p2, 4);
  // Lose the response after the server commits rotation, then recover with the
  // pending key saved before the request. No lost access or second empty vault.
  await p1.route(
    "**/api/vault/code",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await p1
    .getByRole("button", { name: "Перевыпустить код", exact: true })
    .click();
  await p1.getByRole("button", { name: "Подтвердить перевыпуск" }).click();
  await p1
    .getByText(
      "Сервер недоступен. История сохраняется на устройстве; повторим позже.",
      { exact: false },
    )
    .waitFor();
  await p1.getByRole("button", { name: "Синхронизировать сейчас" }).click();
  await synced(p1);
  const nextCode = await p1.getByLabel("Ваш код синхронизации").inputValue();
  assert.notEqual(nextCode, code);
  await p2.getByRole("button", { name: "Синхронизировать сейчас" }).click();
  await p2
    .getByText("Код недействителен или перевыпущен. Введите актуальный код.", {
      exact: false,
    })
    .waitFor();
  await p2.getByLabel("Код с другого устройства").fill(nextCode);
  await p2.getByRole("button", { name: "Подключить по коду" }).click();
  await synced(p2);
  await count(p2, 4);
  await p2.getByRole("button", { name: "Синхронизировать сейчас" }).click();
  await synced(p2);
  await count(p2, 4);
  await p2.screenshot({
    path: "/tmp/workaholism-sync-mobile.png",
    fullPage: true,
  });
  await p2
    .getByRole("button", { name: "Отключить на этом устройстве" })
    .click();
  await p2.getByText("Синхронизация выключена", { exact: true }).waitFor();
  await count(p2, 4);
  assert.equal(
    (await (await call("events", nextCode)).json()).events.length,
    4,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser passed: two devices, history merge, invalid code, offline reload/reconnect, incremental cursor, local clear restore, deduplication, lost rotation response recovery, revoked code, disconnect, mobile layout.",
  );
} finally {
  await browser?.close();
  for (const child of children.reverse()) await stop(child);
  await rm(dir, { recursive: true, force: true });
}

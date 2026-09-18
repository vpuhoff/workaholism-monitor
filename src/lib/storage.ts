import { openDB } from "idb";
import type { LogEvent } from "./engine";
let databasePromise: ReturnType<typeof openDB> | undefined;
const database = () =>
  (databasePromise ??= openDB("workaholism-monitor", 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore("events", { keyPath: "id" });
        store.createIndex("date", "date");
      }
      if (oldVersion < 2) db.createObjectStore("outbox", { keyPath: "id" });
    },
  }).catch((error) => {
    databasePromise = undefined;
    throw error;
  }));
export async function readEvents(): Promise<LogEvent[]> {
  return (await database()).getAll("events");
}
export async function writeEvent(event: LogEvent) {
  const db = await database();
  const tx = db.transaction(["events", "outbox"], "readwrite");
  await tx.objectStore("events").put(event);
  await tx.objectStore("outbox").put({ id: event.id });
  await tx.done;
  window.dispatchEvent(new Event("monitor-local-event"));
}
export async function mergeEvents(events: LogEvent[]) {
  const db = await database();
  const tx = db.transaction("events", "readwrite");
  for (const event of events) await tx.store.put(event);
  await tx.done;
  window.dispatchEvent(new Event("monitor-events-changed"));
}
export async function queuePendingEvents() {
  const db = await database();
  const ids = await db.getAllKeys("events");
  const tx = db.transaction("outbox", "readwrite");
  for (const id of ids) await tx.store.put({ id });
  await tx.done;
}
export async function readPendingEvents(): Promise<LogEvent[]> {
  const db = await database();
  const ids = await db.getAllKeys("outbox");
  const events: LogEvent[] = [];
  const missing: IDBValidKey[] = [];
  for (const id of ids) {
    const event = await db.get("events", id);
    if (event) events.push(event);
    else missing.push(id);
  }
  if (missing.length) {
    const tx = db.transaction("outbox", "readwrite");
    for (const id of missing) await tx.store.delete(id);
    await tx.done;
  }
  return events;
}
export async function ackPendingEvents(ids: string[]) {
  const db = await database();
  const tx = db.transaction("outbox", "readwrite");
  for (const id of ids) await tx.store.delete(id);
  await tx.done;
}
export async function clearEvents() {
  const db = await database();
  const tx = db.transaction(["events", "outbox"], "readwrite");
  await tx.objectStore("events").clear();
  await tx.objectStore("outbox").clear();
  await tx.done;
}
export interface Settings {
  detection: number;
  presence: number;
  tracking: number;
  fps: number;
  sound: boolean;
}
export const defaults: Settings = {
  detection: 0.5,
  presence: 0.5,
  tracking: 0.5,
  fps: 3,
  sound: true,
};
export function readSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem("monitor-settings") || "{}");
    const next = { ...defaults };
    for (const key of ["detection", "presence", "tracking"] as const)
      if (
        typeof saved[key] === "number" &&
        saved[key] >= 0.1 &&
        saved[key] <= 0.9
      )
        next[key] = saved[key];
    if ([2, 3, 4, 5].includes(saved.fps)) next.fps = saved.fps;
    if (typeof saved.sound === "boolean") next.sound = saved.sound;
    return next;
  } catch {
    return defaults;
  }
}
export function exportEvents(events: LogEvent[], format: "json" | "csv") {
  const keys: (keyof LogEvent)[] = [
    "id",
    "session_id",
    "date",
    "state",
    "time_start",
    "time_end",
    "duration_seconds",
    "completed",
  ];
  const body =
    format === "json"
      ? JSON.stringify(events, null, 2)
      : "\uFEFF" +
        [
          keys.join(","),
          ...events.map((e) => keys.map((k) => JSON.stringify(e[k])).join(",")),
        ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([body], {
      type: format === "json" ? "application/json" : "text/csv;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `monitor-${new Date().toISOString().slice(0, 10)}.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

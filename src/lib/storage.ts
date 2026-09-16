import { openDB } from "idb";
import type { LogEvent } from "./engine";
const database = () =>
  openDB("workaholism-monitor", 1, {
    upgrade(db) {
      const store = db.createObjectStore("events", { keyPath: "id" });
      store.createIndex("date", "date");
    },
  });
export async function readEvents(): Promise<LogEvent[]> {
  return (await database()).getAll("events");
}
export async function writeEvent(event: LogEvent) {
  return (await database()).put("events", event);
}
export async function clearEvents() {
  return (await database()).clear("events");
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

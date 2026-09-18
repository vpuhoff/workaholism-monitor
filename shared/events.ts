export type Phase = "WORK" | "OVERTIME" | "REST" | "REST_VIOLATION";
export interface LogEvent {
  id: string;
  session_id: string;
  date: string;
  state: Phase;
  time_start: string;
  time_end: string;
  started_at: number;
  ended_at: number;
  duration_seconds: number;
  completed: boolean;
}
export const BATCH_SIZE = 200;
export const CODE_PATTERN = /^[a-f0-9]{64}$/;
const fields = [
  "id",
  "session_id",
  "date",
  "state",
  "time_start",
  "time_end",
  "started_at",
  "ended_at",
  "duration_seconds",
  "completed",
];
export function isLogEvent(value: unknown): value is LogEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  const text = (k: string, pattern: RegExp) =>
    typeof e[k] === "string" && pattern.test(e[k]);
  const number = (k: string) =>
    typeof e[k] === "number" &&
    Number.isFinite(e[k]) &&
    e[k] >= 0 &&
    e[k] <= 8.64e15;
  return (
    Object.keys(e).length === fields.length &&
    fields.every((k) => Object.hasOwn(e, k)) &&
    text("id", /^[\w-]{1,160}$/) &&
    text("session_id", /^[\w-]{1,128}$/) &&
    text("date", /^\d{4}-\d{2}-\d{2}$/) &&
    text("time_start", /^\d{2}:\d{2}:\d{2}$/) &&
    text("time_end", /^\d{2}:\d{2}:\d{2}$/) &&
    ["WORK", "OVERTIME", "REST", "REST_VIOLATION"].includes(String(e.state)) &&
    number("started_at") &&
    number("ended_at") &&
    number("duration_seconds") &&
    typeof e.completed === "boolean"
  );
}

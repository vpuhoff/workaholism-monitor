import { BATCH_SIZE, CODE_PATTERN, isLogEvent } from "../../shared/events";
import {
  ackPendingEvents,
  mergeEvents,
  queuePendingEvents,
  readPendingEvents,
} from "./storage";

const KEY = "monitor-sync";
interface Connection {
  code: string;
  pendingCode?: string;
  lastSync?: number;
  cursor?: number;
}
export interface SyncStatus {
  code: string;
  busy: boolean;
  message: string;
  lastSync?: number;
}
let status: SyncStatus = {
  code: "",
  busy: false,
  message: "Синхронизация выключена",
};
const listeners = new Set<() => void>();
export const getSyncStatus = () => status;
export function subscribeSync(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((listener) => listener());
}
function connection(): Connection | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const value = JSON.parse(raw) as Connection;
  if (
    !CODE_PATTERN.test(value.code) ||
    (value.pendingCode && !CODE_PATTERN.test(value.pendingCode))
  )
    throw new Error(
      "Код в браузере повреждён. Отключите синхронизацию и введите код заново.",
    );
  return {
    ...value,
    cursor:
      typeof value.cursor === "number" &&
      Number.isSafeInteger(value.cursor) &&
      value.cursor >= 0
        ? value.cursor
        : undefined,
  };
}
function save(value: Connection | null) {
  if (value) localStorage.setItem(KEY, JSON.stringify(value));
  else localStorage.removeItem(KEY);
  publish({ code: value?.code || "", lastSync: value?.lastSync });
}
function newCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
class ApiError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? "Код недействителен или перевыпущен. Введите актуальный код."
        : status === 429
          ? "Слишком много запросов. Повторим синхронизацию позже."
          : "Сервер синхронизации недоступен. Повторим позже.",
    );
  }
}
async function request(
  path: string,
  code: string,
  method = "GET",
  body?: unknown,
) {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${code}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}
// All tabs serialize sync, code changes, and local clearing via the same lock.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(action: () => Promise<T>): Promise<T> {
  const run = async () => {
    publish({ busy: true });
    try {
      return await action();
    } catch (error) {
      const message = !navigator.onLine
        ? "Нет сети. История сохраняется на устройстве."
        : error instanceof ApiError
          ? error.message
          : error instanceof TypeError ||
              (error instanceof DOMException && error.name === "TimeoutError")
            ? "Сервер недоступен. История сохраняется на устройстве; повторим позже."
            : error instanceof Error
              ? error.message
              : "Не удалось синхронизировать историю.";
      publish({ message });
      throw error;
    } finally {
      publish({ busy: false });
    }
  };
  const next = queue.then(() =>
    navigator.locks ? navigator.locks.request("monitor-sync", run) : run(),
  );
  queue = next.catch(() => {});
  return next;
}
async function recoverRotation(value: Connection) {
  if (!value.pendingCode) return value;
  try {
    await request("vault", value.pendingCode);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    await request("vault/code", value.code, "PUT", { code: value.pendingCode });
  }
  const next = { ...value, code: value.pendingCode, pendingCode: undefined };
  save(next);
  return next;
}
async function exchange() {
  let value = connection();
  publish({ code: value?.code || "", lastSync: value?.lastSync });
  if (!value) {
    publish({ message: "Синхронизация выключена" });
    return;
  }
  if (!navigator.onLine) {
    publish({ message: "Нет сети. История сохраняется на устройстве." });
    return;
  }
  publish({ message: "Синхронизируем историю…" });
  value = await recoverRotation(value);
  // First pairing (or a lost cursor) queues every local id once. After that the
  // outbox is only new writes, and GET continues from the last applied sequence.
  if (value.cursor === undefined) await queuePendingEvents();
  const pending = await readPendingEvents();
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const events = pending.slice(i, i + BATCH_SIZE);
    await request("events", value.code, "PUT", { events });
    await ackPendingEvents(events.map((event) => event.id));
  }
  let cursor = value.cursor ?? 0;
  if (value.cursor === undefined) {
    value = { ...value, cursor: 0 };
    save(value);
  }
  for (;;) {
    const page = await request(`events?after=${cursor}`, value.code);
    if (
      !Array.isArray(page.events) ||
      page.events.length > BATCH_SIZE ||
      !page.events.every(isLogEvent) ||
      !Number.isSafeInteger(page.cursor) ||
      page.cursor < cursor ||
      typeof page.more !== "boolean" ||
      (page.more && page.cursor <= cursor)
    )
      throw new Error("Сервер вернул некорректные события.");
    if (page.events.length) await mergeEvents(page.events);
    cursor = page.cursor;
    value = { ...value, cursor, lastSync: Date.now() };
    save(value);
    if (!page.more) break;
  }
  publish({ message: "История синхронизирована" });
}
let requested = false;
let syncing: Promise<void> | null = null;
export function syncNow(): Promise<void> {
  requested = true;
  if (!syncing)
    syncing = exclusive(async () => {
      do {
        requested = false;
        await exchange();
      } while (requested);
    })
      .catch(() => {})
      .finally(() => {
        syncing = null;
      });
  return syncing;
}
export function enableSync() {
  return exclusive(async () => {
    const code = newCode();
    // Check local persistence before creating a remote vault.
    localStorage.setItem("monitor-sync-check", "1");
    localStorage.removeItem("monitor-sync-check");
    await request("vault", code, "POST", { code });
    save({ code });
    await exchange();
  });
}
export function joinSync(input: string) {
  return exclusive(async () => {
    const code = input.replace(/\s/g, "").toLowerCase();
    if (!CODE_PATTERN.test(code))
      throw new Error("Введите полный код синхронизации из 64 символов.");
    await request("vault", code);
    save({ code });
    await exchange();
  });
}
export function rotateSyncCode() {
  return exclusive(async () => {
    const current = connection();
    if (!current) return;
    const value = await recoverRotation(current);
    // Persist both keys before changing the server: recover even if its response
    // is lost or this tab closes after the server commits the rotation.
    save({ ...value, pendingCode: newCode() });
    await exchange();
  });
}
export function disableSync() {
  return exclusive(async () => {
    save(null);
    publish({ message: "Синхронизация выключена" });
  });
}
export function withSyncPaused(action: () => Promise<void>) {
  return exclusive(action);
}
export function resetDownloadCursor() {
  const value = connection();
  if (value) save({ ...value, cursor: 0 });
}
export function startSync() {
  const trigger = () => {
    void syncNow();
  };
  const visible = () => {
    if (!document.hidden) trigger();
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    try {
      const previous = event.oldValue
        ? (JSON.parse(event.oldValue) as Connection)
        : null;
      const next = event.newValue
        ? (JSON.parse(event.newValue) as Connection)
        : null;
      // A completed exchange updates lastSync in every tab. Do not turn that
      // timestamp into a ping-pong of full exchanges between open tabs.
      if (
        previous?.code !== next?.code ||
        previous?.pendingCode !== next?.pendingCode
      )
        trigger();
      else publish({ lastSync: next?.lastSync });
    } catch {
      trigger();
    }
  };
  window.addEventListener("online", trigger);
  window.addEventListener("offline", trigger);
  window.addEventListener("monitor-local-event", trigger);
  window.addEventListener("storage", storage);
  document.addEventListener("visibilitychange", visible);
  const interval = window.setInterval(visible, 60000);
  trigger();
  return () => {
    clearInterval(interval);
    window.removeEventListener("online", trigger);
    window.removeEventListener("offline", trigger);
    window.removeEventListener("monitor-local-event", trigger);
    window.removeEventListener("storage", storage);
    document.removeEventListener("visibilitychange", visible);
  };
}

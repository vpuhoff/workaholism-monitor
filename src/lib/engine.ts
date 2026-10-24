import type { LogEvent, Phase } from "../../shared/events";
export type { LogEvent, Phase };
export type State =
  | "IDLE"
  | "WORK"
  | "WORK_PAUSED"
  | "OVERTIME"
  | "REST"
  | "REST_VIOLATION"
  | "REST_OVERTIME";
export interface Timing {
  work: number;
  rest: number;
  debounce: number;
  alarm: number;
}
export const DEFAULT_TIMING: Timing = {
  work: 25 * 60_000,
  rest: 5 * 60_000,
  debounce: 10_000,
  alarm: 60_000,
};
export const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export class MonitorEngine {
  state: State = "IDLE";
  workMs = 0;
  restMs = 0;
  face = false;
  private lastAt: number | null = null;
  private absentAt: number | null = null;
  private phaseStart = 0;
  private phaseMs = 0;
  private lastAlarm = 0;
  private sessionId = "";
  private sequence = 0;
  constructor(
    readonly timing = DEFAULT_TIMING,
    private onLog: (event: LogEvent) => void = () => {},
    private onAlarm: () => void = () => {},
  ) {}
  private log(state: Phase, now: number, completed = false) {
    if (this.phaseMs <= 0) return;
    this.onLog({
      id: `${this.sessionId}-${++this.sequence}`,
      session_id: this.sessionId,
      date: dateKey(new Date(this.phaseStart)),
      state,
      time_start: new Date(this.phaseStart).toLocaleTimeString("en-GB", {
        hour12: false,
      }),
      time_end: new Date(now).toLocaleTimeString("en-GB", { hour12: false }),
      started_at: this.phaseStart,
      ended_at: now,
      duration_seconds: this.phaseMs / 1000,
      completed,
    });
    this.phaseMs = 0;
  }
  private enter(state: State, now: number) {
    this.state = state;
    this.phaseStart = now;
    this.phaseMs = 0;
    this.lastAlarm = now;
  }
  private alarm(now: number) {
    this.lastAlarm = now;
    this.onAlarm();
  }
  // A missing camera sample is unknown presence, never evidence of a break.
  suspend(now: number) {
    this.lastAt = now;
    this.absentAt = null;
    this.lastAlarm = now;
  }
  observe(face: boolean, now: number) {
    const delta = this.lastAt === null ? 0 : Math.max(0, now - this.lastAt);
    this.lastAt = now;
    this.face = face;
    if (this.state === "IDLE") {
      if (face) {
        this.sessionId = `${now}-${crypto.randomUUID()}`;
        this.workMs = 0;
        this.restMs = 0;
        this.absentAt = null;
        this.enter("WORK", now);
      }
      return;
    }
    if (this.state === "WORK") {
      if (!face && this.absentAt === null) this.absentAt = now;
      // Account only up to the grace deadline, even if an observation arrives late.
      const allowed =
        this.absentAt === null
          ? delta
          : Math.max(
              0,
              Math.min(
                delta,
                this.absentAt + this.timing.debounce - (now - delta),
              ),
            );
      this.workMs += allowed;
      this.phaseMs += allowed;
      if (face) this.absentAt = null;
      if (this.workMs >= this.timing.work) {
        const excess = this.workMs - this.timing.work;
        this.phaseMs -= excess;
        this.log("WORK", now - excess, true);
        this.enter("OVERTIME", now - excess);
        this.phaseMs = excess;
        this.alarm(now);
        if (!face) {
          this.log("OVERTIME", now);
          this.enter("REST", now);
        }
      } else if (
        this.absentAt !== null &&
        now - this.absentAt > this.timing.debounce
      ) {
        this.state = "WORK_PAUSED";
      }
    } else if (this.state === "WORK_PAUSED") {
      if (this.absentAt !== null && now - this.absentAt >= this.timing.rest) {
        this.log("WORK", now);
        this.enter("IDLE", now);
        this.workMs = 0;
        // A return after a full voluntary break starts a fresh session.
        if (face) this.observe(true, now);
      } else if (face) {
        this.absentAt = null;
        this.state = "WORK";
      } else if (this.absentAt === null) this.absentAt = now;
    } else if (this.state === "OVERTIME") {
      this.workMs += delta;
      this.phaseMs += delta;
      if (!face) {
        this.log("OVERTIME", now);
        this.enter("REST", now);
        this.restMs = 0;
      } else if (now - this.lastAlarm >= this.timing.alarm) this.alarm(now);
    } else if (this.state === "REST") {
      // The elapsed interval belongs to the previously observed absence.
      const used = Math.min(delta, this.timing.rest - this.restMs);
      this.restMs += used;
      this.phaseMs += used;
      if (this.restMs >= this.timing.rest) {
        this.log("REST", now, true);
        this.enter("IDLE", now);
        this.workMs = 0;
        if (face) this.observe(true, now);
      } else if (face) {
        this.log("REST", now);
        this.enter("REST_VIOLATION", now);
      }
    } else if (this.state === "REST_VIOLATION") {
      // A glance under a minute pauses rest. Staying longer becomes overtime.
      if (this.phaseMs + delta > this.timing.alarm) {
        const excess = this.phaseMs + delta - this.timing.alarm;
        this.phaseMs += delta - excess;
        this.log("REST_VIOLATION", now - excess);
        this.enter("REST_OVERTIME", now - excess);
        this.workMs += excess;
        this.phaseMs = excess;
        this.absentAt = face ? null : now;
        if (face && now - this.lastAlarm >= this.timing.alarm) this.alarm(now);
      } else {
        this.phaseMs += delta;
        if (!face) {
          this.log("REST_VIOLATION", now);
          this.enter("REST", now);
        } else if (now - this.lastAlarm >= this.timing.alarm) this.alarm(now);
      }
    } else if (this.state === "REST_OVERTIME") {
      if (!face && this.absentAt === null) this.absentAt = now;
      const allowed =
        this.absentAt === null
          ? delta
          : Math.max(0, Math.min(delta, this.absentAt - (now - delta)));
      this.workMs += allowed;
      this.phaseMs += allowed;
      if (face) this.absentAt = null;
      if (this.absentAt !== null && now - this.absentAt >= this.timing.alarm) {
        this.log("REST_OVERTIME", now);
        this.enter("REST", now);
        this.restMs = 0;
      } else if (face && now - this.lastAlarm >= this.timing.alarm)
        this.alarm(now);
    }
  }
  stop(now: number) {
    if (this.state !== "IDLE")
      this.log(this.state === "WORK_PAUSED" ? "WORK" : this.state, now);
    this.enter("IDLE", now);
    this.workMs = 0;
    this.restMs = 0;
    this.lastAt = null;
    this.absentAt = null;
    this.face = false;
  }
}

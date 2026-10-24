import { describe, expect, it, vi } from "vitest";
import { MonitorEngine, type LogEvent } from "./engine";
const timing = { work: 25_000, rest: 5_000, debounce: 1000, alarm: 6000 };
function setup() {
  const events: LogEvent[] = [];
  const alarm = vi.fn();
  return {
    engine: new MonitorEngine(timing, (e) => events.push(e), alarm),
    events,
    alarm,
  };
}
describe("monitor state machine", () => {
  it("starts only on presence and logs exactly one work phase at the threshold", () => {
    const { engine: e, events, alarm } = setup();
    e.observe(false, 0);
    expect(e.state).toBe("IDLE");
    e.observe(true, 1000);
    e.observe(true, 27000);
    expect(e.state).toBe("OVERTIME");
    expect(e.workMs).toBe(26000);
    expect(events).toHaveLength(1);
    expect(events[0].duration_seconds).toBe(25);
    expect(events[0].completed).toBe(true);
    expect(alarm).toHaveBeenCalledTimes(1);
    e.observe(true, 28000);
    expect(events).toHaveLength(1);
  });
  it("ignores short detection loss then pauses at the grace boundary", () => {
    const { engine: e } = setup();
    e.observe(true, 0);
    e.observe(false, 1000);
    e.observe(false, 2000);
    expect(e.state).toBe("WORK");
    e.observe(false, 2100);
    expect(e.state).toBe("WORK_PAUSED");
    expect(e.workMs).toBe(2000);
    e.observe(true, 3000);
    expect(e.state).toBe("WORK");
    e.observe(true, 4000);
    expect(e.workMs).toBe(3000);
  });
  it("resets after a voluntary five-minute-equivalent absence and records partial work", () => {
    const { engine: e, events } = setup();
    e.observe(true, 0);
    e.observe(false, 3000);
    e.observe(false, 4500);
    e.observe(false, 8000);
    expect(e.state).toBe("IDLE");
    expect(events[0].duration_seconds).toBe(4);
    expect(events[0].completed).toBe(false);
  });
  it("starts a fresh session when the user returns after a full voluntary break", () => {
    const { engine: e, events } = setup();
    e.observe(true, 0);
    e.observe(false, 3000);
    e.observe(false, 4500);
    e.observe(true, 9000);
    expect(e.state).toBe("WORK");
    expect(e.workMs).toBe(0);
    expect(events).toHaveLength(1);
  });
  it("records overtime, repeats alarms once per interval, then rests", () => {
    const { engine: e, events, alarm } = setup();
    e.observe(true, 0);
    e.observe(true, 25000);
    e.observe(true, 30999);
    expect(alarm).toHaveBeenCalledTimes(1);
    e.observe(true, 31000);
    expect(alarm).toHaveBeenCalledTimes(2);
    e.observe(false, 32000);
    expect(e.state).toBe("REST");
    expect(events[1].state).toBe("OVERTIME");
    expect(events[1].duration_seconds).toBe(7);
    e.observe(false, 37000);
    expect(e.state).toBe("IDLE");
    expect(events[2].duration_seconds).toBe(5);
    expect(events[2].completed).toBe(true);
  });
  it("freezes rest during a glance under a minute and resumes without resetting", () => {
    const { engine: e, events, alarm } = setup();
    e.observe(true, 0);
    e.observe(true, 25000);
    e.observe(false, 26000);
    e.observe(true, 28000);
    expect(e.state).toBe("REST_VIOLATION");
    expect(e.restMs).toBe(2000);
    e.observe(false, 33000);
    expect(e.state).toBe("REST");
    expect(e.restMs).toBe(2000);
    expect(alarm).toHaveBeenCalledTimes(1);
    e.observe(false, 36000);
    expect(e.state).toBe("IDLE");
    expect(
      events
        .filter((x) => x.state === "REST")
        .reduce((n, x) => n + x.duration_seconds, 0),
    ).toBe(5);
    expect(
      events.find((x) => x.state === "REST_VIOLATION")?.duration_seconds,
    ).toBe(5);
  });
  it("counts overtime during rest after a minute at the screen and restarts rest only after a minute away", () => {
    const { engine: e, events, alarm } = setup();
    e.observe(true, 0);
    e.observe(true, 25000);
    e.observe(false, 26000);
    e.observe(true, 28000);
    e.observe(true, 34000);
    expect(e.state).toBe("REST_VIOLATION");
    expect(alarm).toHaveBeenCalledTimes(2);
    e.observe(true, 35000);
    expect(e.state).toBe("REST_OVERTIME");
    expect(e.workMs).toBe(27000);
    expect(e.restMs).toBe(2000);
    e.observe(true, 36000);
    expect(e.workMs).toBe(28000);
    e.observe(false, 37000);
    expect(e.state).toBe("REST_OVERTIME");
    expect(e.workMs).toBe(29000);
    e.observe(true, 42000);
    expect(e.state).toBe("REST_OVERTIME");
    expect(e.workMs).toBe(29000);
    e.observe(false, 43000);
    e.observe(false, 48999);
    expect(e.state).toBe("REST_OVERTIME");
    e.observe(false, 49000);
    expect(e.state).toBe("REST");
    expect(e.restMs).toBe(0);
    expect(
      events.find((x) => x.state === "REST_OVERTIME")?.duration_seconds,
    ).toBe(4);
    e.observe(false, 51000);
    expect(e.state).toBe("REST");
    expect(e.restMs).toBe(2000);
    e.observe(false, 54000);
    expect(e.state).toBe("IDLE");
    expect(
      events
        .filter((x) => x.state === "REST" && x.completed)
        .reduce((n, x) => n + x.duration_seconds, 0),
    ).toBe(5);
    expect(alarm.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it("does not count unobserved background time as work or rest", () => {
    const { engine: e } = setup();
    e.observe(true, 0);
    e.observe(true, 1000);
    e.suspend(100000);
    e.observe(true, 100000);
    expect(e.workMs).toBe(1000);
    e.observe(true, 124000);
    e.observe(false, 125000);
    e.suspend(200000);
    e.observe(false, 200000);
    expect(e.restMs).toBe(0);
  });
  it("does not treat suspended absence as a completed voluntary break", () => {
    const { engine: e } = setup();
    e.observe(true, 0);
    e.observe(false, 1000);
    e.observe(false, 2100);
    e.suspend(100000);
    e.observe(false, 100000);
    expect(e.state).toBe("WORK_PAUSED");
    e.observe(true, 101000);
    expect(e.state).toBe("WORK");
  });
  it("records a manual stop only once", () => {
    const { engine: e, events } = setup();
    e.observe(true, 0);
    e.observe(true, 12000);
    e.stop(12000);
    e.stop(12001);
    expect(events).toHaveLength(1);
    expect(events[0].duration_seconds).toBe(12);
    expect(e.state).toBe("IDLE");
  });
  it("does not backfill rest when the work threshold is crossed while absent", () => {
    const { engine: e } = setup();
    e.observe(true, 0);
    e.observe(true, 24500);
    e.observe(false, 25000);
    expect(e.state).toBe("REST");
    expect(e.restMs).toBe(0);
  });
});

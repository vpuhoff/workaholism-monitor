import { ArrowUpRight, Download, Coffee, Clock3, Flame, X } from "lucide-react";
import { dateKey, type LogEvent } from "../lib/engine";
import { exportEvents } from "../lib/storage";
export const minutes = (seconds: number) =>
  seconds < 60 ? `${Math.round(seconds)} с` : `${Math.round(seconds / 60)} мин`;
export function Statistics({
  events,
  full = false,
  onOpen,
  onClose,
}: {
  events: LogEvent[];
  full?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}) {
  const today = events.filter((e) => e.date === dateKey(new Date()));
  const sum = (state: string) =>
    today
      .filter((e) => e.state === state)
      .reduce((a, e) => a + e.duration_seconds, 0);
  const work = sum("WORK"),
    overtime = sum("OVERTIME");
  const rests = new Set(
    today
      .filter((e) => e.state === "REST" && e.completed)
      .map((e) => e.session_id),
  ).size;
  const ratio =
    work + overtime ? Math.round((overtime / (work + overtime)) * 100) : 0;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const entries = events.filter(
      (e) => e.date === dateKey(d) && e.state === "OVERTIME",
    );
    return {
      date: d,
      value:
        entries.reduce((n, e) => n + e.duration_seconds, 0) /
        Math.max(1, entries.length) /
        60,
    };
  });
  const max = Math.max(1, ...days.map((d) => d.value));
  const restSessions = new Set(
    events.filter((e) => e.state === "REST").map((e) => e.session_id),
  );
  const interrupted = new Set(
    events.filter((e) => e.state === "REST_VIOLATION").map((e) => e.session_id),
  );
  const clean = new Set(
    events
      .filter(
        (e) =>
          e.state === "REST" && e.completed && !interrupted.has(e.session_id),
      )
      .map((e) => e.session_id),
  );
  return (
    <section className={full ? "stats full-stats" : "stats"}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">ВАШ РИТМ</span>
          <h2>{full ? "Статистика" : "Сегодня в балансе"}</h2>
        </div>
        {full ? (
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Закрыть статистику"
          >
            <X size={20} />
          </button>
        ) : (
          <button className="text-button" onClick={onOpen}>
            Вся статистика <ArrowUpRight size={16} />
          </button>
        )}
      </div>
      <div className="metrics">
        <article>
          <span>
            <Clock3 size={16} /> Время работы
          </span>
          <strong>{minutes(work)}</strong>
          <small>сохранённое время фокуса</small>
        </article>
        <article>
          <span>
            <Coffee size={16} /> Перерывы
          </span>
          <strong>
            {rests}
            <em> / завершено</em>
          </strong>
          <small>время, которое вы вернули себе</small>
        </article>
        <article>
          <span>
            <Flame size={16} /> Переработка
          </span>
          <strong className={overtime ? "danger-text" : ""}>
            {minutes(overtime)}
          </strong>
          <small>{ratio}% от времени работы</small>
        </article>
      </div>
      {full && (
        <>
          <div className="charts">
            <article className="chart-card">
              <h3>Доля переработок сегодня</h3>
              <div className="ratio-layout">
                <div
                  className="donut"
                  style={{
                    background: `conic-gradient(#ec8176 0 ${ratio}%, #c5f277 ${ratio}% 100%)`,
                  }}
                >
                  <div>
                    <strong>{ratio}%</strong>
                    <span>переработка</span>
                  </div>
                </div>
                <p>
                  <i className="legend green" /> Работа · {minutes(work)}
                  <br />
                  <i className="legend red" /> Переработка · {minutes(overtime)}
                </p>
              </div>
            </article>
            <article className="chart-card">
              <h3>Средняя переработка · 7 дней</h3>
              <svg
                className="trend"
                viewBox="0 0 360 110"
                role="img"
                aria-label={days
                  .map(
                    (d) =>
                      `${d.date.toLocaleDateString("ru-RU")}: ${d.value.toFixed(1)} мин`,
                  )
                  .join("; ")}
              >
                <path
                  d="M15 90H345 M15 50H345 M15 10H345"
                  stroke="#2b302b"
                  fill="none"
                />
                <polyline
                  points={days
                    .map(
                      (d, i) => `${15 + i * 55},${90 - (d.value / max) * 75}`,
                    )
                    .join(" ")}
                  fill="none"
                  stroke="#c5f277"
                  strokeWidth="2"
                />
                {days.map((d, i) => (
                  <circle
                    key={i}
                    cx={15 + i * 55}
                    cy={90 - (d.value / max) * 75}
                    r="3"
                    fill="#c5f277"
                  />
                ))}
              </svg>
              <div className="chart-labels">
                {days.map((d) => (
                  <span key={dateKey(d.date)}>
                    {d.date.toLocaleDateString("ru-RU", { weekday: "short" })}
                  </span>
                ))}
              </div>
              <small>
                Максимум:{" "}
                {max === 1 && days.every((d) => !d.value)
                  ? "0"
                  : max.toFixed(1)}{" "}
                мин
              </small>
            </article>
          </div>
          <div className="chart-card rest-quality">
            <div>
              <h3>Качество отдыха</h3>
              <p>Полные перерывы без возвращения к экрану</p>
            </div>
            <strong>
              {clean.size}
              <span> / {restSessions.size}</span>
            </strong>
            <small>Прерванных: {interrupted.size}</small>
          </div>
          <article className="chart-card">
            <h3>Активность за неделю</h3>
            <p className="muted">Часы начала рабочих фаз · местное время</p>
            <div className="heatmap-wrap">
              <div className="heatmap">
                {days.map((d) => (
                  <div className="heat-row" key={dateKey(d.date)}>
                    <span>
                      {d.date.toLocaleDateString("ru-RU", { weekday: "short" })}
                    </span>
                    {Array.from({ length: 24 }, (_, hour) => {
                      const total = events
                        .filter(
                          (e) =>
                            e.date === dateKey(d.date) &&
                            ["WORK", "OVERTIME"].includes(e.state) &&
                            new Date(e.started_at).getHours() === hour,
                        )
                        .reduce((n, e) => n + e.duration_seconds, 0);
                      return (
                        <div
                          key={hour}
                          title={`${dateKey(d.date)}, ${hour}:00 — ${minutes(total)}`}
                          style={{
                            background: total
                              ? `rgba(197,242,119,${Math.min(1, 0.2 + total / 3600)})`
                              : "#222722",
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
                <div className="heat-labels">
                  <span>00</span>
                  <span>06</span>
                  <span>12</span>
                  <span>18</span>
                  <span>23</span>
                </div>
              </div>
            </div>
          </article>
          <div className="section-heading export">
            <p className="muted">
              {events.length
                ? `Сохранено событий: ${events.length}`
                : "Завершите первую сессию — здесь появятся ваши данные."}
            </p>
            <div>
              <button
                className="secondary small"
                onClick={() => exportEvents(events, "json")}
                disabled={!events.length}
              >
                <Download size={15} /> JSON
              </button>
              <button
                className="secondary small"
                onClick={() => exportEvents(events, "csv")}
                disabled={!events.length}
              >
                <Download size={15} /> CSV
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

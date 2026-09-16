import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUpRight,
  AudioLines,
  Camera as CameraIcon,
  Check,
  CircleHelp,
  Coffee,
  Focus,
  LoaderCircle,
  Maximize,
  Minimize,
  Pause,
  Play,
  ScanFace,
  Settings2,
  ShieldCheck,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { MonitorEngine, DEFAULT_TIMING, type LogEvent } from "./lib/engine";
import { Camera, cameraError } from "./lib/camera";
import {
  clearEvents,
  readEvents,
  readSettings,
  writeEvent,
  type Settings,
} from "./lib/storage";
import { beep, unlockAudio } from "./lib/sound";
import { Statistics } from "./components/Statistics";
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
const timer = (ms: number) => {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
export default function App() {
  const [page, setPage] = useState<"timer" | "stats">("timer");
  const [modal, setModal] = useState<"settings" | "help" | null>(null);
  const [settings, setSettings] = useState(readSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [audioError, setAudioError] = useState("");
  const [fullscreenError, setFullscreenError] = useState("");
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [fullscreenPending, setFullscreenPending] = useState(false);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [debug, setDebug] = useState(
    new URLSearchParams(location.search).has("debug"),
  );
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [, render] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera | null>(null);
  const lastFrame = useRef(0);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const engineRef = useRef<MonitorEngine | null>(null);
  const debugRef = useRef(debug);
  debugRef.current = debug;
  if (!engineRef.current)
    engineRef.current = new MonitorEngine(
      DEFAULT_TIMING,
      (event) => {
        setEvents((previous) => [...previous, event]);
        void writeEvent(event).catch(() =>
          setStorageError(
            "Не удалось сохранить статистику. Экспортируйте данные до закрытия страницы.",
          ),
        );
      },
      () => {
        if (settingsRef.current.sound) beep();
      },
    );
  const engine = engineRef.current;
  const releaseWake = () => {
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  };
  const requestWake = async () => {
    try {
      if ("wakeLock" in navigator && !document.hidden) {
        const lock = await navigator.wakeLock.request("screen");
        if (!cameraRef.current || document.hidden) await lock.release();
        else wakeLock.current = lock;
      }
    } catch {
      /* Optional browser capability. */
    }
  };
  const stop = () => {
    cameraRef.current?.stop();
    cameraRef.current = null;
    releaseWake();
    engine.stop(Date.now());
    setRunning(false);
    setLoading(false);
    render((n) => n + 1);
  };
  useEffect(() => {
    let active = true;
    void readEvents()
      .then((stored) => {
        if (active)
          setEvents((current) => [
            ...new Map([...stored, ...current].map((e) => [e.id, e])).values(),
          ]);
      })
      .catch(() =>
        setStorageError(
          "Локальное хранилище недоступно. Статистика останется только до закрытия страницы.",
        ),
      );
    const onVisibility = () => {
      setHidden(document.hidden);
      engine.suspend(Date.now());
      lastFrame.current = 0;
      if (document.hidden) releaseWake();
      else if (cameraRef.current) void requestWake();
    };
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const onPageHide = () => {
      cameraRef.current?.stop();
      cameraRef.current = null;
      engine.stop(Date.now());
      setRunning(false);
      setLoading(false);
      releaseWake();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      active = false;
      cameraRef.current?.stop();
      releaseWake();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [engine]);
  useEffect(() => {
    const syncFullscreen = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  async function toggleFullscreen() {
    setFullscreenError("");
    setFullscreenPending(true);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setFullscreenError(
        "Браузер не разрешил переключить полноэкранный режим. Попробуйте ещё раз.",
      );
    } finally {
      setFullscreenPending(false);
    }
  }
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);
  async function start() {
    setError("");
    setAudioError("");
    setLoading(true);
    const camera = new Camera(videoRef.current!);
    cameraRef.current = camera;
    // Called synchronously from the click so browsers can unlock audio.
    try {
      await unlockAudio();
    } catch {
      setAudioError(
        "Звук недоступен в этом браузере. Визуальные напоминания продолжат работать.",
      );
    }
    if (cameraRef.current !== camera) return;
    try {
      await camera.start(
        settingsRef.current,
        (face, points) => {
          const now = Date.now();
          if (!lastFrame.current || now - lastFrame.current > 3000)
            engine.suspend(now);
          lastFrame.current = now;
          engine.observe(face, now);
          render((n) => n + 1);
          const canvas = canvasRef.current;
          const context = canvas?.getContext("2d");
          if (debugRef.current && canvas && context) {
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = "#c5f277";
            for (const point of points) {
              context.beginPath();
              context.arc(
                point.x * canvas.width,
                point.y * canvas.height,
                1.2,
                0,
                Math.PI * 2,
              );
              context.fill();
            }
          }
        },
        (message) => {
          setError(message);
          stop();
        },
      );
      if (cameraRef.current !== camera) return;
      setLoading(false);
      setRunning(true);
      void requestWake();
    } catch (err) {
      if (cameraRef.current === camera) {
        setError(cameraError(err));
        stop();
      }
    }
  }
  function updateSettings(next: Settings) {
    setSettings(next);
    try {
      localStorage.setItem("monitor-settings", JSON.stringify(next));
    } catch {
      setStorageError(
        "Настройки не сохраняются между запусками: хранилище браузера недоступно.",
      );
    }
  }
  const state = engine.state;
  const resting = state === "REST" || state === "REST_VIOLATION";
  const overtime = state === "OVERTIME";
  const elapsed = resting ? engine.restMs : engine.workMs;
  const duration = resting ? DEFAULT_TIMING.rest : DEFAULT_TIMING.work;
  const progress = Math.min(1, elapsed / duration);
  const redness = resting
    ? 0
    : Math.max(0, Math.min(1, (engine.workMs - 20 * 60_000) / (5 * 60_000)));
  const badge = !running
    ? "ГОТОВЫ, КОГДА ВЫ ГОТОВЫ"
    : hidden
      ? "НАБЛЮДЕНИЕ ПРИОСТАНОВЛЕНО"
      : {
          IDLE: "ОЖИДАЕМ ВАС",
          WORK: "ВРЕМЯ ФОКУСА",
          WORK_PAUSED: "РАБОТА НА ПАУЗЕ",
          OVERTIME: "ПОРА СДЕЛАТЬ ПЕРЕРЫВ",
          REST: "ВРЕМЯ ДЛЯ СЕБЯ",
          REST_VIOLATION: "ОТДЫХ НА ПАУЗЕ",
        }[state];
  const headline = resting
    ? state === "REST_VIOLATION"
      ? "Экран подождёт."
      : "Вдохните. Отойдите от экрана."
    : overtime
      ? "Вы уже достаточно поработали."
      : "Меньше переработок. Больше жизни.";
  return (
    <div className="app" style={{ "--session-red": redness } as CSSProperties}>
      <header className="header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("timer");
          }}
        >
          <span className="brand-icon">
            <Focus size={23} />
          </span>
          <span>
            workaholism<span className="brand-light"> / monitor</span>
          </span>
        </a>
        <nav aria-label="Основная навигация">
          <button
            className={page === "timer" ? "nav-link active" : "nav-link"}
            onClick={() => setPage("timer")}
          >
            Таймер
          </button>
          <button
            className={page === "stats" ? "nav-link active" : "nav-link"}
            onClick={() => setPage("stats")}
          >
            Статистика
          </button>
        </nav>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label={
              fullscreen
                ? "Выйти из полноэкранного режима"
                : "Развернуть на весь экран"
            }
            aria-pressed={fullscreen}
            title={
              !document.fullscreenEnabled
                ? "Полноэкранный режим не поддерживается браузером"
                : fullscreen
                  ? "Выйти из полноэкранного режима (Esc)"
                  : "Развернуть на весь экран"
            }
            disabled={!document.fullscreenEnabled || fullscreenPending}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
          <button
            className="icon-button"
            aria-label="Настройки"
            onClick={() => setModal("settings")}
          >
            <Settings2 size={20} />
          </button>
        </div>
      </header>
      <main>
        {page === "timer" ? (
          <>
            <div className="intro">
              <span className="eyebrow">РАБОТЕ — ВРЕМЯ. СЕБЕ — ТОЖЕ.</span>
              <h1>{headline}</h1>
              <p>
                {resting
                  ? "Пять минут без экрана помогут вернуться с новыми силами."
                  : "Сосредоточьтесь на важном. О перерывах позаботимся мы."}
              </p>
            </div>
            <section
              className={`timer-card ${resting ? "resting" : ""} ${overtime || state === "REST_VIOLATION" ? "overtime" : ""}`}
              aria-label="Таймер сессии"
            >
              <div className="card-top">
                <span className="status-badge">
                  <i />
                  {badge}
                </span>
                <button
                  className="icon-button sound-button"
                  aria-label={
                    settings.sound ? "Выключить звук" : "Включить звук"
                  }
                  onClick={() => {
                    if (!settings.sound)
                      void unlockAudio().catch(() =>
                        setAudioError("Не удалось включить звук."),
                      );
                    updateSettings({ ...settings, sound: !settings.sound });
                  }}
                >
                  {settings.sound ? (
                    <Volume2 size={19} />
                  ) : (
                    <VolumeX size={19} />
                  )}
                </button>
              </div>
              <div className="timer-center">
                <div className="orbit-icon">
                  {resting ? <Coffee size={22} /> : <Focus size={22} />}
                </div>
                <div
                  className="timer"
                  role="timer"
                  aria-label={resting ? "Осталось отдыхать" : "Время работы"}
                >
                  {running
                    ? timer(resting ? duration - elapsed : elapsed)
                    : "25:00"}
                </div>
                <p className="timer-caption">
                  {!running
                    ? "минут на то, что действительно важно"
                    : hidden
                      ? "Вернитесь на вкладку, чтобы продолжить"
                      : state === "IDLE"
                        ? "Сядьте перед камерой — начнём автоматически"
                        : state === "WORK_PAUSED"
                          ? "Вернитесь, чтобы продолжить"
                          : state === "REST_VIOLATION"
                            ? "Отойдите от экрана, чтобы продолжить отдых"
                            : resting
                              ? "осталось до нового фокуса"
                              : overtime
                                ? `Переработка +${timer(elapsed - duration)}`
                                : "из 25 минут спокойной работы"}
                </p>
                <div className="session-progress">
                  <div className="progress-track">
                    <div style={{ width: `${progress * 100}%` }} />
                  </div>
                  <div className="progress-labels">
                    <span>{resting ? "ОТДЫХ" : "ФОКУС"}</span>
                    <span>{resting ? "05:00" : "25:00"}</span>
                  </div>
                </div>
                <button
                  className={
                    running || loading
                      ? "secondary main-action"
                      : "primary main-action"
                  }
                  onClick={running || loading ? stop : () => void start()}
                >
                  {loading ? (
                    <>
                      <LoaderCircle className="spin" size={18} /> Отменить
                      запуск
                    </>
                  ) : running ? (
                    <>
                      <Square size={15} /> Завершить сессию
                    </>
                  ) : (
                    <>
                      <Play size={17} fill="currentColor" /> Начать работу
                    </>
                  )}
                </button>
                <div className="camera-status">
                  <span
                    className={`status-dot ${running && engine.face && !hidden ? "online" : ""}`}
                  />
                  {loading
                    ? "Подключаем камеру и загружаем модель…"
                    : !running
                      ? "Камера подключится после старта"
                      : hidden
                        ? "Камера на паузе"
                        : engine.face
                          ? "Вы в кадре · мониторинг активен"
                          : "Лица нет в кадре"}
                </div>
              </div>
              <div className="card-bottom">
                <span>
                  <Focus size={15} /> 25 мин фокус
                </span>
                <span className="divider" />
                <span>
                  <Coffee size={15} /> 5 мин отдых
                </span>
                <span className="divider" />
                <span>
                  <ScanFace size={15} /> Автоматически
                </span>
              </div>
            </section>
            <div className="privacy-note">
              <ShieldCheck size={15} />
              <span>
                Камера видит. Никто другой — нет. Все данные остаются на
                устройстве.
              </span>
            </div>
            <Statistics events={events} onOpen={() => setPage("stats")} />
            <section className="how-it-works">
              <div>
                <span className="eyebrow">ПРОСТОЙ РИТМ</span>
                <h2>Вы работаете. Мы следим за временем.</h2>
                <button
                  className="text-button"
                  onClick={() => setModal("help")}
                >
                  Как это работает <ArrowUpRight size={16} />
                </button>
              </div>
              <div className="how-step">
                <span>01</span>
                <CameraIcon size={20} />
                <h3>Будьте в кадре</h3>
                <p>
                  Таймер запускается,
                  <br />
                  когда камера видит вас.
                </p>
              </div>
              <div className="how-step">
                <span>02</span>
                <AudioLines size={20} />
                <h3>Услышьте сигнал</h3>
                <p>
                  Через 25 минут напомним,
                  <br />
                  что пора отдохнуть.
                </p>
              </div>
              <div className="how-step">
                <span>03</span>
                <Coffee size={20} />
                <h3>Отойдите от экрана</h3>
                <p>
                  Пять минут для себя.
                  <br />
                  Без вкладок и уведомлений.
                </p>
              </div>
            </section>
          </>
        ) : (
          <Statistics events={events} full onClose={() => setPage("timer")} />
        )}
        {(error || storageError || audioError || fullscreenError) && (
          <div className="notices" role="alert">
            {error && <p>{error}</p>}
            {storageError && <p>{storageError}</p>}
            {audioError && <p>{audioError}</p>}
            {fullscreenError && <p>{fullscreenError}</p>}
          </div>
        )}
        <div
          className={debug ? "debug-panel" : "camera-hidden"}
          aria-hidden={!debug}
        >
          <div className="debug-title">
            <span>Диагностика камеры · {state}</span>
            <button
              className="icon-button"
              onClick={() => setDebug(false)}
              aria-label="Скрыть диагностику"
            >
              <X size={18} />
            </button>
          </div>
          <div className="camera-preview">
            <video ref={videoRef} muted playsInline />
            <canvas ref={canvasRef} width={640} height={480} />
          </div>
          <p>
            {settings.fps} кадра/с · лицо{" "}
            {engine.face ? "обнаружено" : "не обнаружено"}
          </p>
        </div>
      </main>
      <footer>
        <span className="footer-mark">
          <span className="status-dot online" /> Берегите свой ресурс.
        </span>
        <div>
          {installPrompt && (
            <button
              onClick={async () => {
                await installPrompt.prompt();
                const choice = await installPrompt.userChoice;
                if (choice.outcome === "accepted") setInstallPrompt(null);
              }}
            >
              Установить приложение
            </button>
          )}
          <button onClick={() => setModal("help")}>
            <CircleHelp size={14} /> О приложении
          </button>
          <span>Сделано для баланса</span>
        </div>
      </footer>
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onKeyDown={(e) => {
              if (e.key !== "Tab") return;
              const elements = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]",
                ),
              );
              const first = elements[0],
                last = elements[elements.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last?.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="section-heading">
              <h2 id="modal-title">
                {modal === "settings"
                  ? "Ваши настройки"
                  : "Работа в здоровом ритме"}
              </h2>
              <button
                className="icon-button"
                autoFocus
                onClick={() => setModal(null)}
                aria-label="Закрыть"
              >
                <X size={20} />
              </button>
            </div>
            {modal === "settings" ? (
              <>
                <p className="muted">
                  Параметры камеры применяются к следующей сессии.
                </p>
                {(["detection", "presence", "tracking"] as const).map(
                  (key, i) => (
                    <label className="slider-label" key={key}>
                      <span>
                        {
                          [
                            "Порог обнаружения лица",
                            "Порог присутствия лица",
                            "Порог отслеживания",
                          ][i]
                        }
                        <output>{settings[key].toFixed(1)}</output>
                      </span>
                      <input
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.1"
                        value={settings[key]}
                        onChange={(e) =>
                          updateSettings({
                            ...settings,
                            [key]: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ),
                )}
                <p className="muted small-copy">
                  Меньший порог помогает при слабом освещении; больший уменьшает
                  ложные обнаружения.
                </p>
                <label className="setting-row">
                  Частота обработки
                  <select
                    value={settings.fps}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        fps: Number(e.target.value),
                      })
                    }
                  >
                    {[2, 3, 4, 5].map((fps) => (
                      <option value={fps} key={fps}>
                        {fps} кадра/с
                      </option>
                    ))}
                  </select>
                </label>
                <label className="setting-row">
                  Звуковые напоминания
                  <input
                    type="checkbox"
                    checked={settings.sound}
                    onChange={(e) => {
                      if (e.target.checked) void unlockAudio().catch(() => {});
                      updateSettings({ ...settings, sound: e.target.checked });
                    }}
                  />
                </label>
                <label className="setting-row">
                  Диагностика камеры
                  <input
                    type="checkbox"
                    checked={debug}
                    onChange={(e) => setDebug(e.target.checked)}
                  />
                </label>
                <div className="delete-section">
                  <p className="muted">
                    История хранится только в этом браузере. Экспорт доступен в
                    статистике.
                  </p>
                  <button
                    className="text-button danger-text"
                    disabled={running || loading}
                    onClick={async () => {
                      if (!confirmDelete) {
                        setConfirmDelete(true);
                        return;
                      }
                      try {
                        await clearEvents();
                        setEvents([]);
                        setConfirmDelete(false);
                      } catch {
                        setStorageError("Не удалось очистить историю.");
                      }
                    }}
                  >
                    {confirmDelete
                      ? "Подтвердить удаление всей истории"
                      : "Удалить историю"}
                  </button>
                  {confirmDelete && (
                    <button
                      className="text-button"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Отмена
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="help-item">
                  <Focus />
                  <div>
                    <h3>25 минут для работы</h3>
                    <p>
                      Дайте доступ к камере. Таймер начнёт отсчёт, когда
                      обнаружит лицо. Потери лица до 10 секунд игнорируются,
                      более долгие ставят работу на паузу.
                    </p>
                  </div>
                </div>
                <div className="help-item">
                  <Coffee />
                  <div>
                    <h3>5 минут для себя</h3>
                    <p>
                      После 25 минут прозвучит сигнал. Отойдите от экрана, чтобы
                      начался отдых. Вернётесь раньше — отдых приостановится.
                      При переработке и нарушении отдыха сигнал повторяется раз
                      в минуту.
                    </p>
                  </div>
                </div>
                <div className="help-item">
                  <Pause />
                  <div>
                    <h3>Открытая вкладка — точный учёт</h3>
                    <p>
                      При сворачивании или остановке камеры наблюдение
                      приостанавливается. Браузеры не гарантируют работу камеры
                      с выключенным экраном. Приложение запрашивает удержание
                      экрана включённым, если это поддерживается.
                    </p>
                  </div>
                </div>
                <div className="help-item">
                  <ShieldCheck />
                  <div>
                    <h3>Всё остаётся у вас</h3>
                    <p>
                      Видео не записывается и не отправляется на сервер.
                      Статистика хранится локально. После первой полной загрузки
                      приложение может работать без интернета. Для установки
                      используйте меню браузера → «На главный экран».
                    </p>
                  </div>
                </div>
                <button className="primary" onClick={() => setModal(null)}>
                  <Check size={18} /> Понятно
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

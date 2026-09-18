import { useState, useSyncExternalStore } from "react";
import {
  disableSync,
  enableSync,
  getSyncStatus,
  joinSync,
  rotateSyncCode,
  subscribeSync,
  syncNow,
} from "../lib/sync";
export function SyncSettings() {
  const status = useSyncExternalStore(subscribeSync, getSyncStatus);
  const [input, setInput] = useState("");
  const [show, setShow] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState("");
  const action = (task: () => Promise<unknown>) => {
    setNote("");
    void task().catch(() => {});
  };
  return (
    <section className="sync-settings" aria-labelledby="sync-title">
      <h3 id="sync-title">Синхронизация</h3>
      <p className="muted">
        Общая история на телефоне и компьютере. Передаются только логи сессий.
        Камера, видео и настройки остаются на устройстве.
      </p>
      <p className="muted">
        Кто знает код, может читать и добавлять события. Подключение объединит
        всю локальную историю с общей.
      </p>
      <p role="status" className="sync-status">
        {status.message}
        {status.lastSync && (
          <small>
            Последний обмен: {new Date(status.lastSync).toLocaleString("ru-RU")}
          </small>
        )}
      </p>
      {status.code ? (
        <>
          <div className="sync-actions">
            <button
              className="secondary small"
              disabled={status.busy}
              onClick={() => action(syncNow)}
            >
              Синхронизировать сейчас
            </button>
            <button className="text-button" onClick={() => setShow(!show)}>
              {show ? "Скрыть код" : "Показать код"}
            </button>
          </div>
          {show && (
            <>
              <label className="sync-label">
                Ваш код синхронизации
                <textarea
                  readOnly
                  rows={3}
                  value={status.code}
                  onFocus={(e) => e.target.select()}
                  spellCheck={false}
                />
              </label>
              <button
                className="text-button"
                onClick={() => {
                  void navigator.clipboard.writeText(status.code).then(
                    () => setNote("Код скопирован"),
                    () => setNote("Выделите и скопируйте код вручную."),
                  );
                }}
              >
                Скопировать код
              </button>
            </>
          )}
          {confirm && (
            <p className="muted">
              Старый код перестанет работать на всех устройствах. История на
              сервере сохранится. Новый код нужно ввести на остальных
              устройствах.
            </p>
          )}
          <div className="sync-actions">
            <button
              className="text-button"
              disabled={status.busy}
              onClick={() => {
                if (!confirm) {
                  setConfirm(true);
                  return;
                }
                setConfirm(false);
                setShow(true);
                action(rotateSyncCode);
              }}
            >
              {confirm ? "Подтвердить перевыпуск" : "Перевыпустить код"}
            </button>
            {confirm && (
              <button className="text-button" onClick={() => setConfirm(false)}>
                Отмена
              </button>
            )}
            <button
              className="text-button"
              disabled={status.busy}
              onClick={() => action(disableSync)}
            >
              Отключить на этом устройстве
            </button>
          </div>
          <p className="muted">
            Отключение сохраняет историю и не отзывает код на других
            устройствах.
          </p>
        </>
      ) : (
        <button
          className="secondary small"
          disabled={status.busy}
          onClick={() => {
            setShow(true);
            action(enableSync);
          }}
        >
          Включить синхронизацию
        </button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action(async () => {
            await joinSync(input);
            setInput("");
            setShow(false);
          });
        }}
      >
        <label className="sync-label">
          Код с другого устройства
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
          />
        </label>
        <button
          className="secondary small"
          disabled={status.busy || !input.trim()}
          type="submit"
        >
          Подключить по коду
        </button>
      </form>
      {note && (
        <p className="muted" role="status">
          {note}
        </p>
      )}
    </section>
  );
}

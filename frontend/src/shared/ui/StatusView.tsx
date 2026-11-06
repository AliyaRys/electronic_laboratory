/**
 * Shared acceptance states (UI-03): loading / empty / no-match / not-found /
 * forbidden / blocked / network-error / unknown / no-scope. The state is
 * carried by text + tone — color is never the only carrier — and the technical
 * trace stays available for support as a collapsed detail.
 */
import "./ui.css";
import { Button } from "./Button";

export type StatusState =
  | "loading"
  | "empty"
  | "no-match"
  | "not-found"
  | "forbidden"
  | "blocked"
  | "network-error"
  | "unknown"
  | "no-scope";

interface StatusConfig {
  readonly text: string;
  readonly tone: "neutral" | "positive" | "negative";
  readonly role: "status" | "alert";
}

const STATES: Readonly<Record<StatusState, StatusConfig>> = Object.freeze({
  loading: Object.freeze({ text: "Загрузка…", tone: "neutral", role: "status" }),
  empty: Object.freeze({ text: "Пока ничего нет.", tone: "neutral", role: "status" }),
  "no-match": Object.freeze({ text: "По фильтрам ничего не найдено.", tone: "neutral", role: "status" }),
  "not-found": Object.freeze({ text: "Запись не указана.", tone: "neutral", role: "status" }),
  forbidden: Object.freeze({ text: "Нет доступа к этому разделу.", tone: "negative", role: "alert" }),
  blocked: Object.freeze({ text: "Учётная запись заблокирована.", tone: "negative", role: "alert" }),
  "network-error": Object.freeze({
    text: "Ошибка соединения. Данные не загружены.",
    tone: "negative",
    role: "alert",
  }),
  unknown: Object.freeze({ text: "Состояние операции неизвестно.", tone: "negative", role: "alert" }),
  "no-scope": Object.freeze({
    text: "Выберите лабораторию и тип продукции.",
    tone: "neutral",
    role: "status",
  }),
});

export interface StatusViewProps {
  state: StatusState;
  /** Replaces the default headline (must stay Russian, user-facing). */
  title?: string | undefined;
  /** Short user-facing explanation (e.g. the Problem detail). */
  detail?: string | undefined;
  /** Technical trace/code for support — collapsed by default, never hidden. */
  trace?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** Additional content, e.g. the accessible list of available sections. */
  children?: React.ReactNode | undefined;
}

export function StatusView({
  state,
  title,
  detail,
  trace,
  onRetry,
  children,
}: StatusViewProps): React.ReactElement {
  const config = STATES[state];
  const heading = title ?? config.text;
  return (
    <section
      className={`app-status tone-${config.tone}`}
      role={config.role}
      aria-live={config.role === "status" ? "polite" : "assertive"}
    >
      {state === "loading" ? <span className="app-spinner" aria-hidden="true" /> : null}
      <div>
        <p className="app-status-title">{heading}</p>
        {detail !== undefined && detail !== "" ? <p className="app-status-detail">{detail}</p> : null}
        {trace !== undefined && trace !== "" ? (
          <details className="app-status-trace">
            <summary>Техническая информация для поддержки</summary>
            <pre>{trace}</pre>
          </details>
        ) : null}
        {children}
        {onRetry !== undefined ? (
          <div className="app-dialog-actions" style={{ justifyContent: "flex-start" }}>
            <Button onClick={onRetry} busyLabel="Повторяем…">
              Повторить
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

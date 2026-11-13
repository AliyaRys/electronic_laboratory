/**
 * Shared catalog editor parts (ТЗ-DR6 §8): one implementation for all three
 * editor pages — the editor page shell (eyebrow/heading/section/sticky
 * actions), the role-aware context selector, the price card, the interval
 * norm row, the qualitative block and the honest save summary.
 *
 * Geometry (§8.1): content min(1180px, 100%), page #f5f9f8, white section
 * r18/25px, cards r13, inputs 43px/r9, primary button 43px/r10, sticky
 * actions bar. The numbers live in catalogs.css only.
 */
import { useId } from "react";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";

/* --- Page shell ---------------------------------------------------------- */

export interface CatalogEditorPageProps {
  title: string;
  description: string;
  children: React.ReactNode;
  /** Bottom sticky action bar (Отменить / Сохранить справочник …). */
  actions?: React.ReactNode | undefined;
}

export function CatalogEditorPage({
  title,
  description,
  children,
  actions,
}: CatalogEditorPageProps): React.ReactElement {
  return (
    <div className="vse-app vse-page vse-catalog-page vse-catalog-editor">
      <div className="vse-catalog-title">
        <p className="vse-catalog-eyebrow">Редактирование справочника</p>
        <h1>{title}</h1>
        <p className="vse-catalog-lead">{description}</p>
      </div>
      {children}
      {actions !== undefined ? <div className="vse-catalog-actions">{actions}</div> : null}
    </div>
  );
}

export interface CatalogSectionHeaderProps {
  icon?: string | undefined;
  title: string;
  description: string;
  /** Secondary actions of the section («Добавить тариф», «Добавить норму»). */
  actions?: React.ReactNode | undefined;
}

export function CatalogSectionHeader({
  icon,
  title,
  description,
  actions,
}: CatalogSectionHeaderProps): React.ReactElement {
  return (
    <div className="vse-catalog-section-head vse-catalog-section-head-row">
      <div className="vse-catalog-section-title">
        {icon !== undefined ? (
          <span className="vse-catalog-section-icon" aria-hidden="true">
            <Icon name={icon} />
          </span>
        ) : null}
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {actions !== undefined ? <div className="vse-catalog-section-actions">{actions}</div> : null}
    </div>
  );
}

/* --- Context selector ----------------------------------------------------- */

export interface CatalogContextSelectorProps {
  laboratories: { id: string; name: string }[];
  value: string;
  disabled?: boolean | undefined;
  onChange: (laboratoryId: string) => void;
}

/** The compact laboratory selector of ADMIN/ANALYST (§6.3): allowed set only. */
export function CatalogContextSelector({
  laboratories,
  value,
  disabled = false,
  onChange,
}: CatalogContextSelectorProps): React.ReactElement {
  const id = useId();
  return (
    <div className="vse-catalog-context" data-testid="catalog-context">
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor={id}>Лаборатория</label>
        </div>
        <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          <option value="">— выберите лабораторию —</option>
          {laboratories.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* --- Revision conflict choice ------------------------------------------------- */

export interface ConflictChoiceProps {
  /** The server's current value after the fresh revision was loaded. */
  serverValue: string;
  /** The user's unsent draft value. */
  draftValue: string;
  /** Retry with the fresh revision (If-Match), keeping the user's value. */
  onKeepMine: () => void;
  /** Replace the draft with the server's value; no save is attempted. */
  onTakeServer: () => void;
  disabled?: boolean | undefined;
}

/**
 * The explicit revision-conflict resolution (§12.6): after a 409 the fresh
 * revision is on the card as a read-only comparison and the user chooses —
 * «Сохранить моё значение» retries with the fresh revision, «Взять значение
 * сервера» replaces the draft. A second silent overwrite never happens.
 */
export function ConflictChoice({
  serverValue,
  draftValue,
  onKeepMine,
  onTakeServer,
  disabled = false,
}: ConflictChoiceProps): React.ReactElement {
  return (
    <div className="vse-catalog-conflict" data-testid="catalog-conflict">
      <p className="vse-catalog-conflict-title" role="alert">
        Запись изменена другим пользователем. Выберите, какое значение оставить.
      </p>
      <dl className="vse-catalog-conflict-values">
        <div>
          <dt>Актуальное значение сервера</dt>
          <dd>{serverValue === "" ? "Не настроено" : serverValue}</dd>
        </div>
        <div>
          <dt>Ваше значение</dt>
          <dd>{draftValue === "" ? "Не настроено" : draftValue}</dd>
        </div>
      </dl>
      <div className="vse-catalog-conflict-actions">
        <Button type="button" variant="primary" onClick={onKeepMine} disabled={disabled}>
          Сохранить моё значение
        </Button>
        <Button type="button" variant="secondary" onClick={onTakeServer} disabled={disabled}>
          Взять значение сервера
        </Button>
      </div>
    </div>
  );
}

/* --- Price card ------------------------------------------------------------ */

export interface PriceCardProps {
  name: string;
  /** Draft value; an empty string means «не настроено» when unset is true. */
  value: string;
  onChange: (next: string) => void;
  mandatory?: boolean | undefined;
  /** No tariff record behind the card: the empty field is «Не настроено». */
  unset?: boolean | undefined;
  error?: string | undefined;
  busy?: boolean | undefined;
  readOnly?: boolean | undefined;
  /** Audit fields of a NEW record (unit/source) — collapsed, never demo data. */
  extra?: React.ReactNode | undefined;
  extraSummary?: string | undefined;
  /** Calm secondary action of the card head (e.g. «Удалить», §9.3). */
  secondary?: React.ReactNode | undefined;
  /** Active 409 resolution state (§12.6): server value vs the user's draft. */
  conflict?: { serverValue: string; draftValue: string } | undefined;
  onKeepMine?: (() => void) | undefined;
  onTakeServer?: (() => void) | undefined;
}

/** One decimal price card of the mockup (§9.2/§10.2): name, ₽-suffixed input. */
export function PriceCard({
  name,
  value,
  onChange,
  mandatory = false,
  unset = false,
  error,
  busy = false,
  readOnly = false,
  extra,
  extraSummary = "Данные новой записи",
  secondary,
  conflict,
  onKeepMine,
  onTakeServer,
}: PriceCardProps): React.ReactElement {
  const inputId = useId();
  const errorId = useId();
  return (
    <article className="vse-catalog-card" data-busy={busy ? "true" : undefined}>
      <header className="vse-catalog-card-head">
        <h3>
          {name}
          {mandatory ? (
            <span className="vse-catalog-req" aria-label="обязательное значение">
              {" "}
              *
            </span>
          ) : null}
        </h3>
        {secondary !== undefined ? <div className="vse-catalog-card-secondary">{secondary}</div> : null}
      </header>
      <div className="vse-catalog-price-field">
        <label className="vse-catalog-price-label" htmlFor={inputId}>
          Стоимость
        </label>
        <div className="vse-catalog-price-control">
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            disabled={busy || readOnly}
            aria-invalid={error !== undefined ? "true" : undefined}
            aria-describedby={error !== undefined ? errorId : undefined}
            aria-label={`Стоимость: ${name}, ₽`}
            onChange={(event) => onChange(event.target.value)}
          />
          <span aria-hidden="true">₽</span>
        </div>
        {error !== undefined ? (
          <p className="app-field-message app-field-error" id={errorId} role="alert">
            {error}
          </p>
        ) : null}
        {error === undefined && unset && value === "" ? (
          <p className="vse-catalog-unset">Не настроено</p>
        ) : null}
        {extra !== undefined ? (
          <details className="vse-catalog-details">
            <summary>{extraSummary}</summary>
            {extra}
          </details>
        ) : null}
        {conflict !== undefined && onKeepMine !== undefined && onTakeServer !== undefined ? (
          <ConflictChoice
            serverValue={conflict.serverValue}
            draftValue={conflict.draftValue}
            onKeepMine={onKeepMine}
            onTakeServer={onTakeServer}
            disabled={busy}
          />
        ) : null}
      </div>
    </article>
  );
}

/* --- Norm row --------------------------------------------------------------- */

export interface NormRowProps {
  name: string;
  meta?: string | undefined;
  lower: string;
  upper: string;
  onLowerChange: (next: string) => void;
  onUpperChange: (next: string) => void;
  unit?: string | undefined;
  error?: string | undefined;
  busy?: boolean | undefined;
  readOnly?: boolean | undefined;
  /** Optional business details of the norm (currently boundary inclusivity). */
  details?: React.ReactNode | undefined;
  /** The source of the methodology (§6.1 «источник» column of the row). */
  source?: string | undefined;
  /** Calm secondary action of the row (e.g. «Удалить норму», §11.5). */
  secondary?: React.ReactNode | undefined;
  /** Active 409 resolution state (§12.6): server values vs the user's draft. */
  conflict?: { serverValue: string; draftValue: string } | undefined;
  onKeepMine?: (() => void) | undefined;
  onTakeServer?: (() => void) | undefined;
}

/** One interval row of the norms mockup (§11.2): [name] [от] [до]. */
export function NormRow({
  name,
  meta,
  lower,
  upper,
  onLowerChange,
  onUpperChange,
  unit,
  error,
  busy = false,
  readOnly = false,
  details,
  source,
  secondary,
  conflict,
  onKeepMine,
  onTakeServer,
}: NormRowProps): React.ReactElement {
  const lowerId = useId();
  const upperId = useId();
  const errorId = useId();
  const field = (id: string, label: string, value: string, onChange: (next: string) => void) => (
    <div className={unit !== undefined ? "vse-catalog-field vse-catalog-unit" : "vse-catalog-field"}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        disabled={busy || readOnly}
        aria-label={`${label}: ${name}`}
        onChange={(event) => onChange(event.target.value)}
      />
      {unit !== undefined ? <span aria-hidden="true">{unit}</span> : null}
    </div>
  );
  return (
    <article className="vse-catalog-norm-row" data-busy={busy ? "true" : undefined}>
      <div className="vse-catalog-norm-info">
        <div className="vse-catalog-norm-name">{name}</div>
        {meta !== undefined ? <div className="vse-catalog-norm-meta">{meta}</div> : null}
        {source !== undefined ? <div className="vse-catalog-norm-meta">Источник: {source}</div> : null}
        {error !== undefined ? (
          <p className="app-field-message app-field-error" id={errorId} role="alert">
            {error}
          </p>
        ) : null}
        {details !== undefined ? (
          <details className="vse-catalog-details">
            <summary>Настройка границ</summary>
            {details}
          </details>
        ) : null}
        {conflict !== undefined && onKeepMine !== undefined && onTakeServer !== undefined ? (
          <ConflictChoice
            serverValue={conflict.serverValue}
            draftValue={conflict.draftValue}
            onKeepMine={onKeepMine}
            onTakeServer={onTakeServer}
            disabled={busy}
          />
        ) : null}
        {secondary !== undefined ? <div className="vse-catalog-norm-secondary">{secondary}</div> : null}
      </div>
      {field(lowerId, "Норма от", lower, onLowerChange)}
      {field(upperId, "Норма до", upper, onUpperChange)}
    </article>
  );
}

/* --- Qualitative block -------------------------------------------------------- */

export interface QualitativeRow {
  key: string;
  /** The variant text of the shared indicator registry (never a local copy). */
  value: string;
  /** «Норма» when the value is inside accepted_values, otherwise «Отклонение». */
  norm: boolean;
  onNormChange?: ((norm: boolean) => void) | undefined;
  onRemove?: (() => void) | undefined;
}

export interface QualitativeBlockProps {
  title: string;
  description?: string | undefined;
  rows: QualitativeRow[];
  onAdd?: (() => void) | undefined;
  error?: string | undefined;
  busy?: boolean | undefined;
  readOnly?: boolean | undefined;
  /** Metadata details of the rule (version/source): never lost, only folded. */
  details?: React.ReactNode | undefined;
  /** Calm secondary action of the block (e.g. «Удалить норму», §11.5). */
  secondary?: React.ReactNode | undefined;
}

/** The qualitative norm composition of the mockup (§11.3): rows + «+». */
export function QualitativeBlock({
  title,
  description,
  rows,
  onAdd,
  error,
  busy = false,
  readOnly = false,
  details,
  secondary,
}: QualitativeBlockProps): React.ReactElement {
  return (
    <article className="vse-catalog-qual" data-busy={busy ? "true" : undefined}>
      <div className="vse-catalog-qual-head">
        <div>
          <h2>{title}</h2>
          {description !== undefined ? <p>{description}</p> : null}
        </div>
        {onAdd !== undefined && !readOnly ? (
          <Button type="button" onClick={onAdd} disabled={busy} aria-label="Добавить вариант">
            Добавить вариант
          </Button>
        ) : null}
      </div>
      <div className="vse-catalog-qual-list">
        {rows.map((row) => (
          <div className="vse-catalog-qual-row" key={row.key}>
            <div className="vse-catalog-field">
              <label htmlFor={`qual-value-${row.key}`}>Вариант результата</label>
              <input
                id={`qual-value-${row.key}`}
                type="text"
                value={row.value}
                readOnly
                aria-label={`Вариант результата: ${row.value}`}
              />
            </div>
            <div className="vse-catalog-field">
              <label htmlFor={`qual-norm-${row.key}`}>Оценка</label>
              <select
                id={`qual-norm-${row.key}`}
                value={row.norm ? "norm" : "deviation"}
                disabled={busy || readOnly}
                onChange={(event) => row.onNormChange?.(event.target.value === "norm")}
              >
                <option value="norm">Норма</option>
                <option value="deviation">Отклонение</option>
              </select>
            </div>
            {row.onRemove !== undefined && !readOnly ? (
              <Button
                type="button"
                variant="secondary"
                onClick={row.onRemove}
                disabled={busy}
                aria-label={`Удалить вариант: ${row.value}`}
              >
                Удалить
              </Button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {error !== undefined ? (
        <p className="app-field-message app-field-error" role="alert">
          {error}
        </p>
      ) : null}
      {details !== undefined ? (
        <details className="vse-catalog-details">
          <summary>Методика и версия</summary>
          {details}
        </details>
      ) : null}
      {secondary !== undefined ? <div className="vse-catalog-norm-secondary">{secondary}</div> : null}
    </article>
  );
}

/* --- Save summary ------------------------------------------------------------ */

export interface SaveSummaryProps {
  state: "success" | "partial" | "error";
  /** Main honest result («Сохранено: 2, не удалось: 1»). */
  text: string;
  /** Per-card failure details. */
  details?: string[];
}

/** The honest partial-save result (§12): successes and failures stay visible. */
export function SaveSummary({ state, text, details }: SaveSummaryProps): React.ReactElement {
  const isError = state !== "success";
  return (
    <div
      className={`vse-catalog-summary vse-catalog-summary-${state}`}
      role={isError ? "alert" : "status"}
      aria-live="polite"
      data-testid="catalog-save-summary"
    >
      <strong>{text}</strong>
      {details !== undefined && details.length > 0 ? (
        <ul>
          {details.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

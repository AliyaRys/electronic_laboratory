/**
 * SavedResearchResults (ТЗ DR44 §4.2, Task 5; ТЗ DR55 §5.1): the readonly
 * saved researches of the completed card. Names come ONLY from the canonical
 * INDICATORS registry; an unknown legacy indicator keeps an honest reserve
 * label «Исследование» with the technical code in the additional text and
 * the saved value stays visible, named by the research heading. The verdict
 * is ONLY «Норма»/«Отклонение» — a research without an applicable evaluation
 * (including evaluation_mode NONE) renders no badge and no colour.
 * Values are formatted with the shared string-only decimal formatter.
 */
import { useId } from "react";
import type { ExaminationView, PricingSnapshotView } from "./api";
import { FormSection } from "../../shared/ui/FormSection";
import { formatDecimalDisplay } from "../../shared/lib/domain";
import { INDICATORS } from "./indicators";

/** The typed value formatting of one saved research, shared with stories. */
export function savedResearchValueText(item: {
  kind: string;
  value: unknown;
  otherText?: string | null;
  unit?: string | undefined;
  options?: readonly { value: string; label: string }[] | undefined;
}): string {
  if (item.kind === "BOOLEAN") {
    return item.value === true ? "Не обнаружено" : "Обнаружено";
  }
  if (item.kind === "DOSIMETRY" && typeof item.value === "object" && item.value !== null) {
    const pair = item.value as { first: string; last: string };
    return `${formatDecimalDisplay(pair.first)} / ${formatDecimalDisplay(pair.last)} мкЗв/ч`;
  }
  if (item.kind === "ENUM") {
    const raw = typeof item.value === "string" ? item.value : String(item.value ?? "");
    const option = item.options?.find((entry) => entry.value === raw);
    const label = option?.label ?? raw;
    return (item.otherText ?? "").trim() !== "" ? `Иное (${item.otherText})` : label;
  }
  if (item.kind === "DECIMAL" || item.kind === "INTEGER_NONNEGATIVE") {
    const shown =
      typeof item.value === "string" ? formatDecimalDisplay(item.value) : String(item.value ?? "—");
    return item.unit !== undefined && shown !== "—" ? `${shown} ${item.unit}` : shown;
  }
  return typeof item.value === "string" && item.value.trim() !== "" ? item.value : "—";
}

interface SavedResearchCardProps {
  indicatorId: string;
  kind: string;
  value: unknown;
  otherText: string | null;
  evaluation: PricingSnapshotView["lines"][number]["evaluation"];
  required: boolean;
}

function SavedResearchCard({
  indicatorId,
  kind,
  value,
  otherText,
  evaluation,
  required,
}: SavedResearchCardProps): React.ReactElement {
  const headingId = useId();
  const def = INDICATORS.find((item) => item.id === indicatorId);
  const text = savedResearchValueText({
    kind,
    value,
    otherText,
    unit: def?.unit,
    options: def?.options,
  });
  // ТЗ DR55 §5.1: ONLY the two useful verdicts render a badge — a service
  // status (NOT_APPLICABLE/UNKNOWN), a missing evaluation or a research
  // without a norm at all (evaluation_mode NONE, e.g. бактериоскопия)
  // renders nothing and never colours the card. No hint and no criterion
  // text is ever appended: the norm lives in the catalog, not on the card.
  const mode = (evaluation as { evaluation_mode?: unknown } | null)?.evaluation_mode;
  const status = evaluation?.status;
  const applicable =
    (status === "IN_NORM" || status === "DEVIATION") && mode !== "NONE";
  return (
    <article
      className={`vse-research-view${required ? " vse-research-required" : ""}`}
      data-indicator-id={indicatorId}
      data-evaluation={applicable ? status : undefined}
    >
      <header className="vse-research-head">
        <h4 id={headingId}>
          {def?.name ?? "Исследование"}
          {required ? <span aria-hidden="true"> *</span> : null}
        </h4>
        {def === undefined ? <p className="vse-research-unknown">Код показателя: {indicatorId}</p> : null}
        {applicable ? (
          <span className="vse-research-evaluation" data-evaluation={status}>
            {status === "IN_NORM" ? "Норма" : "Отклонение"}
          </span>
        ) : null}
      </header>
      {/* ТЗ DR55 §5.1 (fix-loop): the visible «Сохранённое значение» label is
          gone; the value is a semantic readonly output named by the research
          heading — long text wraps inside the card instead of clipping in a
          one-line input. */}
      <output className="vse-research-value" aria-labelledby={headingId}>
        {text}
      </output>
    </article>
  );
}

export function SavedResearchResults({ view }: { view: ExaminationView }): React.ReactElement {
  const lines = (view.pricing as { lines?: PricingSnapshotView["lines"] }).lines ?? [];
  const evaluationOf = (indicatorId: string): PricingSnapshotView["lines"][number] | undefined =>
    lines.find((line) => line.service_code === indicatorId);
  const findings = view.invasive_findings as {
    disease: string;
    location?: string | null;
    otherText?: string | null;
  }[];
  const noncontagious = view.noncontagious_findings as { disease: string; otherText?: string | null }[];
  return (
    <FormSection
      icon="exam-research"
      title="Исследования ВСЭ"
      description="Результаты основных и дополнительных исследований ветеринарно-санитарной экспертизы."
    >
      {view.researches.length === 0 ? (
        <p className="vse-exam-note">Результаты не сохранены.</p>
      ) : (
        <div className="vse-research-grid">
          {(view.researches as unknown[]).map((entry, index) => {
            const raw = entry as {
              indicatorId?: string;
              kind?: string;
              value?: unknown;
              otherText?: string | null;
            };
            const indicatorId = String(raw.indicatorId ?? "");
            const item = {
              indicatorId,
              kind: String(raw.kind ?? ""),
              value: raw.value,
              otherText: raw.otherText ?? null,
            };
            const line = evaluationOf(indicatorId);
            const def = INDICATORS.find((entry) => entry.id === indicatorId);
            return (
              <SavedResearchCard
                key={indicatorId || index}
                indicatorId={indicatorId}
                kind={item.kind}
                value={item.value}
                otherText={item.otherText}
                evaluation={line?.evaluation ?? null}
                required={def?.mandatory === true}
              />
            );
          })}
        </div>
      )}
      {findings.length > 0 || noncontagious.length > 0 ? (
        <dl className="vse-exam-facts">
          {findings.map((item, index) => (
            <div key={`invasive-${index}`}>
              <dt>Инвазионная болезнь</dt>
              <dd>{`${item.disease} — ${item.location ?? "—"}${item.otherText ? ` (${item.otherText})` : ""}`}</dd>
            </div>
          ))}
          {noncontagious.map((item, index) => (
            <div key={`noncontagious-${index}`}>
              <dt>Незаразная болезнь</dt>
              <dd>{`${item.disease}${item.otherText ? ` (${item.otherText})` : ""}`}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </FormSection>
  );
}

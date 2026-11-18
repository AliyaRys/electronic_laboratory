/**
 * PricingPreview (DR35 §13/§14): the live server pricing section.
 *
 * The money is NEVER computed client-side: the section asks the non-mutating
 * preview endpoint (the SAME evaluate_and_price function the final save uses)
 * with a 300 ms debounce, cancels stale requests and shows the honest states:
 * skeleton while the first calculation runs, the previous table with a
 * recalculating note, a missing-tariff problem, a network error with a retry
 * and the fair (0 ₽) mode — never a fabricated zero.
 */
import { useEffect, useRef, useState } from "react";
import "../../shared/ui/check-section.css";
import { fetchPricingPreview, type PricingPreviewRequestBody, type PricingSnapshotView } from "./api";
import { SnapshotPricingTable } from "./PricingSnapshotTable";
import type { Problem } from "../../shared/api/problem";
import { StatusView } from "../../shared/ui/StatusView";

/**
 * The Russian wording of one evaluation snapshot (ТЗ DR41-B §7.2): a green
 * verdict is always accompanied by its text, and the neutral statuses keep
 * their own honest wording — UNKNOWN is never repainted as a norm.
 */
export function evaluationLabel(status: string | undefined): string {
  if (status === "IN_NORM") return "Норма";
  if (status === "DEVIATION") return "Отклонение";
  if (status === "NOT_APPLICABLE") return "Оценка по норме не применяется";
  return "Оценка не определена";
}

/** The readable criterion of the applied norm from the method snapshot. */
export function normCriterion(line: { method_snapshot?: { rule?: unknown } | null }): string | null {
  const rule = line.method_snapshot?.rule;
  if (rule === null || rule === undefined || typeof rule !== "object") return null;
  const typed = rule as { type?: string; lower?: string; upper?: string; accepted_values?: string[] };
  if (typed.type === "interval") {
    if (typed.lower === undefined && typed.upper === undefined) return null;
    return `от ${typed.lower ?? "—"} до ${typed.upper ?? "—"}`;
  }
  if (
    typed.type === "qualitative" &&
    Array.isArray(typed.accepted_values) &&
    typed.accepted_values.length > 0
  ) {
    return `норма: ${typed.accepted_values.join(", ")}`;
  }
  return null;
}

function EvaluationBadge({
  line,
}: {
  line: {
    method_snapshot?: { rule?: unknown } | null;
    evaluation?: { status?: string; hint?: string } | null;
  };
}): React.ReactElement {
  const criterion = normCriterion(line);
  const status = line.evaluation?.status;
  const hint = line.evaluation?.hint;
  return (
    <span className="vse-invoice-evaluation" data-evaluation={status ?? "UNKNOWN"}>
      {evaluationLabel(status)}
      {hint ? <span className="vse-invoice-criterion"> · {hint}</span> : null}
      {criterion !== null ? <span className="vse-invoice-criterion"> · {criterion}</span> : null}
    </span>
  );
}

// ТЗ DR47 §2.6: the invoice table keeps exactly four columns, so the
// evaluation badge left the shared renderer; the same evaluation data stays
// in the «Исследования ВСЭ» cards (ResearchFields). The local badge helper is
// unused now and is kept private; the evaluation wording stays in
// ``evaluationLabel`` for those cards. void(EvaluationBadge) keeps the helper
// compiled without an unused-symbol lint error.
void EvaluationBadge;

/** The debounce window of the preview (ТЗ §13.4: 250–400 ms). */
export const PRICING_DEBOUNCE_MS = 300;

export type PricingPreviewState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "recalculating"; snapshot: PricingSnapshotView }
  | { status: "success"; snapshot: PricingSnapshotView }
  | { status: "missing"; problem: Problem }
  | { status: "error"; problem: Problem };

export function usePricingPreview(
  partyId: string,
  request: PricingPreviewRequestBody | null,
): PricingPreviewState {
  const [state, setState] = useState<PricingPreviewState>({ status: "empty" });
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<PricingPreviewRequestBody | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (controllerRef.current !== null) controllerRef.current.abort();
    if (request === null || request.researches.length === 0) {
      requestRef.current = null;
      timerRef.current = setTimeout(() => setState({ status: "empty" }), 0);
      return;
    }
    timerRef.current = setTimeout(() => {
      const controller = new AbortController();
      controllerRef.current = controller;
      requestRef.current = request;
      const requested = request;
      // The skeleton/recalculating switch happens inside the timer (never
      // synchronously within the effect).
      setState((current) =>
        current.status === "success"
          ? { status: "recalculating", snapshot: current.snapshot }
          : { status: "loading" },
      );
      void (async () => {
        const result = await fetchPricingPreview(partyId, requested, controller.signal);
        // A stale response never replaces a newer one.
        if (!mountedRef.current || controllerRef.current !== controller || requestRef.current !== requested) {
          return;
        }
        if ("code" in result) {
          setState(
            result.code === "CONFIGURATION_MISSING"
              ? { status: "missing", problem: result }
              : { status: "error", problem: result },
          );
          return;
        }
        setState({ status: "success", snapshot: result.snapshot });
      })();
    }, PRICING_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [partyId, request]);

  return state;
}

export function PricingSection({
  state,
  disabled,
  onRetry,
}: {
  state: PricingPreviewState;
  disabled: boolean;
  onRetry: () => void;
}): React.ReactElement {
  if (state.status === "empty") {
    return (
      <p className="vse-invoice-pending" aria-live="polite">
        Заполните результат, чтобы добавить исследование в расчёт.
      </p>
    );
  }
  if (state.status === "loading") {
    return (
      <p className="vse-invoice-pending" aria-live="polite">
        Рассчитываем стоимость…
      </p>
    );
  }
  if (state.status === "missing") {
    return (
      <StatusView
        state="forbidden"
        title="Не хватает настройки справочника"
        detail={state.problem.detail}
        trace={state.problem.trace_id !== "" ? `trace_id: ${state.problem.trace_id}` : undefined}
      />
    );
  }
  if (state.status === "error") {
    return (
      <StatusView
        state="network-error"
        title="Не удалось обновить предварительный расчёт"
        detail={state.problem.detail}
        onRetry={disabled ? undefined : onRetry}
      />
    );
  }
  const snapshot = state.snapshot;
  return (
    <div aria-live="polite">
      {state.status === "recalculating" ? <p className="vse-exam-note">Пересчитываем стоимость…</p> : null}
      {/* DR44: one shared snapshot renderer; after the DR43 merge it carries
          the same reconciliation invoice look (vse-rec-invoice-*) and the
          server fair flag as a disabled Ярмарка checkbox. */}
      <SnapshotPricingTable snapshot={snapshot} variant="live-examination" />
    </div>
  );
}

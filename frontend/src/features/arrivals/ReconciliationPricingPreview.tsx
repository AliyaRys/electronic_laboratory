/**
 * ReconciliationPricingPreview (ТЗ DR53 Task 1): the live server pricing of
 * the сверка draft. The money is NEVER computed client-side: the section asks
 * the read-only preview endpoint (the SAME normalize_payload/validate_receipt/
 * _price_check_services path the final save uses), aborts superseded requests
 * and additionally compares the request identity before applying a response.
 * Honest states: the saved snapshot as-is, the stable loading geometry, the
 * previous table with the «Пересчитываем стоимость…» note, a pricing failure
 * (which locks the final save) and the honest empty note of an incomplete
 * draft — never a fabricated zero.
 */
import { useEffect, useRef, useState } from "react";
import { previewReconciliationPricing, moneyLabel } from "./api";
import type { PricingSnapshot, ReconciliationWrite } from "./api";
import type { Problem } from "../../shared/api/problem";
import { StatusView } from "../../shared/ui/StatusView";

export type ReconciliationPricingState =
  | { kind: "saved" }
  | { kind: "loading" }
  | { kind: "recalculating"; snapshot: PricingSnapshot }
  | { kind: "success"; snapshot: PricingSnapshot }
  | { kind: "failed"; problem: Problem }
  | { kind: "incomplete" };

export interface ReconciliationPricingPreviewProps {
  partyId: string;
  /** The canonical draft payload; ``null`` keeps the saved snapshot as-is. */
  payload: ReconciliationWrite | null;
  savedPricing: PricingSnapshot | null | undefined;
  /** Reports the save lock: a non-null string disables «Сохранить сверку». */
  onLockChange: (lock: string | null) => void;
}

const SAVE_PENDING_LOCK = "Идёт пересчёт стоимости — сохранение пока недоступно.";
const SAVE_FAILED_LOCK = "Не удалось пересчитать стоимость — сохранение заблокировано.";

export function ReconciliationPricingPreview({
  partyId,
  payload,
  savedPricing,
  onLockChange,
}: ReconciliationPricingPreviewProps): React.ReactElement {
  const [state, setState] = useState<ReconciliationPricingState>({ kind: "saved" });
  const seqRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const seq = ++seqRef.current;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    if (payload === null) {
      // The draft still matches the saved view: no request, no local state
      // change — the render path shows ``savedPricing`` directly.
      onLockChange(null);
      return () => {
        controller.abort();
      };
    }
    // The pending placeholder is derived state of the started request: the
    // effect synchronously reflects "a request for THIS payload is in flight"
    // before the async continuation settles it (abort/identity guards make
    // superseded responses inert).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((current) =>
      current.kind === "success" || current.kind === "recalculating"
        ? { kind: "recalculating", snapshot: current.snapshot }
        : savedPricing
        ? { kind: "recalculating", snapshot: savedPricing }
        : { kind: "loading" },
    );
    onLockChange(SAVE_PENDING_LOCK);
    void previewReconciliationPricing(partyId, payload, controller.signal).then(
      (result: PricingSnapshot | Problem) => {
        if (seq !== seqRef.current || controller.signal.aborted) {
          return; // A superseded or aborted response is never applied.
        }
        if (result && "code" in result) {
          const problem = result as Problem;
          if (problem.code === "VALIDATION_ERROR") {
            // An incomplete draft: the honest empty note, no fabricated zero
            // and no lock (an incomplete сверка is savable by design).
            setState({ kind: "incomplete" });
            onLockChange(null);
          } else {
            setState({ kind: "failed", problem });
            onLockChange(SAVE_FAILED_LOCK);
          }
        } else {
          setState({ kind: "success", snapshot: result as PricingSnapshot });
          onLockChange(null);
        }
      },
    );
    return () => {
      controller.abort();
    };
  }, [payload, partyId, onLockChange, savedPricing]);

  const snapshot =
    payload === null
      ? savedPricing ?? null
      : state.kind === "success" || state.kind === "recalculating"
        ? state.snapshot
        : null;
  const recalculating = payload !== null && state.kind === "recalculating";
  if (payload === null && savedPricing == null) {
    return (
      <p className="vse-rec-invoice-empty">
        Стоимость будет рассчитана после сохранения и подтверждения сверки.
      </p>
    );
  }
  if (state.kind === "incomplete" || snapshot === null) {
    return (
      <p className="vse-rec-invoice-empty">
        Стоимость будет рассчитана после сохранения и подтверждения сверки.
      </p>
    );
  }
  if (state.kind === "failed") {
    return (
      <StatusView
        state="forbidden"
        title="Не удалось пересчитать стоимость"
        detail={state.problem.detail ?? "Попробуйте ещё раз — сохранение заблокировано до успешного пересчёта."}
      />
    );
  }
  if (snapshot === null) {
    return (
      <div className="vse-rec-invoice-skeleton" aria-hidden="true">
        <div className="vse-rec-invoice-skeleton-row" />
        <div className="vse-rec-invoice-skeleton-row" />
        <div className="vse-rec-invoice-skeleton-row" />
      </div>
    );
  }
  return (
    <div className="vse-rec-invoice-table-wrap">
      {recalculating ? (
        <p className="vse-rec-invoice-recalc" aria-live="polite">
          Пересчитываем стоимость…
        </p>
      ) : null}
      <table className="vse-rec-invoice-table">
        <caption className="vse-visually-hidden">Расчёт стоимости услуг по сверке</caption>
        <thead>
          <tr>
            <th scope="col">Услуга</th>
            <th scope="col">Количество</th>
            <th scope="col">Тариф</th>
            <th scope="col">Сумма</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.lines.map((line) => (
            <tr key={line.service_code}>
              <td>{line.name}</td>
              <td>{line.quantity}</td>
              <td>{moneyLabel(line.unit_price)}</td>
              <td>{moneyLabel(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="vse-rec-invoice-total">
        <span>Итого</span>
        {/* The total is the SERVER value; the client never computes it. */}
        <strong>{moneyLabel(snapshot.total)}</strong>
      </p>
    </div>
  );
}

/**
 * SnapshotPricingTable (ТЗ DR44 Task 5 Step 4, ТЗ DR46 §3.4): the ONE renderer
 * of a frozen pricing snapshot. No requests, no recalculation: the value
 * travels exactly as the server froze it.
 *
 * Variants (a named API of the shared renderer — never a CSS-hiding trick and
 * never a screen-local copy of the table):
 * - ``live`` (default): the reconciliation preview markup — six columns with
 *   «Единица» and «Оценка» plus the ``tfoot`` total. Unchanged by DR46.
 * - ``saved-examination``: the readonly saved card view — exactly four
 *   columns (Исследование/Количество/Тариф/Сумма), no ``tfoot``; the total is
 *   rendered as ``p.vse-rec-invoice-total`` right after the table.
 *
 * DR43: the Ярмарка checkbox reflects the SERVER fair flag as a disabled
 * state — never a fabricated zero, never a manual switch.
 */
import type { PricingSnapshotView } from "./api";
import { moneyLabel, pricingUnitLabel } from "../arrivals/api";
import { formatDecimalDisplay } from "../../shared/lib/domain";
import { EvaluationBadge } from "./PricingPreview";

export type PricingTableVariant = "live" | "saved-examination";

export function SnapshotPricingTable({
  snapshot,
  variant = "live",
}: {
  snapshot: PricingSnapshotView;
  variant?: PricingTableVariant | undefined;
}): React.ReactElement {
  const saved = variant === "saved-examination";
  return (
    <div className="vse-rec-invoice-table-wrap">
      <table className="vse-invoice-table vse-rec-invoice-table">
        <caption className="vse-visually-hidden">
          {saved ? "Расчёт стоимости услуг сохранённой карточки" : "Расчёт стоимости услуг по сверке"}
        </caption>
        <thead>
          <tr>
            <th scope="col">Исследование</th>
            <th scope="col">Количество</th>
            {!saved ? <th scope="col">Единица</th> : null}
            <th scope="col">Тариф</th>
            <th scope="col">Сумма</th>
            {!saved ? <th scope="col">Оценка</th> : null}
          </tr>
        </thead>
        <tbody>
          {snapshot.lines.map((line) => (
            <tr key={line.service_code}>
              <td>{line.name}</td>
              <td>{formatDecimalDisplay(line.quantity)}</td>
              {!saved ? <td>{pricingUnitLabel(line.unit_id)}</td> : null}
              <td>{moneyLabel(line.unit_price)}</td>
              <td>{moneyLabel(line.amount)}</td>
              {!saved ? (
                <td>
                  {/* ТЗ DR42 §4.3: the applied norm and the evaluation snapshot
                      travel with the line; the verdict is never repainted by the
                      browser and never invents an outcome. */}
                  <EvaluationBadge line={line} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
        {/* ТЗ DR46 §3.4: the readonly variant drops ``tfoot`` — the total is
            the ``p.vse-rec-invoice-total`` row below the table, like the
            reconciliation screen. The live variant keeps the footer. */}
        {!saved ? (
          <tfoot>
            <tr>
              <th scope="row" colSpan={5}>
                Итого к оплате
              </th>
              {/* The total is the server value; the client never computes it. */}
              <td>{moneyLabel(snapshot.total)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
      {saved ? (
        <p className="vse-rec-invoice-total">
          <span>Итого</span>
          <strong>{moneyLabel(snapshot.total)}</strong>
        </p>
      ) : null}
      {/* The fair flag belongs to the party's reconciliation step; the card
          only reflects the SERVER state — the browser never fakes a zero and
          never switches the mode (DR43). */}
      <label className="vse-rec-invoice-waiver" data-testid="pricing-waiver">
        <input type="checkbox" checked={snapshot.fair} disabled readOnly aria-label="Ярмарка" />
        <span>
          <span className="vse-rec-invoice-waiver-title">Ярмарка</span>
          <span className="vse-rec-invoice-waiver-note">
            Сверка данных и ВСЭ по этой партии проводятся без оплаты.
          </span>
        </span>
      </label>
    </div>
  );
}

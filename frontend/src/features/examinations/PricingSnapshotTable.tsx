/**
 * SnapshotPricingTable (ТЗ DR44 Task 5 Step 4, ТЗ DR46 §3.4, ТЗ DR47 §2.6):
 * the ONE renderer of a frozen pricing snapshot. No requests, no
 * recalculation: the value travels exactly as the server froze it.
 *
 * Named variants (a named API of the shared renderer — never a CSS-hiding
 * trick and never a screen-local copy of the table):
 * - ``live-examination`` (default): the examination create/edit form —
 *   exactly four columns (Исследование/Количество/Тариф/Сумма), no
 *   ``tfoot``; the total is the ``p.vse-rec-invoice-total`` row below the
 *   table; the readonly Ярмарка indicator stays (DR43).
 * - ``saved-examination``: the readonly saved card view — the same four
 *   columns and the same external total, but the Ярмарка element is never
 *   rendered (ТЗ DR47 §2.1).
 */
import type { PricingSnapshotView } from "./api";
import { moneyLabel } from "../arrivals/api";
import { formatDecimalDisplay } from "../../shared/lib/domain";

export type PricingTableVariant = "live-examination" | "saved-examination";

export function SnapshotPricingTable({
  snapshot,
  variant = "live-examination",
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
            <th scope="col">Тариф</th>
            <th scope="col">Сумма</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.lines.map((line) => (
            <tr key={line.service_code}>
              <td>{line.name}</td>
              <td>{formatDecimalDisplay(line.quantity)}</td>
              <td>{moneyLabel(line.unit_price)}</td>
              <td>{moneyLabel(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* ТЗ DR46 §3.4 / DR47 §2.6: the total is the ``p.vse-rec-invoice-total``
          row below the table for BOTH variants — never a ``tfoot``, never a
          client recomputation. */}
      <p className="vse-rec-invoice-total">
        <span>Итого</span>
        <strong>{moneyLabel(snapshot.total)}</strong>
      </p>
      {saved ? null : (
        /* The fair flag belongs to the party's reconciliation step; on the
           live form the readonly indicator explains why the server returned
           a zero (DR43). The SAVED card never renders it (ТЗ DR47 §2.1). */
        <label className="vse-rec-invoice-waiver" data-testid="pricing-waiver">
          <input type="checkbox" checked={snapshot.fair} disabled readOnly aria-label="Ярмарка" />
          <span>
            <span className="vse-rec-invoice-waiver-title">Ярмарка</span>
            <span className="vse-rec-invoice-waiver-note">
              Сверка данных и ВСЭ по этой партии проводятся без оплаты.
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

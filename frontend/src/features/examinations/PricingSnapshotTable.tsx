/**
 * SnapshotPricingTable (ТЗ DR44 Task 5 Step 4): the ONE renderer of a frozen
 * pricing snapshot — the same row/ money/ evaluation markup the live preview
 * and the readonly card view show. No requests, no recalculation: the value
 * travels exactly as the server froze it.
 *
 * DR43 merge: the frozen table keeps the reconciliation invoice look of the
 * live pricing section (vse-rec-invoice-* classes of check-section.css), the
 * visually-hidden caption, and the Ярмарка checkbox reflects the SERVER fair
 * flag as a disabled state — never a fabricated zero, never a manual switch.
 */
import type { PricingSnapshotView } from "./api";
import { moneyLabel, pricingUnitLabel } from "../arrivals/api";
import { formatDecimalDisplay } from "../../shared/lib/domain";
import { EvaluationBadge } from "./PricingPreview";

export function SnapshotPricingTable({ snapshot }: { snapshot: PricingSnapshotView }): React.ReactElement {
  return (
    <div className="vse-rec-invoice-table-wrap">
      <table className="vse-invoice-table vse-rec-invoice-table">
        <caption className="vse-visually-hidden">Расчёт стоимости услуг по сверке</caption>
        <thead>
          <tr>
            <th scope="col">Исследование</th>
            <th scope="col">Количество</th>
            <th scope="col">Единица</th>
            <th scope="col">Тариф</th>
            <th scope="col">Сумма</th>
            <th scope="col">Оценка</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.lines.map((line) => (
            <tr key={line.service_code}>
              <td>{line.name}</td>
              <td>{formatDecimalDisplay(line.quantity)}</td>
              <td>{pricingUnitLabel(line.unit_id)}</td>
              <td>{moneyLabel(line.unit_price)}</td>
              <td>{moneyLabel(line.amount)}</td>
              {/* ТЗ DR42 §4.3: the applied norm and the evaluation snapshot
                  travel with the line; the verdict is never repainted by the
                  browser and never invents an outcome. */}
              <td>
                <EvaluationBadge line={line} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={5}>
              Итого к оплате
            </th>
            {/* The total is the server value; the client never computes it. */}
            <td>{moneyLabel(snapshot.total)}</td>
          </tr>
        </tfoot>
      </table>
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

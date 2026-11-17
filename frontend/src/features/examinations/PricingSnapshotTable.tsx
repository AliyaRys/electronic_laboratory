/**
 * SnapshotPricingTable (ТЗ DR44 Task 5 Step 4): the ONE renderer of a frozen
 * pricing snapshot — the same row/ money/ evaluation markup the live preview
 * and the readonly card view show. No requests, no recalculation: the value
 * travels exactly as the server froze it.
 */
import type { PricingSnapshotView } from "./api";
import { moneyLabel, pricingUnitLabel } from "../arrivals/api";
import { formatDecimalDisplay } from "../../shared/lib/domain";
import { EvaluationBadge } from "./PricingPreview";

export function SnapshotPricingTable({ snapshot }: { snapshot: PricingSnapshotView }): React.ReactElement {
  return (
    <div>
      <table className="vse-invoice-table">
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
            <td>{moneyLabel(snapshot.total)}</td>
          </tr>
        </tfoot>
      </table>
      {snapshot.fair ? (
        <p className="vse-exam-note">
          Ярмарка: строки и итог — 0 ₽; факт выполненных исследований сохраняется.
        </p>
      ) : null}
    </div>
  );
}

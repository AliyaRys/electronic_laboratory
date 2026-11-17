/**
 * SavedPricingTable (ТЗ DR44 §4.2/§6, Task 5): the readonly section «Расчёт
 * стоимости услуг» of the completed card — the frozen pricing snapshot via
 * the SHARED SnapshotPricingTable renderer. No requests, no live preview, no
 * recalculation; a missing snapshot renders an honest absence and a saved
 * zero stays data.
 */
import type { PricingSnapshotView } from "./api";
import { FormSection } from "../../shared/ui/FormSection";
import { SnapshotPricingTable } from "./PricingSnapshotTable";

export function SavedPricingTable({
  snapshot,
}: {
  snapshot: PricingSnapshotView | null;
}): React.ReactElement {
  return (
    <FormSection
      icon="check-invoice"
      title="Расчёт стоимости услуг"
      description="Сохранённый расчёт по замороженным тарифам на момент сохранения карточки."
    >
      {snapshot === null ? (
        <p className="vse-exam-note">Расчёт стоимости не сохранён.</p>
      ) : (
        <div className="vse-invoice-scroll">
          <SnapshotPricingTable snapshot={snapshot} />
        </div>
      )}
    </FormSection>
  );
}

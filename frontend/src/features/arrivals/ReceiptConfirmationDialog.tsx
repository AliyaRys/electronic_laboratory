import { Dialog } from "../../shared/ui/Dialog";
import {
  decisionLabel,
  documentFacts,
  type IncomingView,
  type ReceiptPreview,
  type ReconciliationView,
} from "./api";

export interface ReceiptConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  party: IncomingView;
  reconciliation: ReconciliationView;
  preview: ReceiptPreview | null;
  busy: boolean;
  error?: string | undefined;
  onConfirm: () => void;
}

/** The different consequence texts of the three decisions (spec §10). */
function decisionNote(decision: string | null): string {
  if (decision === "ACCEPT_ALL") {
    return "После гашения партия будет принята полностью. Возвратный эВСД не формируется. Действие нельзя отменить или безопасно повторить.";
  }
  if (decision === "PARTIAL") {
    return "Принятая часть партии будет погашена; непринятая часть оформляется к возврату отправителю. Действие нельзя отменить или безопасно повторить.";
  }
  if (decision === "RETURN_ALL") {
    return "Вся партия будет возвращена отправителю; потребуется возвратный транспортный эВСД. Действие нельзя отменить или безопасно повторить.";
  }
  return "После отправки в ВетИС действие нельзя отменить или безопасно повторить. Проверьте решение и объёмы.";
}

export function ReceiptConfirmationDialog({
  open,
  onOpenChange,
  party,
  reconciliation,
  preview,
  busy,
  error,
  onConfirm,
}: ReceiptConfirmationDialogProps): React.ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Подтвердите гашение эВСД"
      description={decisionNote(reconciliation.decision)}
      confirmLabel="Погасить эВСД"
      cancelLabel="Вернуться к проверке"
      danger
      busy={busy}
      error={error}
      onConfirm={preview === null ? undefined : onConfirm}
    >
      <dl className="vse-receipt-summary">
        <div>
          <dt>эВСД</dt>
          <dd>{documentFacts(party)[0].value}</dd>
        </div>
        <div>
          <dt>Решение</dt>
          <dd>{decisionLabel(reconciliation.decision)}</dd>
        </div>
        <div>
          <dt>Принято</dt>
          <dd>
            {reconciliation.accepted.quantity} ед.; {reconciliation.accepted.mass_kg} кг
          </dd>
        </div>
        <div>
          <dt>Возвращается</dt>
          <dd>
            {reconciliation.returned.quantity} ед.; {reconciliation.returned.mass_kg} кг
          </dd>
        </div>
        <div>
          <dt>Отпечаток подготовленного запроса</dt>
          <dd className="vse-receipt-fingerprint">{preview?.fingerprint ?? "—"}</dd>
        </div>
      </dl>
    </Dialog>
  );
}

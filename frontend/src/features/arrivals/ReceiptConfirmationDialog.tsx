import { Dialog } from "../../shared/ui/Dialog";
import { decisionLabel, type IncomingView, type ReceiptPreview, type ReconciliationView } from "./api";

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
      description="После отправки в ВетИС действие нельзя отменить или безопасно повторить. Проверьте решение и объёмы."
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
          <dd>{party.external.fields.documentNumber ?? "—"}</dd>
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

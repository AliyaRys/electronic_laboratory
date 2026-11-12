import { Dialog } from "../../shared/ui/Dialog";
import {
  decisionLabel,
  documentFacts,
  formatRuDateTime,
  partyUnit,
  returnReasonLabel,
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
          <dt>Ревизия источника / сверки</dt>
          <dd>
            {preview?.intent.source_revision ?? "—"} / {preview?.intent.reconciliation_revision ?? "—"}{" "}
            (контрольная сумма закреплена)
          </dd>
        </div>
        <div>
          <dt>Принято</dt>
          <dd>
            {reconciliation.accepted.mass_kg} кг; {reconciliation.accepted.quantity} мест
          </dd>
        </div>
        <div>
          <dt>Возвращается</dt>
          <dd>
            {reconciliation.returned.mass_kg} кг; {reconciliation.returned.quantity} мест
          </dd>
        </div>
        <div>
          <dt>Единица измерения (из эВСД)</dt>
          <dd>{preview?.intent.unit_id ? partyUnit(party) || "—" : "—"}</dd>
        </div>
        <div>
          <dt>Дата поступления</dt>
          <dd>{preview ? formatRuDateTime(preview.intent.delivery_date) : "—"}</dd>
        </div>
        {preview?.intent.return_date ? (
          <div>
            <dt>Дата возврата</dt>
            <dd>{formatRuDateTime(preview.intent.return_date)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Осмотры</dt>
          <dd>
            документарный: {preview?.intent.doc_inspection ?? "—"}; ветеринарный:{" "}
            {preview?.intent.vet_inspection ?? "—"}
          </dd>
        </div>
        {reconciliation.return_reason != null ? (
          <div>
            <dt>Причина возврата</dt>
            <dd>
              {returnReasonLabel(reconciliation.return_reason.code)}
              {reconciliation.return_reason.text ? ` — ${reconciliation.return_reason.text}` : ""}
            </dd>
          </div>
        ) : null}
        {preview !== null && (preview.intent.discrepancy_items?.length ?? 0) > 0 ? (
          <div>
            <dt>Акт несоответствия</dt>
            <dd>{preview.intent.discrepancy_items?.length ?? 0} расхождений передано в отчёт</dd>
          </div>
        ) : null}
        <div>
          <dt>Маршрут после гашения</dt>
          <dd>
            {reconciliation.route === "EXAMINATION"
              ? "ВСЭ"
              : reconciliation.route === "CONCLUSION"
                ? "Заключение"
                : "Без продолжения"}
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

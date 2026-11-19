/**
 * ReconciliationActions (A02): the sticky bottom action panel of the approved
 * mockup — «Отмена» (back to arrivals with the dirty-leave protection), «Все
 * соответствует» (only the genuinely compared fields) and the draft save.
 * The legally significant «Погасить» never lives here: it belongs to the
 * ReceiptOperation preview → confirm scenario (W03).
 */
import "./reconciliation.css";
import { Link } from "react-router";
import { Button } from "../../shared/ui/Button";

export interface ReconciliationActionsProps {
  laboratoryId: string;
  busy: boolean;
  complete: boolean;
  /** ТЗ DR53 Task 1: a non-null pricing-preview lock disables the save with
   * an honest explanation (the preview of the current draft is pending or
   * failed — the user never confirms a sum of another fair state). */
  saveLock?: string | undefined;
  /** The currently chosen decision label, when one is selected. */
  chosenDecision?: string | undefined;
  /** Whether the party has at least one compared field to mark. */
  canMarkAll: boolean;
  onMarkAll: () => void;
}

export function ReconciliationActions({
  laboratoryId,
  busy,
  complete,
  saveLock,
  chosenDecision,
  canMarkAll,
  onMarkAll,
}: ReconciliationActionsProps): React.ReactElement {
  const locked = saveLock !== undefined;
  return (
    <div className="vse-rec-actions">
      <span className="vse-rec-actions-note">
        {saveLock !== undefined
          ? saveLock
          : complete
          ? "Сверка заполнена полностью; отправка приёмки — следующим шагом."
          : `Начатая сверка сохраняется и может быть неполной${
              chosenDecision !== undefined && chosenDecision !== "" ? `; выбрано: ${chosenDecision}` : ""
            }.`}
      </span>
      <Link className="app-button" to={`/labs/${laboratoryId}/arrivals`}>
        Отмена
      </Link>
      {canMarkAll ? (
        <Button type="button" variant="secondary" icon="check-complete" onClick={onMarkAll}>
          Все соответствует
        </Button>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        disabled={busy || locked}
        busy={busy}
        busyLabel="Сохранение…"
      >
        Сохранить сверку
      </Button>
    </div>
  );
}

/**
 * DeleteDialog (FT-VSE-12, E03/E04): the examination deletion confirmation.
 *
 * The dialog explains irreversibility and what survives the deletion (the
 * external documents, the physical sample facts and the reports of other
 * tasks), keeps the safe cancel focused first (Dialog contract) and never
 * silently resends after a conflict: a 409 shows the problem and refreshes
 * the actual card state through the bound query.
 */
import { useState } from "react";
import { useCommand } from "../../shared/api/command";
import { problemFromParsed } from "../../shared/api/problem";
import { Dialog } from "../../shared/ui/Dialog";
import { StatusView } from "../../shared/ui/StatusView";
import { deleteExamination, examinationKey, type CommandStateView, type ExaminationView } from "./api";

export interface DeleteDialogProps {
  view: ExaminationView;
  open: boolean;
  onClose: () => void;
  /** Called after a confirmed 204 deletion (the caller navigates away). */
  onDeleted: () => void;
}

export function DeleteDialog({ view, open, onClose, onDeleted }: DeleteDialogProps): React.ReactElement {
  const command = useCommand<CommandStateView | undefined>();
  const [detail, setDetail] = useState("");
  const [stale, setStale] = useState(false);
  const [uncertain, setUncertain] = useState<CommandStateView | null>(null);
  const busy = command.status === "pending";

  const confirm = (): void => {
    if (uncertain !== null) {
      onClose();
      return;
    }
    setDetail("");
    void (async () => {
      let deleted = false;
      let conflict = false;
      let problemDetail = "";
      await command.submit(
        async (ctx) => {
          const result = await deleteExamination(view.id, `"${view.revision}"`)(ctx);
          if (result.response.status === 204) {
            deleted = true;
          } else if (result.response.status === 202 && result.data !== undefined) {
            setUncertain(result.data);
          } else {
            const problem = problemFromParsed((result as { error?: unknown }).error, result.response.status);
            problemDetail = problem.detail;
            conflict = problem.code === "REVISION_CONFLICT" || problem.code === "STATE_CONFLICT";
          }
          return result;
        },
        { queryKey: examinationKey(view.id) },
      );
      if (deleted) {
        await command.refresh();
        onDeleted();
        onClose();
        return;
      }
      if (conflict) {
        setStale(true);
        setDetail(problemDetail);
        await command.refresh();
        return;
      }
      setDetail(problemDetail !== "" ? problemDetail : "Ошибка сети.");
    })();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title="Удалить запись ВСЭ"
      confirmLabel={uncertain !== null ? "Закрыть" : stale ? "Подтвердить удаление заново" : "Удалить"}
      cancelLabel="Отмена"
      danger
      busy={busy}
      error={uncertain === null ? detail : undefined}
      onConfirm={confirm}
    >
      <p className="vse-exam-note">
        Удаление необратимо: карточка ВСЭ, её результаты и расчёт стоимости будут потеряны.
      </p>
      <p className="vse-exam-note">
        Внешние документы, физические факты отбора проб и отчёты сохраняются; номер «{view.number}» можно
        использовать снова для повторной ВСЭ.
      </p>
      {stale ? (
        <StatusView
          state="unknown"
          title="Карточка изменена другим пользователем."
          detail="Актуальное состояние обновлено. Прежнее подтверждение не применено."
        />
      ) : null}
      {uncertain !== null ? (
        <StatusView
          state="unknown"
          title="Удаление принято, но ещё не подтверждено."
          detail="Система не получила подтверждение записи в резервную копию. Не создавайте ВСЭ с тем же номером, пока состояние операции не будет проверено."
          trace={`Операция: ${uncertain.id}\nПроверка: /api/v1/operations/${uncertain.id}`}
        />
      ) : null}
    </Dialog>
  );
}

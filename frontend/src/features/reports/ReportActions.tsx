/**
 * ReportActions (R03, API-08, FT-DOC-05): export and print of one SAVED
 * report. Exports always fetch the saved snapshot's rendered file — the same
 * GET on retry can never see a different snapshot (AT-18: a deleted or
 * corrected source does not change an already-saved report). The delete
 * dialog explains period/lab scope and irreversibility (no restore).
 */
import "./reports.css";
import { useState } from "react";
import { useCommand } from "../../shared/api/command";
import { problemFromParsed, type Problem } from "../../shared/api/problem";
import { Dialog } from "../../shared/ui/Dialog";
import { Button } from "../../shared/ui/Button";
import { deleteReport, fetchReportFile, type ReportSnapshotView } from "./api";

type ActionsState = { kind: "idle" } | { kind: "busy"; target: string } | { kind: "error"; problem: Problem };

function openBlob(blob: Blob, mode: "download" | "print", fileName: string): void {
  const url = URL.createObjectURL(blob);
  if (mode === "print") {
    const frame = window.open(url, "_blank");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (frame === null) {
      triggerDownload(url, fileName);
    }
    return;
  }
  triggerDownload(url, fileName);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function triggerDownload(url: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export interface ReportActionsProps {
  view: ReportSnapshotView;
  /** Called after a confirmed 204 deletion (the caller corrects the list page). */
  onDeleted: () => void;
}

export function ReportActions({ view, onDeleted }: ReportActionsProps): React.ReactElement {
  const [state, setState] = useState<ActionsState>({ kind: "idle" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detail, setDetail] = useState("");
  const command = useCommand<undefined>();
  const busy = command.status === "pending" || state.kind === "busy";

  const runExport = async (kind: "pdf" | "xlsx", mode: "download" | "print"): Promise<void> => {
    setState({ kind: "busy", target: kind });
    const result = await fetchReportFile(view.id, kind);
    if ("problem" in result) {
      setState({ kind: "error", problem: result.problem });
      return;
    }
    setState({ kind: "idle" });
    openBlob(result.blob, mode, result.filename || `5-вет_${view.year}_${view.half}.${kind}`);
  };

  const confirmDelete = (): void => {
    setDetail("");
    void (async () => {
      let deleted = false;
      let problemDetail = "";
      await command.submit(
        async (ctx) => {
          const result = await deleteReport(view.id, `"${view.rev}"`)(ctx);
          if (result.response.status === 204) {
            deleted = true;
          } else {
            problemDetail = problemFromParsed(
              (result as { error?: unknown }).error,
              result.response.status,
            ).detail;
          }
          return result;
        },
        { queryKey: ["reports", "saved", view.id] },
      );
      if (deleted) {
        setConfirmOpen(false);
        onDeleted();
        return;
      }
      setDetail(problemDetail !== "" ? problemDetail : "Ошибка сети.");
    })();
  };

  return (
    <section className="vse-report-block" aria-label="Действия с отчётом">
      <h2>Экспорт</h2>
      <p className="app-field-message">
        Файлы строятся только из сохранённого снимка отчёта; изменения исходных ВСЭ на них не влияют.
      </p>
      <div className="vse-report-actions">
        <Button type="button" disabled={busy} onClick={() => void runExport("pdf", "download")}>
          Скачать PDF
        </Button>
        <Button type="button" disabled={busy} onClick={() => void runExport("xlsx", "download")}>
          Скачать XLSX
        </Button>
        <Button type="button" disabled={busy} onClick={() => void runExport("pdf", "print")}>
          Печать
        </Button>
        <Button type="button" variant="danger" disabled={busy} onClick={() => setConfirmOpen(true)}>
          Удалить отчёт
        </Button>
      </div>
      {busy ? <p className="app-field-message">Документ формируется…</p> : null}
      {state.kind === "error" ? (
        <div role="alert" className="vse-report-error">
          <p>
            Файл не сформирован ({state.problem.code}, {state.problem.status}).
          </p>
          <p>{state.problem.detail}</p>
        </div>
      ) : null}
      <Dialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (!next && !busy) setConfirmOpen(false);
        }}
        title="Удалить отчёт"
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        danger
        busy={busy}
        error={detail}
        onConfirm={confirmDelete}
      >
        <p className="vse-report-note">
          Отчёт «{view.year}, {view.half === 1 ? "I" : "II"} полугодие» будет удалён без возможности
          восстановления. Период освободится — отчёт можно будет сохранить заново.
        </p>
        <p className="vse-report-note">
          Исходные ВСЭ, пробы и партии не затрагиваются; удаление касается только снимка отчёта.
        </p>
      </Dialog>
    </section>
  );
}

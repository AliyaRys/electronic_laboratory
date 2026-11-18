/**
 * SampleExportActions (DR49 §10): the «Скачать PDF»/«Скачать XLSX» actions of
 * the «Учёт проб» heading row. One request at a time; the pressed button
 * shows its busy label while both are disabled (the shared Button contract).
 * The download happens only after the Problem check, uses the server filename
 * (with a safe fallback) and never leaks a broken Blob. On error a compact
 * alert with «Повторить» re-runs the same kind with the same applied
 * parameters. Unmount aborts the request and releases the object URL.
 */
import { useEffect, useRef, useState } from "react";
import { fetchAccountingExport, type Problem } from "./api";
import { Button } from "../../shared/ui/Button";
import { StatusView } from "../../shared/ui/StatusView";

export type ExportKind = "pdf" | "xlsx";

export interface SampleExportActionsProps {
  laboratoryId: string;
  /** The APPLIED history period of the URL, never the unsaved draft fields. */
  dateFrom: string;
  dateTo: string;
}

type State =
  | { kind: "idle" }
  | { kind: "busy"; target: ExportKind }
  | { kind: "error"; target: ExportKind; problem: Problem };

function triggerDownload(blob: Blob, filename: string, fallback: string): string {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename !== "" ? filename : fallback;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  return url;
}

export function SampleExportActions({
  laboratoryId,
  dateFrom,
  dateTo,
}: SampleExportActionsProps): React.ReactElement {
  const [state, setState] = useState<State>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      // Unmount: abort the in-flight GET and release the object URL.
      abortRef.current?.abort();
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const busy = state.kind === "busy";

  const run = (target: ExportKind): void => {
    if (busy) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "busy", target });
    void fetchAccountingExport(
      target,
      { laboratory_id: laboratoryId, date_from: dateFrom || null, date_to: dateTo || null },
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      if ("problem" in result) {
        setState({ kind: "error", target, problem: result.problem });
        return;
      }
      setState({ kind: "idle" });
      const url = triggerDownload(result.blob, result.filename, `Учёт_проб.${target}`);
      // The previous download's URL is released once the new one is created.
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
    });
  };

  const pdfBusy = state.kind === "busy" && state.target === "pdf";
  const xlsxBusy = state.kind === "busy" && state.target === "xlsx";

  return (
    <div className="vse-samples-export">
      <div className="vse-samples-export-buttons">
        <Button type="button" variant="secondary" icon="admin-download" disabled={busy} busy={pdfBusy} busyLabel="Формируем PDF…" onClick={() => run("pdf")}>
          Скачать PDF
        </Button>
        <Button type="button" variant="secondary" icon="admin-download" disabled={busy} busy={xlsxBusy} busyLabel="Формируем XLSX…" onClick={() => run("xlsx")}>
          Скачать XLSX
        </Button>
      </div>
      {state.kind === "error" ? (
        <div className="vse-samples-export-error">
          <StatusView
            state="network-error"
            title={`Файл ${state.target.toUpperCase()} не сформирован (${state.problem.code}).`}
            detail={state.problem.detail}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const target = state.target;
              setState({ kind: "idle" });
              run(target);
            }}
          >
            Повторить
          </Button>
        </div>
      ) : null}
    </div>
  );
}

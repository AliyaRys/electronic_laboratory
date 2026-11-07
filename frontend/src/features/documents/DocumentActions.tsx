/**
 * DocumentActions (D02, FT-DOC-05): download and print of the SAME PDF bytes.
 *
 * The rules the component keeps:
 * - the Problem response is checked BEFORE any Blob/download/print — an
 *   error shows the Russian problem detail, never a broken file;
 * - both actions fetch the identical ``conclusion.pdf`` bytes (print opens
 *   those bytes, it does not re-render its own copy);
 * - the call is a pure read: no «Выдано» record is written, and cancelling
 *   the print dialog changes nothing on the server;
 * - a retry repeats exactly the same GET on the same party id, so the
 *   underlying ВСЭ can never be altered by a retry.
 */
import { useCallback, useState } from "react";
import { fetchConclusionPdf, type Problem } from "./api";

export interface DocumentActionsProps {
  partyId: string;
  /** File name offered by the download (the server one is attachment-based). */
  fileName?: string;
}

type ActionsState = { kind: "idle" } | { kind: "busy" } | { kind: "error"; problem: Problem };

function openBlob(blob: Blob, mode: "download" | "print", fileName: string): void {
  const url = URL.createObjectURL(blob);
  if (mode === "print") {
    const frame = window.open(url, "_blank");
    // The opened tab is the print surface; the URL is revoked later.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (frame === null) {
      // A blocked pop-up falls back to the download — still the same bytes.
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

export function DocumentActions({
  partyId,
  fileName = "Ветеринарное_заключение.pdf",
}: DocumentActionsProps): React.ReactElement {
  const [state, setState] = useState<ActionsState>({ kind: "idle" });

  const run = useCallback(
    async (mode: "download" | "print") => {
      setState({ kind: "busy" });
      const result = await fetchConclusionPdf(partyId);
      if ("problem" in result) {
        setState({ kind: "error", problem: result.problem });
        return;
      }
      setState({ kind: "idle" });
      openBlob(result.blob, mode, fileName);
    },
    [partyId, fileName],
  );

  return (
    <div className="vse-document-actions">
      <button
        type="button"
        className="vse-document-action"
        disabled={state.kind === "busy"}
        onClick={() => void run("download")}
      >
        Скачать PDF
      </button>
      <button
        type="button"
        className="vse-document-action"
        disabled={state.kind === "busy"}
        onClick={() => void run("print")}
      >
        Печать
      </button>
      {state.kind === "busy" ? <p className="vse-document-status">Документ формируется…</p> : null}
      {state.kind === "error" ? (
        <div className="vse-document-error" role="alert">
          <p>
            Документ не сформирован ({state.problem.code}, {state.problem.status}).
          </p>
          <p>{state.problem.detail}</p>
        </div>
      ) : null}
    </div>
  );
}

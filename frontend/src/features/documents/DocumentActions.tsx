/**
 * DocumentActions (D02, FT-DOC-05; ТЗ DR55 §5.5): download and print of the
 * SAME PDF bytes.
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
 *
 * The loading owner is shared with ``ConclusionActionsMenu`` through
 * {@link useConclusionDocument} — one implementation of the download rules,
 * never three copies.
 */
import { useCallback, useState } from "react";
import { fetchConclusionPdf, type Problem } from "./api";

export interface DocumentActionsProps {
  partyId: string;
  /** File name offered by the download (the server one is attachment-based). */
  fileName?: string;
}

export type DocumentProblem = Problem & { code?: string };

export type ActionsState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; problem: DocumentProblem };

export function openBlob(blob: Blob, mode: "download" | "print", fileName: string): void {
  const url = URL.createObjectURL(blob);
  if (mode === "print") {
    const frame = window.open(url, "_blank");
    // The opened tab is the print surface; the URL is revoked later.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (frame !== null) {
      return;
    }
    // ТЗ DR55 §5.5: a blocked pop-up is NOT a hidden download — the user
    // sees an honest error and can retry (the shared hook shows it).
    URL.revokeObjectURL(url);
    throw new PopupBlockedError();
  }
  triggerDownload(url, fileName);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export class PopupBlockedError extends Error {
  constructor() {
    super("Всплывающее окно заблокировано браузером.");
  }
}

const POPUP_PROBLEM: DocumentProblem = {
  code: "POPUP_BLOCKED",
  title: "Печать недоступна",
  status: 0,
  detail: "Всплывающее окно печати заблокировано браузером. Разрешите всплывающие окна и повторите.",
  trace_id: "",
} as DocumentProblem;

/**
 * The single owner of the conclusion-PDF loading (ТЗ DR55 §5.5): the same
 * endpoint and bytes for both actions, the Problem check before any Blob, a
 * busy guard and the honest popup-blocked error — shared by the inline
 * actions and the menu so the download rules live in exactly one place.
 */
export function useConclusionDocument(partyId: string) {
  const [state, setState] = useState<ActionsState>({ kind: "idle" });

  const run = useCallback(
    async (mode: "download" | "print", fileNameOverride?: string): Promise<void> => {
      if (state.kind === "busy") return;
      setState({ kind: "busy" });
      const result = await fetchConclusionPdf(partyId);
      if ("problem" in result) {
        setState({ kind: "error", problem: result.problem });
        return;
      }
      setState({ kind: "idle" });
      try {
        openBlob(result.blob, mode, fileNameOverride ?? result.fileName ?? fileNameFallback());
      } catch (error) {
        if (error instanceof PopupBlockedError) {
          setState({ kind: "error", problem: POPUP_PROBLEM });
          return;
        }
        throw error;
      }
    },
    [partyId, state.kind],
  );

  return { state, run };
}

function fileNameFallback(): string {
  return "Ветеринарное_заключение.pdf";
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
  fileName,
}: DocumentActionsProps): React.ReactElement {
  const { state, run } = useConclusionDocument(partyId);
  return (
    <div className="vse-document-actions">
      <button
        type="button"
        className="vse-document-action"
        disabled={state.kind === "busy"}
        onClick={() => void run("download", fileName)}
      >
        Скачать PDF
      </button>
      <button
        type="button"
        className="vse-document-action"
        disabled={state.kind === "busy"}
        onClick={() => void run("print", fileName)}
      >
        Печать
      </button>
      {state.kind === "busy" ? <p className="vse-document-status">Документ формируется…</p> : null}
      {state.kind === "error" ? <DocumentError problem={state.problem} /> : null}
    </div>
  );
}

/** The shared error presentation of a refused document read (role alert). */
export function DocumentError({ problem }: { problem: DocumentProblem }): React.ReactElement {
  return (
    <div className="vse-document-error" role="alert">
      <p>
        Документ не сформирован ({problem.code}, {problem.status}).
      </p>
      <p>{problem.detail}</p>
    </div>
  );
}

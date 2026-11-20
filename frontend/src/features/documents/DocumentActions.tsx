/**
 * DocumentActions (D02, FT-DOC-05; ТЗ DR55 §5.5): download and print of the
 * SAME PDF bytes.
 *
 * The rules the component keeps:
 * - the Problem response is checked BEFORE any Blob/download/print — an
 *   error shows the Russian problem detail, never a broken file;
 * - both actions fetch the identical ``conclusion.pdf`` bytes (print renders
 *   those bytes on a CLEAN hidden print surface — an iframe whose
 *   ``contentWindow.print()`` runs after load; no popup at all);
 * - the call is a pure read: no «Выдано» record is written, and cancelling
 *   the print dialog changes nothing on the server;
 * - every Blob URL is revoked after use and on unmount as a backstop;
 * - a retry repeats exactly the same GET on the same party id, so the
 *   underlying ВСЭ can never be altered by a retry.
 *
 * The loading owner is shared with ``ConclusionActionsMenu`` through
 * {@link useConclusionDocument} — one implementation of the download rules,
 * never three copies.
 */
import { useCallback, useEffect, useState } from "react";
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
  tracked.push(url);
  if (mode === "print") {
    printSurface(url);
    window.setTimeout(() => revokeUrl(url), 60_000);
    return;
  }
  triggerDownload(url, fileName);
  window.setTimeout(() => revokeUrl(url), 60_000);
}

function printSurface(url: string): void {
  // ТЗ DR55 fix-loop: an explicit CLEAN hidden print surface with the SAME
  // bytes — no popup and no application chrome; the system print dialog
  // runs after the PDF loads. No window.open → no popup-blocked path.
  const surface = document.createElement("iframe");
  surface.title = "Печать ветеринарного заключения";
  surface.style.position = "fixed";
  surface.style.width = "0";
  surface.style.height = "0";
  surface.style.border = "0";
  surface.style.visibility = "hidden";
  surface.addEventListener("load", () => {
    surface.contentWindow?.focus();
    surface.contentWindow?.print();
  });
  surface.src = url;
  document.body.append(surface);
  window.setTimeout(() => {
    surface.remove();
    revokeUrl(url);
  }, 60_000);
}

const tracked: string[] = [];

function revokeUrl(url: string): void {
  URL.revokeObjectURL(url);
  const index = tracked.indexOf(url);
  if (index >= 0) tracked.splice(index, 1);
}

/** Revokes every URL the owner still holds (a safe unmount backstop). */
export function revokeTrackedUrls(): void {
  for (const url of [...tracked]) revokeUrl(url);
}

/**
 * The single owner of the conclusion-PDF loading (ТЗ DR55 §5.5): the same
 * endpoint and bytes for both actions, the Problem check before any Blob and
 * a busy guard — shared by the inline actions and the menu so the download
 * rules live in exactly one place. Blob URLs are revoked on unmount.
 */
export function useConclusionDocument(partyId: string) {
  const [state, setState] = useState<ActionsState>({ kind: "idle" });

  // ТЗ DR55 fix-loop: every created Blob URL is released even if the menu or
  // the actions row unmounts before the fallback timers fire.
  useEffect(() => () => revokeTrackedUrls(), []);

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
      openBlob(result.blob, mode, fileNameOverride ?? result.fileName ?? fileNameFallback());
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

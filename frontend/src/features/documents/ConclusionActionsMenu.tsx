/**
 * ConclusionActionsMenu (ТЗ DR55 §5.5): the ONE shared menu of the conclusion
 * actions — trigger 34×34, popover 156px under it, exactly «Скачать» and
 * «Печать» (no Max). The download rules belong to the shared
 * {@link useConclusionDocument} owner; the popover renders in a portal with
 * fixed coordinates so a table container can never clip it, Escape/outside
 * click close it and the focus returns to the trigger.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../shared/ui/Icon";
import "./documents.css";
import { DocumentError, useConclusionDocument, type DocumentProblem } from "./DocumentActions";

export interface ConclusionActionsMenuProps {
  partyId: string;
  /** The «Скачать» item is rendered only with the ``conclusion:pdf`` right. */
  canDownload: boolean;
  /** The «Печать» item is rendered only with the ``conclusion:print`` right. */
  canPrint: boolean;
  /** Stories-only: render the popover open initially (§5.5 story states). */
  defaultOpen?: boolean;
}

// ТЗ DR55 §5.5: exactly one instance of the menu stays open at a time. The
// registry keeps the closer OBJECT of the currently open instance; a
// closing/unmounting instance removes ONLY its own entry (token equality),
// so its cleanup can never wipe the closer of a menu opened after it.
let openInstanceCloser: { close: () => void } | null = null;

export function ConclusionActionsMenu({
  partyId,
  canDownload,
  canPrint,
  defaultOpen = false,
}: ConclusionActionsMenuProps): React.ReactElement | null {
  const [open, setOpen] = useState(defaultOpen);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const { state, run } = useConclusionDocument(partyId);
  const menuId = useId();
  const busy = state.kind === "busy";

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect !== undefined) {
      setPosition({ left: rect.left, top: rect.bottom + 8 });
    }
    // ТЗ DR55 §5.5: exactly one open menu — a newly opened one closes the
    // previous instance without stealing its focus. This instance registers
    // its own closer and, on cleanup, removes ONLY that entry (token
    // equality), never the closer of a menu opened after it.
    openInstanceCloser?.close();
    const mine: { close: () => void } = { close: () => close(false) };
    openInstanceCloser = mine;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
      }
    };
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) === true) return;
      if (document.getElementById(menuId)?.contains(target) === true) return;
      close(true);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
      if (openInstanceCloser === mine) openInstanceCloser = null;
    };
  }, [open, close, menuId]);

  // ТЗ DR55 fix-loop: the print surface fetches the SAME bytes under
  // ``conclusion:pdf`` (one endpoint), so the «Печать» item shows only when
  // BOTH rights exist — print without the pdf right gets no menu at all.
  const canPrintItem = canPrint && canDownload;
  if (!canDownload && !canPrintItem) return null;
  const error = state.kind === "error" ? state.problem : null;

  return (
    <span className="vse-conclusion-menu">
      <button
        ref={triggerRef}
        type="button"
        className="vse-conclusion-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Действия с заключением"
        title="Действия с заключением"
        disabled={busy}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <Icon name="admin-download" />
      </button>
      {open && position !== null
        ? createPortal(
            <div id={menuId} className="vse-conclusion-popover" role="menu" style={position}>
              {canDownload ? (
                <button
                  type="button"
                  role="menuitem"
                  className="vse-conclusion-item"
                  disabled={busy}
                  onClick={() => {
                    close(true);
                    void run("download");
                  }}
                >
                  <Icon name="admin-download" />
                  Скачать
                </button>
              ) : null}
              {canPrintItem ? (
                <button
                  type="button"
                  role="menuitem"
                  className="vse-conclusion-item"
                  disabled={busy}
                  onClick={() => {
                    close(true);
                    void run("print");
                  }}
                >
                  <Icon name="admin-print" />
                  Печать
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
      {error !== null ? <DocumentError problem={error as DocumentProblem} /> : null}
    </span>
  );
}

/**
 * Confirm/informational dialog on Radix Dialog (ADR-007 pinned dep).
 *
 * Acceptance (UX-03): the safe cancel action is focused first, Escape closes,
 * focus returns to the trigger (Radix behaviour), focus is trapped while open,
 * and an error message is linked to the dialog through aria-describedby.
 */
import "./ui.css";
import { useEffect, useRef } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Button } from "./Button";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Accessible description; render as the visible body text. */
  description?: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  /** Server/validation problem shown inside the dialog (Problem detail). */
  error?: string;
  onConfirm?: () => void;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  danger = false,
  busy = false,
  error,
  onConfirm,
}: DialogProps): React.ReactElement {
  const titleId = "app-dialog-title";
  const errorId = "app-dialog-error";
  // Safe-cancel-first: the cancel button receives the initial focus.
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Focus returns to the trigger (UX-03): Radix restores only its own Trigger,
  // so the previous active element is remembered and restored here.
  const triggerRef = useRef<Element | null>(null);
  const describedBy = [error !== undefined && error !== "" ? errorId : null].filter(Boolean).join(" ");

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement;
      return;
    }
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger instanceof HTMLElement) trigger.focus();
  }, [open]);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="app-dialog-overlay" />
        <RadixDialog.Content
          className={`app-dialog${danger ? " danger" : ""}`}
          role="dialog"
          aria-labelledby={titleId}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
        >
          <RadixDialog.Title className="app-dialog-title" id={titleId}>
            {title}
          </RadixDialog.Title>
          {description !== undefined && description !== "" ? (
            <RadixDialog.Description className="app-dialog-description">
              {description}
            </RadixDialog.Description>
          ) : null}
          {children}
          {error !== undefined && error !== "" ? (
            <p className="app-dialog-error" id={errorId}>
              {error}
            </p>
          ) : null}
          <div className="app-dialog-actions">
            <Button
              ref={cancelRef}
              onClick={() => onOpenChange(false)}
              disabled={busy}
              busyLabel="Отмена недоступна…"
            >
              {cancelLabel}
            </Button>
            <Button
              variant={danger ? "danger" : "primary"}
              onClick={onConfirm}
              busy={busy}
              disabled={onConfirm === undefined}
            >
              {confirmLabel}
            </Button>
          </div>
          <RadixDialog.Close asChild>
            <button type="button" className="app-dialog-close" aria-label="Закрыть диалог">
              ✕
            </button>
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

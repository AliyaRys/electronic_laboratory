/**
 * Canonical working-screen button (UI-02, components/app/Button.js contract).
 * Authentication keeps its own larger variant; this component is for screens
 * after login. Busy blocks repeat submits and announces itself with aria-busy.
 */
import "./ui.css";
import type { ReactNode, Ref } from "react";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps {
  children?: ReactNode;
  /** Visible label; also the accessible name of icon-only buttons. */
  label?: string | undefined;
  /** Announced while ``busy`` (components/app contract). */
  busyLabel?: string | undefined;
  variant?: ButtonVariant | undefined;
  type?: "button" | "submit" | undefined;
  icon?: IconName | undefined;
  iconOnly?: boolean | undefined;
  disabled?: boolean | undefined;
  busy?: boolean | undefined;
  onClick?: (() => void) | undefined;
  className?: string | undefined;
  /** React 19: ref is an ordinary prop (Radix initial-focus needs it). */
  ref?: Ref<HTMLButtonElement> | undefined;
}

export function Button({
  children,
  label,
  busyLabel = "Выполняется…",
  variant = "secondary",
  type = "button",
  icon,
  iconOnly = false,
  disabled = false,
  busy = false,
  onClick,
  className,
  ref,
}: ButtonProps): React.ReactElement {
  const text = busy ? busyLabel : (label ?? undefined);
  const content: ReactNode = busy ? busyLabel : (children ?? text);
  return (
    <button
      ref={ref}
      type={type}
      className={["app-button", variant, iconOnly ? "icon-only" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled || busy}
      aria-busy={busy ? "true" : undefined}
      aria-label={iconOnly ? text : undefined}
      onClick={onClick}
    >
      {icon !== undefined && !busy ? <Icon name={icon} /> : null}
      {!iconOnly && content !== undefined ? <span>{content}</span> : null}
      {busy ? <span className="app-spinner" aria-hidden="true" /> : null}
    </button>
  );
}

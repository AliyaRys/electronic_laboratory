/**
 * Canonical system header (UI-02): the React port of
 * ``components/shell/AppHeader.js`` — same geometry, icons and keyboard
 * behaviour, one owner of the header styles (app-header.css).
 *
 * The user identity comes from UserView (GET /me) through props. A party or
 * examination specialist is never rendered here as the current user
 * (Review Focus F02).
 */
import "./app-header.css";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export type ProductType = "meat" | "milk";
export type HeaderMode = "work" | "admin" | "analyst" | "no-products";
export type HeaderActive = "arrivals" | "journal" | "directories" | "users" | "reports" | "";

export interface HeaderUser {
  fullName: string;
  initials: string;
}

export interface HeaderLinks {
  brand?: string;
  arrivals?: string;
  journal?: string;
  directories?: string;
  reports?: string;
  adminUsers?: string;
  adminReports?: string;
  profile?: string;
}

export const PRODUCTS: Readonly<Record<ProductType, { label: string; shortLabel: string; icon: IconName }>> =
  Object.freeze({
    meat: Object.freeze({ label: "Мясо и продукты убоя", shortLabel: "Мясо", icon: "meat" }),
    milk: Object.freeze({ label: "Молоко и молочная продукция", shortLabel: "Молоко", icon: "milk" }),
  });

export interface AppHeaderProps {
  mode?: HeaderMode;
  user: HeaderUser | null;
  institution?: string;
  product?: ProductType;
  active?: HeaderActive;
  links?: HeaderLinks;
  onProductChange?: (product: ProductType) => void;
  onLogout: () => void;
}

function NavLink({
  id,
  href,
  label,
  icon,
  active,
}: {
  id: string;
  href: string;
  label: string;
  icon: IconName;
  active: boolean;
}): React.ReactElement {
  return (
    <a
      id={id}
      className={`navlink${active ? " active" : ""}`}
      href={href}
      aria-current={active ? "page" : undefined}
    >
      <span className="icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span className="navtext">{label}</span>
    </a>
  );
}

function ProductSwitcher({
  product,
  onProductChange,
}: {
  product: ProductType;
  onProductChange?: ((product: ProductType) => void) | undefined;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = (returnFocus: boolean): void => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const options = Object.entries(PRODUCTS) as [ProductType, (typeof PRODUCTS)[ProductType]][];
  return (
    <div
      className={`nav-item product-switcher${open ? " open" : ""}`}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close(true);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="navlink product-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Тип продукции: ${PRODUCTS[product].label}`}
        data-short-label={PRODUCTS[product].shortLabel}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="product-icon" aria-hidden="true" data-product-icon={product}>
          <Icon name={PRODUCTS[product].icon} />
        </span>
        <span className="navtext" data-product-label="">
          {PRODUCTS[product].label}
        </span>
        <span className="nav-caret" aria-hidden="true">
          <Icon name="caret" />
        </span>
      </button>
      <div className="journal-menu product-menu" role="listbox" aria-label="Тип продукции">
        {options.map(([key, config]) => (
          <button
            key={key}
            type="button"
            role="option"
            aria-selected={key === product}
            data-product-option={key}
            className={key === product ? "active" : ""}
            onClick={() => {
              onProductChange?.(key);
              close(true);
            }}
          >
            <span className="product-icon" aria-hidden="true">
              <Icon name={config.icon} />
            </span>
            {config.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppHeader({
  mode = "work",
  user,
  institution = "Лаборатория ВСЭ",
  product = "meat",
  active = "",
  links = {},
  onProductChange,
  onLogout,
}: AppHeaderProps): React.ReactElement {
  const workMode = mode === "work";
  const brandHref =
    links.brand ??
    (mode === "admin" ? "/users" : mode === "analyst" ? "/labs" : workMode ? "/labs" : "/profile");
  const profileHref = links.profile ?? "/profile";

  const nav: React.ReactElement[] =
    mode === "admin"
      ? [
          <NavLink
            key="users"
            id="admin-users-link"
            href={links.adminUsers ?? "/users"}
            label="Управление пользователями"
            icon="admin-users"
            active={active === "users"}
          />,
          <NavLink
            key="reports"
            id="admin-reports-link"
            href={links.adminReports ?? "/labs"}
            label="Отчёты"
            icon="admin-reports"
            active={active === "reports"}
          />,
        ]
      : mode === "analyst"
        ? [
            <NavLink
              key="arrivals"
              id="arrivals-link"
              href={links.arrivals ?? "/labs"}
              label="Поступления"
              icon="arrivals"
              active={active === "arrivals"}
            />,
            <NavLink
              key="journal"
              id="journal-home"
              href={links.journal ?? "/labs"}
              label="Журнал ВСЭ"
              icon="journal-classic"
              active={active === "journal"}
            />,
            <NavLink
              key="directories"
              id="directories"
              href={links.directories ?? "/catalogs"}
              label="Справочники"
              icon="directories-classic"
              active={active === "directories"}
            />,
            <NavLink
              key="reports"
              id="analyst-reports-link"
              href={links.reports ?? "/labs"}
              label="Отчёты"
              icon="admin-reports"
              active={active === "reports"}
            />,
          ]
        : workMode
          ? [
              <NavLink
                key="arrivals"
                id="arrivals-link"
                href={links.arrivals ?? "/labs"}
                label="Поступления"
                icon="arrivals"
                active={active === "arrivals"}
              />,
              <NavLink
                key="journal"
                id="journal-home"
                href={links.journal ?? "/labs"}
                label="Журнал ВСЭ"
                icon="journal-classic"
                active={active === "journal"}
              />,
              <NavLink
                key="directories"
                id="directories"
                href={links.directories ?? "/catalogs"}
                label="Справочники"
                icon="directories-classic"
                active={active === "directories"}
              />,
            ]
          : [];

  return (
    <header className="topbar" data-app-header="" data-app-header-mode={mode}>
      <a
        id="brand-home"
        className="brand"
        href={brandHref}
        aria-label="Электронная лаборатория ВСЭ — главная"
      >
        <span className="brand-logo" aria-hidden="true">
          <Icon name="check" className="brand-mark" />
        </span>
        <div className="brand-copy">
          <strong>Электронная лаборатория ВСЭ</strong>
          <span>{institution}</span>
        </div>
      </a>
      <nav
        className="topnav"
        aria-label={mode === "no-products" ? "Рабочие разделы недоступны" : "Основная навигация"}
      >
        {nav}
        {workMode ? <ProductSwitcher product={product} onProductChange={onProductChange} /> : null}
      </nav>
      <div className="user-area">
        {user !== null ? (
          <a id="profile" className="user-link" href={profileHref}>
            <span className="avatar" aria-hidden="true">
              {user.initials}
            </span>
            <span className="user-name">{user.fullName}</span>
          </a>
        ) : null}
        <button id="logout" type="button" className="logout" onClick={onLogout}>
          Выйти
        </button>
      </div>
    </header>
  );
}

/** Derive the header user from UserView (API-02) — never from party data. */
export function headerUserFromView(user: { full_name: string }): HeaderUser {
  const initials = user.full_name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return { fullName: user.full_name, initials: initials === "" ? "?" : initials };
}

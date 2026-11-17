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
  /**
   * The contextual reports link; its PRESENCE (not the mode) renders the
   * «Отчёты» item — the shell computes it from real capabilities (DR37 §3):
   * a link is never a proof of access, the server re-checks every request.
   */
  reports?: string;
  adminUsers?: string;
  profile?: string;
}

export const PRODUCTS: Readonly<Record<ProductType, { label: string; shortLabel: string; icon: IconName }>> =
  Object.freeze({
    meat: Object.freeze({ label: "Мясо и мясопродукты", shortLabel: "Мясо", icon: "meat" }),
    milk: Object.freeze({ label: "Молоко и молочные продукты", shortLabel: "Молоко", icon: "milk" }),
  });

/** ТЗ DR46 §3.1: the roadmap configuration of the product switcher. Only
 * ``meat`` is the supported production context; the other entries are an
 * honest roadmap («Пока недоступно») — they never change the URL, storage,
 * requests or permissions, and do not extend the business API. */
export interface RoadmapProduct {
  key: string;
  label: string;
  shortLabel: string;
  icon: IconName;
  available: boolean;
}

export const ROADMAP_PRODUCTS: readonly RoadmapProduct[] = Object.freeze([
  Object.freeze({
    key: "meat",
    label: "Мясо и мясопродукты",
    shortLabel: "Мясо",
    icon: "meat",
    available: true,
  }),
  Object.freeze({
    key: "milk",
    label: "Молоко и молочные продукты",
    shortLabel: "Молоко",
    icon: "milk",
    available: false,
  }),
  Object.freeze({
    key: "eggs",
    label: "Яйца и яйцепродукция",
    shortLabel: "Яйца",
    icon: "product-eggs",
    available: false,
  }),
  Object.freeze({
    key: "fish",
    label: "Рыба и рыбная продукция",
    shortLabel: "Рыба",
    icon: "product-fish",
    available: false,
  }),
  Object.freeze({
    key: "honey",
    label: "Мёд и медовая продукция",
    shortLabel: "Мёд",
    icon: "product-honey",
    available: false,
  }),
  Object.freeze({
    key: "plant",
    label: "Растительная пищевая продукция",
    shortLabel: "Продукция",
    icon: "product-plant",
    available: false,
  }),
]);

/** ТЗ DR46 §3.1: the visible unavailability wording shared by the DOM. */
export const ROADMAP_STATUS_LABEL = "Пока недоступно";

export interface AppHeaderProps {
  mode?: HeaderMode;
  user: HeaderUser | null;
  institution?: string | undefined;
  product?: ProductType;
  active?: HeaderActive;
  /** /profile route: the user link is the current page (mockup profile.html). */
  profileActive?: boolean;
  links?: HeaderLinks;
  onProductChange?: ((product: ProductType) => void) | undefined;
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

  // ТЗ DR46 §3.1: the only available option keeps the roving focus; the
  // unavailable roadmap entries are excluded from keyboard navigation.
  const enabledOptions = ROADMAP_PRODUCTS.filter((item) => item.available);

  const focusOption = (direction: 1 | -1): void => {
    const options = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [],
    );
    if (options.length === 0) return;
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = index === -1 ? 0 : (index + direction + options.length) % options.length;
    options[next]?.focus();
  };

  const current = PRODUCTS[product] ?? PRODUCTS.meat;
  return (
    <div
      className={`nav-item product-switcher${open ? " open" : ""}`}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close(true);
        }
        if (!open) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          focusOption(1);
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          focusOption(-1);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="navlink product-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Тип продукции: ${current.label}`}
        data-short-label={current.shortLabel}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
            // The focus lands on the first (and only) available option.
            requestAnimationFrame(() => {
              rootRef.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)')?.focus();
            });
          }
        }}
      >
        <span className="product-icon" aria-hidden="true" data-product-icon={product}>
          <Icon name={current.icon} />
        </span>
        <span className="navtext" data-product-label="">
          {current.label}
        </span>
        <span className="nav-caret" aria-hidden="true">
          <Icon name="caret" />
        </span>
      </button>
      <div className="journal-menu product-menu" role="listbox" aria-label="Тип продукции">
        {ROADMAP_PRODUCTS.map((item) => {
          const selected = item.key === product;
          const enabled = item.available;
          return (
            <button
              key={item.key}
              type="button"
              role="option"
              aria-selected={selected}
              aria-disabled={!enabled}
              disabled={!enabled}
              data-product-option={item.key}
              className={selected ? "active" : ""}
              onClick={
                enabled
                  ? () => {
                      onProductChange?.(item.key as ProductType);
                      close(true);
                    }
                  : undefined
              }
            >
              <span className="product-icon" aria-hidden="true">
                <Icon name={item.icon} />
              </span>
              <span className="product-option-label">{item.label}</span>
              {!enabled ? <span className="product-option-status">{ROADMAP_STATUS_LABEL}</span> : null}
            </button>
          );
        })}
        {enabledOptions.length === 0 ? null : null}
      </div>
    </div>
  );
}

export function AppHeader({
  mode = "work",
  user,
  institution,
  product = "meat",
  active = "",
  profileActive = false,
  links = {},
  onProductChange,
  onLogout,
}: AppHeaderProps): React.ReactElement {
  const workMode = mode === "work";
  const brandHref =
    links.brand ??
    (mode === "admin" ? "/users" : mode === "analyst" ? "/labs" : workMode ? "/labs" : "/profile");
  const profileHref = links.profile ?? "/profile";

  // The reports item renders whenever the shell provides its contextual link
  // (work and analyst modes); ADMIN never gets a reports item (FT-RPT-01).
  const reportsItem = (mode: "analyst" | "work"): React.ReactElement | null =>
    links.reports !== undefined ? (
      <NavLink
        key="reports"
        id={mode === "analyst" ? "analyst-reports-link" : "reports-link"}
        href={links.reports}
        label="Отчёты"
        icon="admin-reports"
        active={active === "reports"}
      />
    ) : null;

  const nav =
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
            ...(links.reports !== undefined ? [reportsItem("analyst")] : []),
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
              ...(links.reports !== undefined ? [reportsItem("work")] : []),
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
          {/* The real lab logo (spec §6): a byte-identical copy of the owner's
              PNG served from ``frontend/public/`` — no check icon, no new SVG. */}
          <img
            src="/vse-lab-icon-transparent.png"
            alt=""
            width={43}
            height={43}
            loading="eager"
            decoding="sync"
          />
        </span>
        <div className="brand-copy">
          <strong>Электронная лаборатория ВСЭ</strong>
          {institution !== undefined ? <span>{institution}</span> : null}
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
          // ТЗ DR41 §3.1: the compact initials live in the avatar; the full
          // name stays in the accessible name and title of the profile link
          // and never stretches the header.
          <a
            id="profile"
            className={`user-link${profileActive ? " active" : ""}`}
            href={profileHref}
            title={user.fullName}
            aria-label={user.fullName}
            aria-current={profileActive ? "page" : undefined}
          >
            <span className="avatar" aria-hidden="true">
              {user.initials}
            </span>
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

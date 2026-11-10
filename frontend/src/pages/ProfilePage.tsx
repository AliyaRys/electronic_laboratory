/**
 * Profile (FT-ACC-05/06, ui-mapping: profile.html → /profile): read-only
 * identity/capabilities/scopes plus the change of the own known password.
 * After a successful change every session is revoked server-side, so the
 * screen returns the user to the login.
 *
 * Composition (DR4 §8): the two-card mockup layout — a centred summary card
 * (avatar, identity, capability tags) and a details card (InfoField grid over
 * the working tokens + a separated security block). The photo choice is
 * VISUAL ONLY: the file is never read, uploaded or put into a URL. The API
 * provides no human-readable scope/product names, so raw UUIDs are never
 * rendered as names — the areas field reports honest counts instead.
 */
import "../features/identity/identity.css";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate } from "react-router";
import { RequireSession } from "./RequireSession";
import { changePassword, ROLE_LABELS, type Problem } from "../features/identity/api";
import { PasswordForm } from "../features/identity/PasswordForm";
import { InfoField } from "../shared/ui/InfoField";
import { Icon } from "../shared/ui/Icon";
import { performLogout } from "../features/context/SwitchContext";
import { useMe, type UserView } from "../shared/api/me";

export function ProfilePage(): React.ReactElement {
  return (
    <RequireSession>
      <ProfileContent />
    </RequireSession>
  );
}

function initialsFrom(fullName: string): string {
  const initials = fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials === "" ? "?" : initials;
}

/**
 * Honest human-readable area summary. ScopeView carries only identifiers, so
 * the screen counts the REAL scopes instead of inventing names or rendering
 * raw UUIDs (spec DR4 §8.2/§8.3, API-gap recorded in the evidence).
 */
function areasSummary(user: UserView): string | null {
  if (user.scopes.length === 0) return null;
  const count = (pick: (scope: UserView["scopes"][number]) => string | null | undefined): number =>
    new Set(user.scopes.map(pick).filter((id) => id !== null && id !== undefined)).size;
  const laboratories = count((scope) => scope.laboratory_id);
  const species = count((scope) => scope.product_scope_id);
  const territories = count((scope) => scope.territory_id);
  const parts: string[] = [];
  if (laboratories > 0) parts.push(`Лаборатории: ${laboratories}`);
  if (species > 0) parts.push(`Виды продукции: ${species}`);
  if (territories > 0) parts.push(`Территории: ${territories}`);
  return parts.length === 0 ? null : parts.join(" · ");
}

function ProfileContent(): React.ReactElement {
  const { user } = useMe();
  const queryClient = useQueryClient();
  const [changed, setChanged] = useState(false);
  const [leaveForLogin, setLeaveForLogin] = useState(false);

  if (user === null) return <Navigate to="/login" replace />;

  const initials = initialsFrom(user.full_name);
  const areas = areasSummary(user);

  return (
    <div className="vse-app vse-page vse-profile-page">
      <h1>Профиль пользователя</h1>
      <div className="vse-profile-shell">
        <section className="vse-profile-summary-card" aria-label="Сведения о доступе">
          <label className="vse-profile-avatar-picker">
            <span className="vse-profile-avatar" aria-hidden="true">
              {initials}
            </span>
            {/* Visual only (UX-CONTRACT): the file is never read or sent. */}
            <input
              type="file"
              accept="image/*"
              className="vse-profile-avatar-input"
              aria-label="Выбор фотографии — демонстрация"
              data-testid="profile-photo-input"
              onChange={() => undefined}
            />
            <span className="vse-profile-camera" aria-hidden="true">
              <Icon name="camera" />
            </span>
          </label>
          <div className="vse-profile-identity">
            <div className="vse-profile-name">{user.full_name}</div>
            <div className="vse-profile-login">{user.login}</div>
          </div>
          <div className="vse-profile-access">
            <p className="app-info-label">Права доступа</p>
            <div className="vse-profile-rights">
              {user.capabilities.length === 0 ? (
                <span>Прав не назначено.</span>
              ) : (
                user.capabilities.map((capability) => (
                  <span className="vse-profile-right-tag" key={capability}>
                    {capability}
                  </span>
                ))
              )}
            </div>
          </div>
        </section>
        <section className="vse-profile-details-card" aria-label="Данные пользователя">
          <div className="vse-profile-section-title">
            <span className="vse-profile-section-icon" aria-hidden="true">
              <Icon name="user" />
            </span>
            <h2>Данные пользователя</h2>
          </div>
          <div className="vse-profile-info-grid">
            <InfoField label="Фамилия и имя" value={user.full_name} />
            <InfoField label="Логин" value={user.login} />
            <InfoField label="Email" value={user.email} wide />
            <InfoField label="Роль" value={ROLE_LABELS[user.role]} />
            {user.position !== null ? <InfoField label="Должность" value={user.position} /> : null}
            {areas !== null ? <InfoField label="Области доступа" value={areas} wide /> : null}
          </div>
          <div className="vse-profile-security">
            <h2 className="vse-profile-security-title">Смена пароля</h2>
            {changed ? (
              <div className="auth-success" role="status">
                Пароль изменён. Все сеансы отозваны — войдите заново с новым паролем.
              </div>
            ) : null}
            <PasswordForm
              mode="change"
              onSubmit={async (values) => changePassword(values) as Promise<Problem | null>}
              onSuccess={() => setChanged(true)}
            />
            {changed ? (
              <button
                type="button"
                className="app-button primary"
                onClick={() => {
                  // All sessions were revoked: leave honestly for the login.
                  void performLogout(queryClient).finally(() => setLeaveForLogin(true));
                }}
              >
                Войти заново
              </button>
            ) : null}
          </div>
        </section>
      </div>
      {leaveForLogin ? <Navigate to="/login" replace /> : null}
    </div>
  );
}

/**
 * Profile (FT-ACC-05/06, ui-mapping: profile.html → /profile): read-only
 * identity/capabilities/scopes plus the change of the own known password.
 * After a successful change every session is revoked server-side, so the
 * screen returns the user to the login.
 */
import "../features/identity/identity.css";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate } from "react-router";
import { RequireSession } from "./RequireSession";
import { changePassword, ROLE_LABELS, type Problem } from "../features/identity/api";
import { PasswordForm } from "../features/identity/PasswordForm";
import { InfoField } from "../shared/ui/InfoField";
import { performLogout } from "../features/context/SwitchContext";
import { useMe } from "../shared/api/me";

export function ProfilePage(): React.ReactElement {
  return (
    <RequireSession>
      <ProfileContent />
    </RequireSession>
  );
}

function ProfileContent(): React.ReactElement {
  const { user } = useMe();
  const queryClient = useQueryClient();
  const [changed, setChanged] = useState(false);
  const [leaveForLogin, setLeaveForLogin] = useState(false);

  if (user === null) return <Navigate to="/login" replace />;

  return (
    <div className="vse-app vse-page">
      <h1>Профиль пользователя</h1>
      <div className="vse-profile-layout">
        <section className="vse-panel" aria-label="Сведения о доступе">
          <InfoField label="ФИО" value={user.full_name} />
          <InfoField label="Логин" value={user.login} />
          <InfoField label="Email" value={user.email} />
          <InfoField label="Роль" value={ROLE_LABELS[user.role]} />
          {user.position !== null ? <InfoField label="Должность" value={user.position} /> : null}
          <div>
            <p className="app-info-label">Права</p>
            <p>
              {user.capabilities.length === 0 ? (
                <span>Прав не назначено.</span>
              ) : (
                user.capabilities.map((capability) => (
                  <span className="vse-tag" key={capability}>
                    {capability}
                  </span>
                ))
              )}
            </p>
          </div>
          <div>
            <p className="app-info-label">Назначения</p>
            <p>
              {user.scopes.length === 0 ? (
                <span>Продукция и лаборатории не назначены.</span>
              ) : (
                user.scopes.map((scope, index) => (
                  <span className="vse-tag" key={`${scope.laboratory_id ?? "r"}-${index}`}>
                    {scope.laboratory_id !== null && scope.laboratory_id !== undefined
                      ? `Лаборатория ${scope.laboratory_id.slice(0, 8)}…`
                      : "Территория"}
                  </span>
                ))
              )}
            </p>
          </div>
        </section>
        <section className="vse-panel" aria-label="Смена пароля">
          <h2 style={{ margin: 0, fontSize: 17 }}>Смена пароля</h2>
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
        </section>
      </div>
      {leaveForLogin ? <Navigate to="/login" replace /> : null}
    </div>
  );
}

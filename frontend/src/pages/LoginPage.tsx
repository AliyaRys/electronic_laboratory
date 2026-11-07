/**
 * Login page (FT-ACC-01, ui-mapping: login.html → /login). The standalone
 * auth screen sits outside the working shell; on success the fresh session
 * replaces any anonymous state and the user lands on the role-specific
 * initial route (API-02 «Начальные маршруты»).
 */
import "../features/identity/identity.css";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LoginForm, runLogin, type LoginValues } from "../features/identity/LoginForm";
import { initialRouteFor } from "../features/identity/api";
import { completeLogin } from "../features/identity/session";

export function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (values: LoginValues) => {
    setSubmitting(true);
    try {
      const result = await runLogin(values);
      if (result.ok) {
        completeLogin(queryClient, result.payload);
        const next = params.get("next");
        navigate(
          next !== null && next.startsWith("/")
            ? next
            : initialRouteFor(result.payload.user, result.payload.contexts),
          {
            replace: true,
          },
        );
      }
      return result;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="vse-auth vse-auth-page">
      <span className="auth-orb one" aria-hidden="true" />
      <span className="auth-orb two" aria-hidden="true" />
      <span className="auth-orb three" aria-hidden="true" />
      <div className="auth-shell">
        <section className="auth-welcome" aria-label="Электронная лаборатория ВСЭ">
          <h1>
            Электронная лаборатория <span className="auth-accent">ВСЭ</span>
          </h1>
          <p className="auth-welcome-text">
            Вход выполняется по логину и паролю, выданным администратором. Доступ к рабочим разделам
            определяется назначенной лабораторией и типом продукции.
          </p>
        </section>
        <section className="auth-card" aria-label="Вход в систему">
          <h1>Вход</h1>
          <p className="auth-hint">Используйте учётные данные, выданные администратором.</p>
          <LoginForm onSubmit={onSubmit} />
          <a className="auth-link" href="/password-help">
            Забыли пароль?
          </a>
        </section>
      </div>
      <span className="visually-hidden" aria-live="polite">
        {submitting ? "Выполняется вход…" : ""}
      </span>
    </div>
  );
}

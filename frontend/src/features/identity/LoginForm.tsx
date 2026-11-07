/**
 * Login form (FT-ACC-01): RHF + Zod validation done manually (no extra
 * dependencies — SPEC-03), errors bound to fields, busy blocks repeat
 * submits. The login stays after a failed attempt; the secret is cleared
 * after every attempt or close, and nothing is stored anywhere (ТЗ-02).
 */
import "./identity.css";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import type { Problem } from "../../shared/api/problem";
import { bootstrapCsrf, login, loginProblemText, type LoginPayload } from "./api";

const loginSchema = z.object({
  login: z.string().trim().min(1, "Укажите логин."),
  password: z.string().min(1, "Укажите пароль."),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type LoginResult = { ok: true; payload: LoginPayload } | { ok: false; problem: Problem };

export interface LoginFormProps {
  onSubmit: (values: LoginValues) => Promise<LoginResult>;
}

export async function runLogin(values: LoginValues, signal?: AbortSignal): Promise<LoginResult> {
  return login(values.login, values.password, signal);
}

export function LoginForm({ onSubmit }: LoginFormProps): React.ReactElement {
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    defaultValues: { login: "", password: "" },
  });
  const [formError, setFormError] = useState("");

  // The anonymous CSRF bootstrap runs once on mount; without the cookie the
  // login command would be rejected server-side (API-01). The submit also
  // awaits the bootstrap so a fast click can never race the rotating
  // bootstrap cookie with an empty in-memory token.
  useEffect(() => {
    void bootstrapCsrf();
  }, []);

  const submit = handleSubmit(async (values) => {
    setFormError("");
    await bootstrapCsrf();
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "login" || field === "password") {
          setError(field, { message: issue.message });
        }
      }
      return;
    }
    const result = await onSubmit(parsed.data);
    if (!result.ok) {
      setFormError(loginProblemText(result.problem));
      if (result.problem.code === "INVALID_CREDENTIALS") {
        // The login stays, the secret never does (ТЗ-02).
        setValue("password", "");
      }
    }
  });

  return (
    <form className="vse-auth-form" onSubmit={submit} noValidate>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="login-field">Логин</label>
        </div>
        <input
          id="login-field"
          type="text"
          autoComplete="username"
          aria-invalid={errors.login !== undefined ? "true" : undefined}
          aria-describedby={errors.login !== undefined ? "login-field-error" : undefined}
          {...register("login")}
        />
        {errors.login !== undefined ? (
          <p className="app-field-message app-field-error" id="login-field-error" aria-live="polite">
            {errors.login.message}
          </p>
        ) : null}
      </div>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="password-field">Пароль</label>
        </div>
        <input
          id="password-field"
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.password !== undefined ? "true" : undefined}
          aria-describedby={errors.password !== undefined ? "password-field-error" : undefined}
          {...register("password")}
        />
        {errors.password !== undefined ? (
          <p className="app-field-message app-field-error" id="password-field-error" aria-live="polite">
            {errors.password.message}
          </p>
        ) : null}
      </div>
      {formError !== "" ? (
        <p className="app-field-message app-field-error" role="alert">
          {formError}
        </p>
      ) : null}
      <button
        type="submit"
        className="app-button primary"
        disabled={isSubmitting}
        aria-busy={isSubmitting ? "true" : undefined}
      >
        {isSubmitting ? "Выполняется…" : "Войти"}
      </button>
    </form>
  );
}

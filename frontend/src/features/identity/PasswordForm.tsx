/**
 * Password forms (FT-ACC-06/FT-ADM): change of the known password (profile)
 * and the administrator reset (user administration) share one component.
 * RHF + Zod manually, every secret lives in form state only and is cleared
 * after submit or close — no persistence of passwords anywhere (ТЗ-02).
 */
import "./identity.css";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { Button } from "../../shared/ui/Button";
import type { Problem } from "../../shared/api/problem";

export type PasswordMode = "change" | "reset";

const baseSchema = z.object({
  current_password: z.string(),
  new_password: z
    .string()
    .min(12, "Пароль — не менее 12 символов.")
    .max(128, "Пароль — не более 128 символов."),
  confirmation: z.string().min(1, "Повторите пароль."),
});

const changeSchema = baseSchema
  .refine((values) => values.current_password !== "", {
    message: "Укажите текущий пароль.",
    path: ["current_password"],
  })
  .refine((values) => values.new_password === values.confirmation, {
    message: "Пароли не совпадают.",
    path: ["confirmation"],
  });

const resetSchema = baseSchema.refine((values) => values.new_password === values.confirmation, {
  message: "Пароли не совпадают.",
  path: ["confirmation"],
});

export type PasswordValues = {
  current_password: string;
  new_password: string;
  confirmation: string;
};

export interface PasswordFormProps {
  mode: PasswordMode;
  busy?: boolean;
  /** Runs the real command; the component clears the secrets afterwards. */
  onSubmit: (values: PasswordValues) => Promise<Problem | null>;
  /** Called after a successful 204 (already with cleared fields). */
  onSuccess?: () => void;
}

/** Map Problem.errors (path = DTO field) onto the form fields. */
export function problemFieldErrors(problem: Problem): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of problem.errors ?? []) {
    if (item.path !== "") result[item.path] = item.message;
  }
  return result;
}

export function PasswordForm({
  mode,
  busy = false,
  onSubmit,
  onSuccess,
}: PasswordFormProps): React.ReactElement {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({
    defaultValues: { current_password: "", new_password: "", confirmation: "" },
  });
  const [formError, setFormError] = useState("");
  const pending = isSubmitting || busy;

  // Closed input is dropped when the owner unmounts the form (close/logout).
  useEffect(() => () => reset(), [reset]);

  const submit = handleSubmit(async (values) => {
    const schema = mode === "change" ? changeSchema : resetSchema;
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "current_password" || field === "new_password" || field === "confirmation") {
          setError(field, { message: issue.message });
        }
      }
      return;
    }
    setFormError("");
    const problem = await onSubmit(parsed.data);
    if (problem !== null) {
      const fieldErrors = problemFieldErrors(problem);
      let bound = false;
      for (const field of ["current_password", "new_password", "confirmation"] as const) {
        if (fieldErrors[field] !== undefined) {
          setError(field, { message: fieldErrors[field] ?? "" });
          bound = true;
        }
      }
      setFormError(
        bound ? problem.detail : problem.detail !== "" ? problem.detail : "Не удалось изменить пароль.",
      );
      return;
    }
    // Success: the secrets are cleared immediately (ТЗ-02).
    reset();
    onSuccess?.();
  });

  return (
    <form className="vse-auth-form vse-password-form" onSubmit={submit} noValidate>
      {mode === "change" ? (
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="current-password">Текущий пароль</label>
          </div>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            disabled={pending}
            aria-invalid={errors.current_password !== undefined ? "true" : undefined}
            aria-describedby={errors.current_password !== undefined ? "current-password-error" : undefined}
            {...register("current_password")}
          />
          {errors.current_password !== undefined ? (
            <p className="app-field-message app-field-error" id="current-password-error" aria-live="polite">
              {errors.current_password.message}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="new-password">Новый пароль</label>
        </div>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          disabled={pending}
          aria-invalid={errors.new_password !== undefined ? "true" : undefined}
          aria-describedby={errors.new_password !== undefined ? "new-password-error" : undefined}
          {...register("new_password")}
        />
        {errors.new_password !== undefined ? (
          <p className="app-field-message app-field-error" id="new-password-error" aria-live="polite">
            {errors.new_password.message}
          </p>
        ) : null}
      </div>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="confirmation">Подтверждение</label>
        </div>
        <input
          id="confirmation"
          type="password"
          autoComplete="new-password"
          disabled={pending}
          aria-invalid={errors.confirmation !== undefined ? "true" : undefined}
          aria-describedby={errors.confirmation !== undefined ? "confirmation-error" : undefined}
          {...register("confirmation")}
        />
        {errors.confirmation !== undefined ? (
          <p className="app-field-message app-field-error" id="confirmation-error" aria-live="polite">
            {errors.confirmation.message}
          </p>
        ) : null}
      </div>
      {formError !== "" ? (
        <p className="app-field-message app-field-error" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="vse-password-actions">
        <Button type="submit" variant="primary" busy={pending} busyLabel="Сохраняем…">
          {mode === "change" ? "Изменить пароль" : "Сбросить"}
        </Button>
      </div>
    </form>
  );
}

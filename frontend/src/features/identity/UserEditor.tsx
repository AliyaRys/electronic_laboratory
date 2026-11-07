/**
 * User create/edit form (FT-ACC-08/09): full name, login, email, position,
 * role and the scope list (laboratory + optional product, real UUIDs only).
 * RHF + Zod manually; server Problem.errors are bound to their fields by the
 * DTO path (``login``, ``scopes.0.laboratory_id`` …). The password is part of
 * creation only, lives in form state and is cleared after submit/close.
 */
import "./identity.css";
import { z } from "zod";
import { useForm, useFieldArray } from "react-hook-form";
import { useEffect, useState } from "react";
import { Button } from "../../shared/ui/Button";
import type { Problem } from "../../shared/api/problem";
import { problemFieldErrors } from "./PasswordForm";
import type { UserView } from "./api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const scopeSchema = z
  .object({
    laboratory_id: z.string().trim().regex(UUID, "Укажите UUID лаборатории."),
    product_scope_id: z
      .string()
      .trim()
      .refine((value) => value === "" || UUID.test(value), "UUID продукции указан неверно.")
      .transform((value) => (value === "" ? null : value)),
  })
  .transform((scope) => ({
    laboratory_id: scope.laboratory_id,
    product_scope_id: scope.product_scope_id ?? null,
  }));

export const userEditorSchema = z.object({
  full_name: z.string().trim().min(1, "Укажите ФИО."),
  login: z.string().trim().min(1, "Укажите логин."),
  email: z
    .string()
    .trim()
    .min(1, "Укажите email.")
    .refine((v) => v.includes("@"), "Email указан неверно."),
  position: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v)),
  role: z.enum(["VET", "HEAD", "ANALYST"]),
  scopes: z.array(scopeSchema),
  password: z
    .string()
    .refine(
      (value) => value === "" || (value.length >= 12 && value.length <= 128),
      "Пароль — от 12 до 128 символов.",
    ),
  confirmation: z.string(),
});

export type UserEditorValues = z.input<typeof userEditorSchema>;
export type UserEditorParsed = z.output<typeof userEditorSchema>;

export type UserEditorSubmit = Omit<UserEditorParsed, "password" | "confirmation"> & {
  password?: string | undefined;
  confirmation?: string | undefined;
};

export interface UserEditorProps {
  mode: "create" | "edit";
  /** Prefilled values for editing (from GET /users/:id). */
  initial?: Partial<UserEditorValues> | undefined;
  busy?: boolean | undefined;
  onSubmit: (parsed: UserEditorSubmit) => Promise<Problem | null>;
  onSuccess?: (() => void) | undefined;
}

/** Parse the raw RHF values into the UserEditorParsed shape. */
export function parseUserEditor(values: UserEditorValues): { data?: UserEditorParsed; issues: z.ZodIssue[] } {
  // A completely empty scope row is "not filled in", not an error: the
  // administrator can leave a row unused without a validation wall.
  const cleaned: UserEditorValues = {
    ...values,
    scopes: values.scopes.filter(
      (scope) => scope.laboratory_id.trim() !== "" || scope.product_scope_id.trim() !== "",
    ),
  };
  const parsed = userEditorSchema.safeParse(cleaned);
  if (parsed.success) return { data: parsed.data, issues: [] };
  return { issues: parsed.error.issues };
}

export function userEditorDefaults(user?: UserView): UserEditorValues {
  const scopes =
    user !== undefined
      ? user.scopes.map((scope) => ({
          laboratory_id: scope.laboratory_id ?? "",
          product_scope_id: scope.product_scope_id ?? "",
        }))
      : [{ laboratory_id: "", product_scope_id: "" }];
  return {
    full_name: user?.full_name ?? "",
    login: user?.login ?? "",
    email: user?.email ?? "",
    position: user?.position ?? "",
    role: user === undefined ? "VET" : user.role === "ADMIN" ? "VET" : user.role,
    scopes,
    password: "",
    confirmation: "",
  };
}

export function UserEditor({
  mode,
  initial,
  busy = false,
  onSubmit,
  onSuccess,
}: UserEditorProps): React.ReactElement {
  const defaults = initial ?? userEditorDefaults();
  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UserEditorValues>({ defaultValues: defaults });
  const { fields, append, remove } = useFieldArray({ control, name: "scopes" });
  const [formError, setFormError] = useState("");
  const pending = isSubmitting || busy;

  useEffect(() => {
    if (initial !== undefined) reset(initial);
  }, [initial, reset]);

  const submit = handleSubmit(async (values) => {
    const { data, issues } = parseUserEditor(values);
    if (data === undefined) {
      for (const issue of issues) {
        setError(issue.path.join(".") as never, { message: issue.message });
      }
      return;
    }
    if (mode === "create") {
      if (data.password.length < 12) {
        setError("password", { message: "Пароль — от 12 до 128 символов." });
        return;
      }
      if (data.password !== values.confirmation) {
        setError("confirmation", { message: "Пароли не совпадают." });
        return;
      }
    }
    setFormError("");
    // Edit never sends the password fields (API-02: password only on create).
    const payload: UserEditorSubmit = {
      ...data,
      ...(mode === "create"
        ? { password: data.password, confirmation: values.confirmation }
        : { password: undefined, confirmation: undefined }),
    };
    const problem = await onSubmit(payload);
    if (problem !== null) {
      const fieldErrors = problemFieldErrors(problem);
      let bound = false;
      for (const [path, message] of Object.entries(fieldErrors)) {
        setError(path as never, { message });
        bound = true;
      }
      if (problem.code === "ALREADY_EXISTS" && !bound) {
        setError("login", { message: "Такой логин уже занят." });
        bound = true;
      }
      setFormError(
        bound
          ? problem.detail
          : problem.detail !== ""
            ? problem.detail
            : "Не удалось сохранить пользователя.",
      );
      return;
    }
    // The secrets never outlive the submit (ТЗ-02).
    reset({ ...values, password: "", confirmation: "" });
    onSuccess?.();
  });

  return (
    <form className="vse-auth-form vse-user-editor" onSubmit={submit} noValidate>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="user-full-name">ФИО</label>
        </div>
        <input
          id="user-full-name"
          type="text"
          disabled={pending}
          aria-invalid={errors.full_name !== undefined ? "true" : undefined}
          {...register("full_name")}
        />
        {errors.full_name !== undefined ? (
          <p className="app-field-message app-field-error" role="alert">
            {errors.full_name.message}
          </p>
        ) : null}
      </div>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="user-login">Логин</label>
        </div>
        <input
          id="user-login"
          type="text"
          autoComplete="off"
          disabled={pending}
          aria-invalid={errors.login !== undefined ? "true" : undefined}
          {...register("login")}
        />
        {errors.login !== undefined ? (
          <p className="app-field-message app-field-error" role="alert">
            {errors.login.message}
          </p>
        ) : null}
      </div>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="user-email">Email</label>
        </div>
        <input
          id="user-email"
          type="text"
          autoComplete="off"
          disabled={pending}
          aria-invalid={errors.email !== undefined ? "true" : undefined}
          {...register("email")}
        />
        {errors.email !== undefined ? (
          <p className="app-field-message app-field-error" role="alert">
            {errors.email.message}
          </p>
        ) : null}
      </div>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="user-position">Должность</label>
        </div>
        <input id="user-position" type="text" disabled={pending} {...register("position")} />
      </div>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="user-role">Роль</label>
        </div>
        <select id="user-role" disabled={pending} {...register("role")}>
          <option value="VET">Ветврач</option>
          <option value="HEAD">Заведующий</option>
          <option value="ANALYST">Аналитик</option>
        </select>
        {mode === "create" ? (
          <p className="app-field-message">
            Полномочия администратора выдаются закрытой командой установки и не выбираются здесь.
          </p>
        ) : null}
      </div>

      <fieldset className="vse-scopes">
        <legend>Назначения (лаборатории и продукция)</legend>
        {fields.map((field, index) => {
          const scopeError = errors.scopes?.[index];
          return (
            <div className="vse-scope-row" key={field.id}>
              <div className="app-field">
                <div className="app-field-heading">
                  <label htmlFor={`scope-lab-${index}`}>Лаборатория (UUID)</label>
                </div>
                <input
                  id={`scope-lab-${index}`}
                  type="text"
                  autoComplete="off"
                  disabled={pending}
                  aria-invalid={scopeError?.laboratory_id !== undefined ? "true" : undefined}
                  {...register(`scopes.${index}.laboratory_id` as const)}
                />
                {scopeError?.laboratory_id !== undefined ? (
                  <p className="app-field-message app-field-error" role="alert">
                    {scopeError.laboratory_id?.message}
                  </p>
                ) : null}
              </div>
              <div className="app-field">
                <div className="app-field-heading">
                  <label htmlFor={`scope-product-${index}`}>Продукция (UUID, необязательно)</label>
                </div>
                <input
                  id={`scope-product-${index}`}
                  type="text"
                  autoComplete="off"
                  disabled={pending}
                  {...register(`scopes.${index}.product_scope_id` as const)}
                />
              </div>
              <Button onClick={() => remove(index)} disabled={pending}>
                Убрать
              </Button>
            </div>
          );
        })}
        <Button onClick={() => append({ laboratory_id: "", product_scope_id: "" })} disabled={pending}>
          Добавить назначение
        </Button>
      </fieldset>

      {mode === "create" ? (
        <>
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor="user-password">Пароль</label>
            </div>
            <input
              id="user-password"
              type="password"
              autoComplete="new-password"
              disabled={pending}
              {...register("password")}
            />
            {errors.password !== undefined ? (
              <p className="app-field-message app-field-error" role="alert">
                {errors.password.message}
              </p>
            ) : null}
          </div>
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor="user-confirmation">Подтверждение пароля</label>
            </div>
            <input
              id="user-confirmation"
              type="password"
              autoComplete="new-password"
              disabled={pending}
              {...register("confirmation")}
            />
            {errors.confirmation !== undefined ? (
              <p className="app-field-message app-field-error" role="alert">
                {errors.confirmation.message}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {formError !== "" ? (
        <p className="app-field-message app-field-error" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="vse-password-actions">
        <Button type="submit" variant="primary" busy={pending} busyLabel="Сохраняем…">
          {mode === "create" ? "Создать пользователя" : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}

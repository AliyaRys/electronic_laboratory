/**
 * User creation form (DR34 §6/§7, FT-ACC-09, FT-ADM-01, mockup
 * admin-user-create.html): the two cards «Основные сведения»/«Доступ
 * пользователя» with HUMAN-READABLE role/laboratory/territory/product
 * selection — no UUID field exists anywhere. The server stays the authority:
 * the selectable sets arrive from GET /users/assignable, the ids are sent
 * back only inside the payload, and every server Problem is bound to its
 * field by ``Problem.errors.path``. The password lives in form state only,
 * uses ``autocomplete="new-password"`` and is cleared after success, cancel
 * and unmount; it never reaches URL, storage or error text (ТЗ-02).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { Field } from "../../shared/ui/Field";
import type { Problem } from "../../shared/api/problem";
import { problemFieldErrors } from "./PasswordForm";
import type { AssignableOptions, UserEditorPayload, UserRole } from "./api";
import "./identity.css";

export type UserCreatePayload = UserEditorPayload;

export interface UserCreateFormProps {
  /** Server-authoritative options; null while loading. */
  options: AssignableOptions | null;
  optionsLoading?: boolean;
  busy?: boolean;
  /** Prefilled non-secret values (stories, diagnostics); passwords never prefill. */
  initial?: Partial<Pick<Values, "fullName" | "login" | "email" | "position">> | undefined;
  onSubmit: (payload: UserCreatePayload, intentKey: string) => Promise<Problem | null>;
  /** Raw cancel request; the page owns the unsaved-changes decision. */
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

interface Values {
  fullName: string;
  login: string;
  password: string;
  confirmation: string;
  email: string;
  position: string;
  role: UserRole;
  laboratoryId: string;
  productAreaId: string;
  territoryId: string;
}

const INITIAL: Values = {
  fullName: "",
  login: "",
  password: "",
  confirmation: "",
  email: "",
  position: "",
  role: "VET",
  laboratoryId: "",
  productAreaId: "",
  territoryId: "",
};

export function UserCreateForm({
  options,
  optionsLoading = false,
  busy = false,
  initial,
  onSubmit,
  onCancel,
  onDirtyChange,
}: UserCreateFormProps): React.ReactElement {
  const [values, setValues] = useState<Values>({ ...INITIAL, ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [pendingRole, setPendingRole] = useState<UserRole | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const intentKey = useRef<string | null>(null);
  const failedIntent = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const pending = submitting || busy;
  const roles = useMemo(() => options?.roles ?? [], [options]);
  const currentRole = useMemo(
    () => roles.find((item) => item.role === values.role) ?? null,
    [roles, values.role],
  );

  // One idempotency key per user intent (DR34 §9): the key survives a network
  // retry of the same input and is regenerated as soon as the user edits.
  useEffect(() => {
    if (failedIntent.current && intentKey.current !== null) {
      intentKey.current = null;
      failedIntent.current = false;
    }
  }, [values]);

  const dirty = useMemo(
    () =>
      values.fullName !== "" ||
      values.login !== "" ||
      values.password !== "" ||
      values.confirmation !== "" ||
      values.email !== "" ||
      values.position !== "" ||
      values.laboratoryId !== "" ||
      values.productAreaId !== "" ||
      values.territoryId !== "",
    [values],
  );
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const set = (patch: Partial<Values>): void => setValues((previous) => ({ ...previous, ...patch }));

  const changeRole = (next: UserRole): void => {
    if (next === values.role) return;
    // §7.4: the confirm appears only when an already chosen area would be lost.
    if (values.laboratoryId !== "" || values.productAreaId !== "" || values.territoryId !== "") {
      setPendingRole(next);
      return;
    }
    applyRole(next);
  };

  const applyRole = (next: UserRole): void => {
    setPendingRole(null);
    setErrors({});
    setFormError("");
    set({ role: next, laboratoryId: "", productAreaId: "", territoryId: "" });
  };

  const focusFirstError = (): void => {
    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.focus();
  };

  const validate = (): Record<string, string> | null => {
    const found: Record<string, string> = {};
    if (values.fullName.trim() === "") found.full_name = "Укажите ФИО.";
    if (values.login.trim() === "") found.login = "Укажите логин.";
    if (values.password.length < 12 || values.password.length > 128)
      found.password = "Пароль — от 12 до 128 символов.";
    if (values.confirmation === "") found.confirmation = "Повторите пароль пользователя.";
    else if (values.confirmation !== values.password) found.confirmation = "Пароли не совпадают.";
    if (values.email.trim() === "" || !values.email.includes("@")) found.email = "Укажите корректный email.";
    if (currentRole === null) found.role = "Роль недоступна для делегирования.";
    else if (values.role === "ADMIN") {
      if (values.territoryId === "") found.territory = "Выберите территорию назначения.";
    } else if (values.laboratoryId === "") found.laboratory = "Выберите лабораторию.";
    if (values.role === "VET" && values.productAreaId === "") found.product = "Выберите тип продукции.";
    return Object.keys(found).length > 0 ? found : null;
  };

  const buildPayload = (): UserCreatePayload => {
    const scopes: { laboratory_id: string; product_scope_id?: string }[] =
      values.role === "ADMIN"
        ? []
        : [
            {
              laboratory_id: values.laboratoryId,
              ...(values.role === "VET" ? { product_scope_id: values.productAreaId } : {}),
            },
          ];
    return {
      full_name: values.fullName.trim(),
      login: values.login.trim(),
      email: values.email.trim(),
      position: values.position.trim() === "" ? null : values.position.trim(),
      role: values.role,
      scopes,
      password: values.password,
      confirmation: values.confirmation,
      territory_id: values.role === "ADMIN" ? values.territoryId : undefined,
    };
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    const clientErrors = validate();
    if (clientErrors !== null) {
      setErrors(clientErrors);
      setFormError("Проверьте обязательные поля.");
      focusFirstError();
      return;
    }
    setErrors({});
    setFormError("");
    setSubmitting(true);
    // One key per user intent (DR34 §9): the same key survives a retry of the
    // unchanged input; a new edit starts a new intent with a new key.
    if (intentKey.current === null) {
      intentKey.current = crypto.randomUUID();
    }
    const problem = await onSubmit(buildPayload(), intentKey.current);
    setSubmitting(false);
    if (problem === null) {
      // The secret never outlives the submit (ТЗ-02).
      intentKey.current = null;
      set(emptySecrets());
      return;
    }
    failedIntent.current = true;
    const serverErrors: Record<string, string> = {};
    for (const [path, message] of Object.entries(problemFieldErrors(problem))) {
      if (path.startsWith("scopes")) {
        serverErrors.access = message;
      } else if (path === "territory_id") {
        serverErrors.territory = message;
      } else {
        serverErrors[path] = message;
      }
    }
    if (problem.code === "ALREADY_EXISTS" && serverErrors.login === undefined) {
      serverErrors.login = "Такой логин уже занят.";
    }
    if (problem.code === "ACCESS_DENIED") {
      // §10: a 403 never discloses foreign areas; the honest Russian message
      // replaces the generic detail.
      serverErrors.access = "Недостаточно прав для создания пользователя.";
    }
    const bound = Object.keys(serverErrors).length > 0;
    setErrors(serverErrors);
    setFormError(
      problem.detail !== "" ? problem.detail : "Не удалось создать пользователя. Повторите попытку.",
    );
    if (!bound && problem.detail === "") {
      setFormError("Не удалось создать пользователя. Повторите попытку.");
    }
    focusFirstError();
  };

  const accessHint = (): string => {
    if (optionsLoading) return "Загрузка вариантов доступа…";
    if (roles.length === 0) return "Делегирование не настроено: роли не назначены.";
    if (values.role === "ADMIN") return "Администратору назначается территория, без рабочих данных.";
    if (values.role === "HEAD") return "Заведующему назначается ровно одна лаборатория.";
    if (values.role === "ANALYST") return "Аналитику назначается одна лаборатория выбранной области.";
    return "Ветеринарному врачу назначаются лаборатория и тип продукции.";
  };

  const selectError = errors.access ?? "";

  return (
    <form className="vse-user-create" onSubmit={submit} noValidate ref={formRef}>
      {formError !== "" ? (
        <div className="vse-create-error" role="alert">
          {formError}
        </div>
      ) : null}

      <section className="vse-create-card" aria-labelledby="create-basic-title">
        <h2 id="create-basic-title">Основные сведения</h2>
        <p className="vse-create-card-note">
          Данные для учётной записи и входа пользователя. * — обязательное поле.
        </p>
        <div className="vse-create-grid">
          <div className="vse-create-wide">
            <Field
              id="create-full-name"
              label="ФИО *"
              value={values.fullName}
              onChange={(value) => set({ fullName: value })}
              autoComplete="name"
              disabled={pending}
              error={errors.full_name ?? ""}
            />
          </div>
          <Field
            id="create-login"
            label="Логин *"
            value={values.login}
            onChange={(value) => set({ login: value })}
            autoComplete="username"
            disabled={pending}
            hint="Логин должен быть уникальным; вход выполняется по нему."
            error={errors.login ?? ""}
          />
          <Field
            id="create-password"
            label="Пароль *"
            type="password"
            value={values.password}
            onChange={(value) => set({ password: value })}
            autoComplete="new-password"
            disabled={pending}
            hint="От 12 до 128 символов."
            error={errors.password ?? ""}
          />
          <Field
            id="create-password-repeat"
            label="Повторите пароль *"
            type="password"
            value={values.confirmation}
            onChange={(value) => set({ confirmation: value })}
            autoComplete="new-password"
            disabled={pending}
            error={errors.confirmation ?? ""}
          />
          <Field
            id="create-email"
            label="Email *"
            type="email"
            value={values.email}
            onChange={(value) => set({ email: value })}
            autoComplete="email"
            disabled={pending}
            hint="Служит контактом для связи; вход выполняется по логину и паролю."
            error={errors.email ?? ""}
          />
          <Field
            id="create-position"
            label="Должность"
            value={values.position}
            onChange={(value) => set({ position: value })}
            autoComplete="organization-title"
            disabled={pending}
            error={errors.position ?? ""}
          />
        </div>
      </section>

      <section className="vse-create-card" aria-labelledby="create-access-title">
        <h2 id="create-access-title">Доступ пользователя</h2>
        <p className="vse-create-card-note">Роль и область назначения. Варианты определяет сервер.</p>
        <div className="vse-create-grid">
          <div className="app-field vse-create-select">
            <div className="app-field-heading">
              <label htmlFor="create-role">Роль *</label>
            </div>
            <select
              id="create-role"
              value={values.role}
              disabled={pending || optionsLoading || roles.length === 0}
              aria-invalid={errors.role !== undefined ? "true" : undefined}
              aria-describedby={errors.role !== undefined ? "create-role-error" : undefined}
              onChange={(event) => changeRole(event.target.value as UserRole)}
            >
              {roles.map((item) => (
                <option key={item.role} value={item.role}>
                  {item.label}
                </option>
              ))}
            </select>
            {errors.role !== undefined ? (
              <p className="app-field-message app-field-error" id="create-role-error" role="alert">
                {errors.role}
              </p>
            ) : null}
          </div>
          <p className="vse-create-access-hint">{accessHint()}</p>

          {values.role !== "ADMIN" ? (
            <div className="app-field vse-create-select">
              <div className="app-field-heading">
                <label htmlFor="create-laboratory">Лаборатория *</label>
              </div>
              <select
                id="create-laboratory"
                value={values.laboratoryId}
                disabled={pending || optionsLoading || currentRole === null}
                aria-invalid={errors.laboratory !== undefined ? "true" : undefined}
                aria-describedby={errors.laboratory !== undefined ? "create-laboratory-error" : undefined}
                onChange={(event) => set({ laboratoryId: event.target.value })}
              >
                <option value="">Выберите лабораторию…</option>
                {(currentRole?.laboratories ?? []).map((item) => (
                  <option key={item.laboratory_id} value={item.laboratory_id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {errors.laboratory !== undefined ? (
                <p className="app-field-message app-field-error" id="create-laboratory-error" role="alert">
                  {errors.laboratory}
                </p>
              ) : null}
            </div>
          ) : null}

          {values.role === "ADMIN" ? (
            <div className="app-field vse-create-select">
              <div className="app-field-heading">
                <label htmlFor="create-territory">Территория назначения *</label>
              </div>
              <select
                id="create-territory"
                value={values.territoryId}
                disabled={pending || optionsLoading || currentRole === null}
                aria-invalid={errors.territory !== undefined ? "true" : undefined}
                aria-describedby={errors.territory !== undefined ? "create-territory-error" : undefined}
                onChange={(event) => set({ territoryId: event.target.value })}
              >
                <option value="">Выберите территорию…</option>
                {(currentRole?.territories ?? []).map((item) => (
                  <option key={item.territory_id} value={item.territory_id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {errors.territory !== undefined ? (
                <p className="app-field-message app-field-error" id="create-territory-error" role="alert">
                  {errors.territory}
                </p>
              ) : null}
            </div>
          ) : null}

          {values.role === "VET" ? (
            <div className="app-field vse-create-select">
              <div className="app-field-heading">
                <label htmlFor="create-product">Тип продукции *</label>
              </div>
              <select
                id="create-product"
                value={values.productAreaId}
                disabled={pending || optionsLoading || currentRole === null}
                aria-invalid={errors.product !== undefined ? "true" : undefined}
                aria-describedby={errors.product !== undefined ? "create-product-error" : undefined}
                onChange={(event) => set({ productAreaId: event.target.value })}
              >
                <option value="">Выберите тип продукции…</option>
                {(currentRole?.product_areas ?? []).map((item) => (
                  <option key={item.product_area_id} value={item.product_area_id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {errors.product !== undefined ? (
                <p className="app-field-message app-field-error" id="create-product-error" role="alert">
                  {errors.product}
                </p>
              ) : null}
            </div>
          ) : null}

          {selectError !== "" ? (
            <p className="app-field-message app-field-error vse-create-wide" role="alert">
              {selectError}
            </p>
          ) : null}
          {options === null && !optionsLoading ? (
            <p className="app-field-message vse-create-wide">
              Варианты доступа недоступны. Обновите страницу и повторите попытку.
            </p>
          ) : null}
        </div>
      </section>

      <div className="vse-create-actions">
        <Button onClick={onCancel} disabled={pending}>
          Отмена
        </Button>
        <Button type="submit" variant="primary" icon="admin-user-add" busy={pending} busyLabel="Создаём…">
          Создать пользователя
        </Button>
      </div>

      {/* §7.4/§11: a role switch that would lose the chosen area asks first. */}
      <Dialog
        open={pendingRole !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRole(null);
        }}
        title="Изменить роль пользователя?"
        description="Выбранные лаборатория и тип продукции будут сброшены. Продолжить?"
        confirmLabel="Изменить"
        cancelLabel="Оставить"
        onConfirm={() => {
          if (pendingRole !== null) applyRole(pendingRole);
        }}
      />
    </form>
  );
}

function emptySecrets(): Partial<Values> {
  return { password: "", confirmation: "" };
}

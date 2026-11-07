/**
 * CHECK service editor dialog (Task C02, API-03/INPUT-03): global
 * applicability/multiplier rule of the two CHECK services only; the two
 * services never mix with VSE pricing.
 */
import "./catalogs.css";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import type { Problem } from "../../shared/api/problem";
import { Button } from "../../shared/ui/Button";
import { createCheckService, updateCheckService, type CheckServiceRuleView } from "./api";
import { problemFieldErrors } from "./common";

export const SERVICE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  PRODUCT_IDENTIFICATION: "Идентификация продукции",
  TRANSPORT_INSPECTION: "Осмотр транспортного средства",
});

export const BASIS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ACCEPTED_QUANTITY: "Принятое количество",
  DELIVERED_QUANTITY: "Доставленное количество",
  ONE_SERVICE: "Одна услуга",
});

export const DECISIONS = ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"] as const;

export const DECISION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ACCEPT_ALL: "Полное гашение",
  PARTIAL: "Частичное гашение",
  RETURN_ALL: "Полный возврат",
});

export const checkServiceSchema = z.object({
  service_code: z.enum(["PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION"]),
  unit_id: z.string().trim().min(1, "Укажите единицу измерения."),
  multiplier_basis: z.enum(["ACCEPTED_QUANTITY", "DELIVERED_QUANTITY", "ONE_SERVICE"]),
  applicable_decisions: z
    .array(z.enum(DECISIONS))
    .min(1, "Отметьте хотя бы одно применимое решение о приёмке."),
  version: z
    .string()
    .trim()
    .refine((value) => /^\d+$/.test(value) && Number(value) >= 1, "Версия — целое число ≥ 1."),
  source_name: z.string().trim().min(1, "Укажите источник правила."),
});

export type CheckServiceValues = z.infer<typeof checkServiceSchema>;

export function checkServiceDefaults(rule?: CheckServiceRuleView | null): CheckServiceValues {
  return {
    service_code:
      (rule?.service_code as CheckServiceValues["service_code"] | undefined) ?? "PRODUCT_IDENTIFICATION",
    unit_id: rule?.unit_id ?? "",
    multiplier_basis: (rule?.multiplier_basis as CheckServiceValues["multiplier_basis"]) ?? "ONE_SERVICE",
    applicable_decisions: (rule?.applicable_decisions as CheckServiceValues["applicable_decisions"]) ?? [
      "ACCEPT_ALL",
    ],
    version: String(rule?.version ?? 1),
    source_name: typeof rule?.source.name === "string" ? rule.source.name : "",
  };
}

export interface CheckServiceEditorProps {
  mode: "create" | "edit";
  rule?: CheckServiceRuleView | null;
  busy?: boolean | undefined;
  onSaved: (rule: CheckServiceRuleView) => void;
  onClose: () => void;
}

export function CheckServiceEditor({
  mode,
  rule,
  busy = false,
  onSaved,
  onClose,
}: CheckServiceEditorProps): React.ReactElement {
  const defaults = checkServiceDefaults(rule);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CheckServiceValues>({ defaultValues: defaults });
  const [formError, setFormError] = useState("");
  const pending = isSubmitting || busy;

  const payload = (values: CheckServiceValues): Parameters<typeof createCheckService>[0] => ({
    service_code: values.service_code,
    unit_id: values.unit_id,
    multiplier_basis: values.multiplier_basis,
    applicable_decisions: values.applicable_decisions,
    version: Number(values.version),
    source: { name: values.source_name },
  });

  function applyProblem(problem: Problem): void {
    let bound = false;
    for (const [path, message] of Object.entries(problemFieldErrors(problem))) {
      const formPath = path.replace(/^body\./, "").replace(/\.source\./, ".");
      setError(formPath as keyof CheckServiceValues as never, { message });
      bound = true;
    }
    setFormError(
      bound ? problem.detail : problem.detail !== "" ? problem.detail : "Не удалось сохранить правило.",
    );
  }

  const submit = handleSubmit(async (values) => {
    setFormError("");
    if (mode === "create") {
      const result = await createCheckService(payload(values), crypto.randomUUID());
      if ("code" in result) {
        applyProblem(result);
        return;
      }
      onSaved(result.rule);
      onClose();
      return;
    }
    if (rule === undefined || rule === null) return;
    const result = await updateCheckService(rule.id, payload(values), `"${rule.revision}"`);
    if ("code" in result) {
      applyProblem(result);
      return;
    }
    onSaved(result.rule);
    onClose();
  });

  return (
    <form className="vse-auth-form vse-catalog-editor" onSubmit={submit} noValidate>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="check-service-code">Услуга сверки</label>
        </div>
        <select id="check-service-code" disabled={pending || mode === "edit"} {...register("service_code")}>
          {Object.entries(SERVICE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="check-unit">Единица измерения</label>
        </div>
        <input id="check-unit" type="text" disabled={pending} {...register("unit_id")} />
        {errors.unit_id !== undefined ? (
          <p className="app-field-message app-field-error" role="alert">
            {errors.unit_id.message}
          </p>
        ) : null}
      </div>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="check-basis">База начисления</label>
        </div>
        <select id="check-basis" disabled={pending} {...register("multiplier_basis")}>
          {Object.entries(BASIS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="app-field vse-check-row">
        <legend>Применимые решения о приёмке</legend>
        {DECISIONS.map((decision) => (
          <label key={decision}>
            <input
              type="checkbox"
              value={decision}
              disabled={pending}
              {...register("applicable_decisions")}
            />{" "}
            {DECISION_LABELS[decision]}
          </label>
        ))}
      </fieldset>
      {errors.applicable_decisions !== undefined ? (
        <p className="app-field-message app-field-error" role="alert">
          {errors.applicable_decisions.message}
        </p>
      ) : null}
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="check-version">Версия</label>
        </div>
        <input id="check-version" type="text" disabled={pending} {...register("version")} />
        {errors.version !== undefined ? (
          <p className="app-field-message app-field-error" role="alert">
            {errors.version.message}
          </p>
        ) : null}
      </div>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="check-source">Источник правила</label>
        </div>
        <input
          id="check-source"
          type="text"
          disabled={pending}
          aria-invalid={errors.source_name !== undefined ? "true" : undefined}
          {...register("source_name")}
        />
        {errors.source_name !== undefined ? (
          <p className="app-field-message app-field-error" role="alert">
            {errors.source_name.message}
          </p>
        ) : null}
      </div>
      {formError !== "" ? (
        <p className="app-dialog-error" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="vse-auth-actions">
        <Button type="submit" variant="primary" busy={pending} busyLabel="Сохранение…">
          Сохранить
        </Button>
        <Button type="button" onClick={() => onClose()} disabled={pending}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

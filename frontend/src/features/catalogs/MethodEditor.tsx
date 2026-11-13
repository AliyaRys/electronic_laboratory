/**
 * Method rule editor dialog (Task C02, API-03/INPUT-02).
 *
 * Create/edit use If-Match of the target record; delete shows the acceptance
 * warning: removing an ACTIVE rule blocks future saves (a new result cannot be
 * priced), while the old snapshot stays as saved — it is never recalculated.
 */
import "./catalogs.css";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import type { Problem } from "../../shared/api/problem";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import {
  createMethod,
  deleteMethod,
  typedMethodRule,
  updateMethod,
  type CatalogIndicator,
  type MethodRuleTyped,
} from "./api";
import { isUuid, problemFieldErrors } from "./common";

export const RESULT_SCHEMAS = [
  "DECIMAL",
  "INTEGER_NONNEGATIVE",
  "BOOLEAN_MATCH",
  "ENUM",
  "TEXT",
  "DOSIMETRY_PAIR",
] as const;

export const RESULT_SCHEMA_LABELS: Readonly<Record<string, string>> = Object.freeze({
  DECIMAL: "Число",
  INTEGER_NONNEGATIVE: "Целое неотрицательное",
  BOOLEAN_MATCH: "Соответствие да/нет",
  ENUM: "Перечисление",
  TEXT: "Текст",
  DOSIMETRY_PAIR: "Пара показаний дозиметрии",
});

const UUID_MESSAGE = "Укажите корректный UUID.";
const DECIMAL_MESSAGE = "Границы нормы — конечное число с точкой.";

export const methodEditorSchema = z
  .object({
    indicator_id: z
      .string()
      .trim()
      .refine((value) => isUuid(value), UUID_MESSAGE),
    product_state_id: z
      .string()
      .trim()
      .refine((value) => isUuid(value), UUID_MESSAGE),
    result_schema: z.enum(RESULT_SCHEMAS),
    unit_id: z.string().trim().min(1, "Укажите единицу измерения."),
    rule_type: z.enum(["interval", "qualitative"]),
    lower: z.string().trim(),
    upper: z.string().trim(),
    lower_inclusive: z.boolean(),
    upper_inclusive: z.boolean(),
    accepted_values: z.string().trim(),
    version: z
      .string()
      .trim()
      .refine((value) => /^\d+$/.test(value) && Number(value) >= 1, "Версия — целое число ≥ 1."),
    source_name: z.string().trim().min(1, "Укажите источник методики."),
    source_edition: z.string().trim(),
    source_reference: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    if (values.rule_type === "interval") {
      const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
      const lowerEmpty = values.lower === "";
      const upperEmpty = values.upper === "";
      if (!lowerEmpty && !number.test(values.lower)) {
        ctx.addIssue({ code: "custom", path: ["lower"], message: DECIMAL_MESSAGE });
      }
      if (!upperEmpty && !number.test(values.upper)) {
        ctx.addIssue({ code: "custom", path: ["upper"], message: DECIMAL_MESSAGE });
      }
      if (lowerEmpty && upperEmpty) {
        ctx.addIssue({ code: "custom", path: ["lower"], message: "Укажите хотя бы одну границу нормы." });
      }
      if (!lowerEmpty && !upperEmpty && Number(values.lower) > Number(values.upper)) {
        ctx.addIssue({
          code: "custom",
          path: ["upper"],
          message: "Нижняя граница должна быть не больше верхней.",
        });
      }
    } else if (values.accepted_values.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["accepted_values"],
        message: "Перечислите допустимые значения через запятую.",
      });
    }
  });

export type MethodEditorValues = z.infer<typeof methodEditorSchema>;

export function methodEditorDefaults(rule?: MethodRuleTyped | null): MethodEditorValues {
  const interval = rule?.rule.type === "interval" ? rule.rule : null;
  const qualitative = rule?.rule.type === "qualitative" ? rule.rule : null;
  const source = rule?.source ?? {};
  return {
    indicator_id: rule?.indicator_id ?? "",
    product_state_id: rule?.product_state_id ?? "",
    result_schema: (rule?.result_schema as MethodEditorValues["result_schema"]) ?? "DECIMAL",
    unit_id: rule?.unit_id ?? "",
    rule_type: qualitative !== null ? "qualitative" : "interval",
    lower: interval?.lower ?? "",
    upper: interval?.upper ?? "",
    lower_inclusive: interval?.lower_inclusive ?? true,
    upper_inclusive: interval?.upper_inclusive ?? true,
    accepted_values: qualitative ? qualitative.accepted_values.join(", ") : "",
    version: String(rule?.version ?? 1),
    source_name: typeof source.name === "string" ? source.name : "",
    source_edition: typeof source.edition === "string" ? source.edition : "",
    source_reference: typeof source.reference === "string" ? source.reference : "",
  };
}

export interface MethodEditorProps {
  mode: "create" | "edit";
  laboratoryId: string;
  productSpeciesId: string;
  /** The canonical VSE-F18–F29 registry of the scoped context (ТЗ-DR28 §6.2).
   * When provided in create mode the indicator is chosen by its Russian name
   * and code — a raw UUID input is never shown — and the real species/state
   * ids come from the resolved context pair (``productStateId``). */
  indicators?: readonly CatalogIndicator[] | undefined;
  productStateId?: string | undefined;
  rule?: MethodRuleTyped | null;
  busy?: boolean | undefined;
  onSaved: (rule: MethodRuleTyped) => void;
  onDeleted?: () => void | undefined;
  onClose: () => void;
}

/** The acceptance warning of deleting an ACTIVE rule (FT-CAL-05/07, ADR-020). */
export const DELETE_WARNING =
  "Удаление действующей нормы заблокирует сохранение будущих расчётов: новые результаты нельзя будет рассчитать. Старый снимок цен останется прежним — сохранённые расчёты не пересчитываются.";

export function MethodEditor({
  mode,
  laboratoryId,
  productSpeciesId,
  indicators,
  productStateId,
  rule,
  busy = false,
  onSaved,
  onDeleted,
  onClose,
}: MethodEditorProps): React.ReactElement {
  const defaults = methodEditorDefaults(rule);
  if (mode === "create" && productStateId !== undefined && productStateId !== "") {
    defaults.product_state_id = productStateId;
  }
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<MethodEditorValues>({ defaultValues: defaults });
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // RHF watch is the documented way to read a select's live value for
  // conditional fields; the compiler hint is a memoization warning only.
  // eslint-disable-next-line react-hooks/incompatible-library
  const ruleType = watch("rule_type");
  const pending = isSubmitting || busy || deleteBusy;
  // Registry-driven create mode (§6.2): the user picks a named indicator, the
  // canonical result schema/unit follow it and no UUID input appears.
  const withRegistry = mode === "create" && indicators !== undefined && indicators.length > 0;
  const indicatorId = watch("indicator_id");
  const definition =
    withRegistry && isUuid(indicatorId ?? "")
      ? indicators?.find((item) => item.id === indicatorId)
      : undefined;

  useEffect(() => {
    if (definition === undefined) return;
    // The canonical definition owns the type/unit of the norm (§6.2): the
    // editor derives them instead of asking the user to retype them.
    setValue("result_schema", definition.result_schema as MethodEditorValues["result_schema"]);
    setValue("unit_id", definition.unit_id ?? "");
    const interval = ["DECIMAL", "INTEGER_NONNEGATIVE", "DOSIMETRY_PAIR"].includes(definition.result_schema);
    setValue("rule_type", interval ? "interval" : "qualitative");
    if (!interval) {
      const options = definition.options ?? [];
      if (options.length > 0) setValue("accepted_values", options.join(", "));
    }
  }, [definition, setValue]);

  const payload = (values: MethodEditorValues): Parameters<typeof createMethod>[0] => ({
    laboratory_id: laboratoryId,
    product_species_id: productSpeciesId,
    indicator_id: values.indicator_id.trim(),
    product_state_id:
      mode === "create" && productStateId !== undefined && productStateId !== ""
        ? productStateId
        : values.product_state_id.trim(),
    result_schema: values.result_schema,
    unit_id: values.unit_id.trim(),
    version: Number(values.version),
    rule:
      values.rule_type === "interval"
        ? {
            type: "interval",
            ...(values.lower !== "" ? { lower: values.lower } : {}),
            ...(values.upper !== "" ? { upper: values.upper } : {}),
            lower_inclusive: values.lower_inclusive,
            upper_inclusive: values.upper_inclusive,
          }
        : {
            type: "qualitative",
            accepted_values: values.accepted_values
              .split(",")
              .map((item) => item.trim())
              .filter((item) => item !== ""),
          },
    source: {
      name: values.source_name,
      ...(values.source_edition !== "" ? { edition: values.source_edition } : {}),
      ...(values.source_reference !== "" ? { reference: values.source_reference } : {}),
    },
  });

  function applyProblem(problem: Problem): void {
    let bound = false;
    for (const [path, message] of Object.entries(problemFieldErrors(problem))) {
      const formPath = path.replace(/^body\./, "").replace(/\.(rule|source)\./, ".");
      setError(formPath as keyof MethodEditorValues as never, { message });
      bound = true;
    }
    setFormError(
      bound ? problem.detail : problem.detail !== "" ? problem.detail : "Не удалось сохранить норму.",
    );
  }

  const submit = handleSubmit(async (values) => {
    setFormError("");
    if (mode === "create") {
      const result = await createMethod(payload(values), crypto.randomUUID());
      if ("code" in result) {
        applyProblem(result);
        return;
      }
      onSaved(typedMethodRule(result.rule));
      onClose();
      return;
    }
    if (rule === undefined || rule === null) return;
    const result = await updateMethod(rule.id, payload(values), `"${rule.revision}"`);
    if ("code" in result) {
      applyProblem(result);
      return;
    }
    onSaved(typedMethodRule(result.rule));
    onClose();
  });

  const runDelete = async (): Promise<void> => {
    if (rule === null || rule === undefined || onDeleted === undefined) return;
    setDeleteBusy(true);
    const problem = await deleteMethod(rule.id, `"${rule.revision}"`, crypto.randomUUID());
    setDeleteBusy(false);
    if (problem !== null) {
      setConfirmDelete(false);
      setFormError(problem.detail !== "" ? problem.detail : "Не удалось удалить норму.");
      return;
    }
    onDeleted();
    onClose();
  };

  return (
    <>
      <form className="vse-auth-form vse-catalog-editor" onSubmit={submit} noValidate>
        {mode === "create" ? (
          withRegistry ? (
            <>
              <div className="app-field">
                <div className="app-field-heading">
                  <label htmlFor="method-indicator">Показатель</label>
                </div>
                <select
                  id="method-indicator"
                  disabled={pending}
                  aria-invalid={errors.indicator_id !== undefined ? "true" : undefined}
                  {...register("indicator_id")}
                >
                  <option value="">— выберите показатель —</option>
                  {indicators?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </select>
                {errors.indicator_id !== undefined ? (
                  <p className="app-field-message app-field-error" role="alert">
                    {errors.indicator_id.message}
                  </p>
                ) : null}
              </div>
              <p className="vse-catalog-note" data-testid="method-scope-hint">
                Вид и состояние продукции берутся из рабочей области справочника.
              </p>
            </>
          ) : (
            <>
              <div className="app-field">
                <div className="app-field-heading">
                  <label htmlFor="method-indicator">Показатель (UUID)</label>
                </div>
                <input
                  id="method-indicator"
                  type="text"
                  disabled={pending}
                  aria-invalid={errors.indicator_id !== undefined ? "true" : undefined}
                  {...register("indicator_id")}
                />
                {errors.indicator_id !== undefined ? (
                  <p className="app-field-message app-field-error" role="alert">
                    {errors.indicator_id.message}
                  </p>
                ) : null}
              </div>
              <div className="app-field">
                <div className="app-field-heading">
                  <label htmlFor="method-state">Состояние продукции (UUID)</label>
                </div>
                <input
                  id="method-state"
                  type="text"
                  disabled={pending}
                  aria-invalid={errors.product_state_id !== undefined ? "true" : undefined}
                  {...register("product_state_id")}
                />
                {errors.product_state_id !== undefined ? (
                  <p className="app-field-message app-field-error" role="alert">
                    {errors.product_state_id.message}
                  </p>
                ) : null}
              </div>
            </>
          )
        ) : null}
        {withRegistry && definition !== undefined ? (
          <p className="vse-catalog-note" data-testid="method-definition-hint">
            Тип результата и единица измерения заданы каноническим определением показателя.
          </p>
        ) : null}
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="method-result-schema">Тип результата</label>
          </div>
          <select id="method-result-schema" disabled={pending || withRegistry} {...register("result_schema")}>
            {RESULT_SCHEMAS.map((value) => (
              <option key={value} value={value}>
                {RESULT_SCHEMA_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="method-unit">Единица измерения нормы</label>
          </div>
          <input id="method-unit" type="text" disabled={pending || withRegistry} {...register("unit_id")} />
          {errors.unit_id !== undefined ? (
            <p className="app-field-message app-field-error" role="alert">
              {errors.unit_id.message}
            </p>
          ) : null}
        </div>
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="method-rule-type">Тип нормы</label>
          </div>
          <select id="method-rule-type" disabled={pending || withRegistry} {...register("rule_type")}>
            <option value="interval">Интервал</option>
            <option value="qualitative">Допустимые значения</option>
          </select>
        </div>
        {ruleType === "interval" ? (
          <>
            <div className="app-field">
              <div className="app-field-heading">
                <label htmlFor="method-lower">Нижняя граница</label>
              </div>
              <input id="method-lower" type="text" disabled={pending} {...register("lower")} />
            </div>
            <div className="app-field">
              <div className="app-field-heading">
                <label htmlFor="method-upper">Верхняя граница</label>
              </div>
              <input id="method-upper" type="text" disabled={pending} {...register("upper")} />
            </div>
            {errors.lower !== undefined ? (
              <p className="app-field-message app-field-error" role="alert">
                {errors.lower.message}
              </p>
            ) : null}
            {errors.upper !== undefined ? (
              <p className="app-field-message app-field-error" role="alert">
                {errors.upper.message}
              </p>
            ) : null}
            <div className="app-field vse-check-row">
              <label>
                <input type="checkbox" disabled={pending} {...register("lower_inclusive")} /> нижняя граница
                включена
              </label>
              <label>
                <input type="checkbox" disabled={pending} {...register("upper_inclusive")} /> верхняя граница
                включена
              </label>
            </div>
          </>
        ) : (
          <>
            <div className="app-field">
              <div className="app-field-heading">
                <label htmlFor="method-accepted">Допустимые значения (через запятую)</label>
              </div>
              <input id="method-accepted" type="text" disabled={pending} {...register("accepted_values")} />
              {errors.accepted_values !== undefined ? (
                <p className="app-field-message app-field-error" role="alert">
                  {errors.accepted_values.message}
                </p>
              ) : null}
            </div>
          </>
        )}
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="method-version">Версия</label>
          </div>
          <input id="method-version" type="text" disabled={pending} {...register("version")} />
          {errors.version !== undefined ? (
            <p className="app-field-message app-field-error" role="alert">
              {errors.version.message}
            </p>
          ) : null}
        </div>
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="method-source-name">Источник методики</label>
          </div>
          <input id="method-source-name" type="text" disabled={pending} {...register("source_name")} />
          {errors.source_name !== undefined ? (
            <p className="app-field-message app-field-error" role="alert">
              {errors.source_name.message}
            </p>
          ) : null}
        </div>
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="method-source-edition">Редакция источника</label>
          </div>
          <input id="method-source-edition" type="text" disabled={pending} {...register("source_edition")} />
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
          {mode === "edit" ? (
            <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)} disabled={pending}>
              Удалить
            </Button>
          ) : null}
        </div>
      </form>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить действующую норму?"
        description={DELETE_WARNING}
        confirmLabel="Удалить норму"
        danger
        busy={deleteBusy}
        onConfirm={() => void runDelete()}
      />
    </>
  );
}

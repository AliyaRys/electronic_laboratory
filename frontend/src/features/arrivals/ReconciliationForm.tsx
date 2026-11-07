/**
 * ReconciliationForm (A02, FT-ARR-02/03): the composed CHK screen in the
 * fixed block order (документ → участники → транспорт → продукция →
 * сопроводительные → прежняя ВСЭ → результаты → стоимость). RHF + zod
 * validation at submit (the catalog-editor pattern); the save command runs
 * through ``useCommand`` so a conflict offers the actual state (never merges)
 * and a network error never loses the entered input. The started
 * reconciliation may be incomplete: it is saved separately and the completion
 * belongs to the external receipt (ТЗ-11).
 */
import "./arrivals.css";
import { z } from "zod";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useDirtyGuard } from "../context/SwitchContext";
import { useCommand } from "../../shared/api/command";
import type { Problem } from "../../shared/api/problem";
import { Button } from "../../shared/ui/Button";
import { Field } from "../../shared/ui/Field";
import { StatusView } from "../../shared/ui/StatusView";
import {
  comparedFields,
  computeAllowedDecisions,
  decisionLabel,
  previousVse,
  saveReconciliation,
  revisionEtag,
  type Decision,
  type IncomingView,
  type ReceiptProblemItem,
  type ReconciliationView,
  type ReconciliationWrite,
} from "./api";
import { ComparisonField, type ComparisonValue } from "./ComparisonField";
import { ActPreview } from "./ActPreview";
import { ReceiptDecision } from "./ReceiptDecision";

/** The field-level server errors of one validation problem (A02). */
function problemItemsOf(problem: Problem | null): ReceiptProblemItem[] {
  if (problem === null || problem.code !== "VALIDATION_ERROR") {
    return [];
  }
  return (problem as unknown as { errors?: ReceiptProblemItem[] }).errors ?? [];
}

export interface ReconciliationFormProps {
  party: IncomingView;
  initial: ReconciliationView;
  onSaved: (view: ReconciliationView) => void;
}

const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

const formSchema = z.object({
  decision: z.enum(["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"]).nullable(),
  compartment: z.enum(["COMPLIANT", "DIRTY_OR_DAMAGED"]).nullable(),
  joint_carriage: z.enum(["NONE", "SEPARATED", "NOT_SEPARATED"]).nullable(),
  repeat_required: z.boolean().nullable(),
  repeat_reason: z.string(),
  repeat_act_number: z.string(),
  delivered: z.object({
    mass_kg: z.string().regex(DECIMAL, "Вес — неотрицательное десятичное число."),
    quantity: z.string().regex(DECIMAL, "Количество — неотрицательное десятичное число."),
    unit_id: z.string(),
  }),
  accepted: z.object({
    mass_kg: z.string().regex(DECIMAL, "Вес — неотрицательное десятичное число."),
    quantity: z.string().regex(DECIMAL, "Количество — неотрицательное десятичное число."),
    unit_id: z.string(),
  }),
  returned: z.object({
    mass_kg: z.string().regex(DECIMAL, "Вес — неотрицательное десятичное число."),
    quantity: z.string().regex(DECIMAL, "Количество — неотрицательное десятичное число."),
    unit_id: z.string(),
  }),
  return_reason_code: z.string(),
  return_reason_text: z.string(),
  transaction_planned: z.boolean().nullable(),
  transaction_type: z.enum(["INTERNAL", "EXTERNAL"]).nullable(),
  fair: z.boolean(),
  comparisons: z.record(
    z.string(),
    z.object({ matches: z.boolean().nullable(), actual: z.string(), reason: z.string() }),
  ),
});

export type FormValues = z.infer<typeof formSchema>;

function fromComparison(value: ReconciliationView["checks"][string]): ComparisonValue {
  return {
    matches: value.matches ?? null,
    actual: value.actual === null || value.actual === undefined ? "" : String(value.actual),
    reason: value.reason ?? "",
  };
}

export function initialValues(party: IncomingView, initial: ReconciliationView): FormValues {
  const comparisons: Record<string, ComparisonValue> = {};
  for (const field of comparedFields(party)) {
    const saved = initial.checks[field.fieldId];
    comparisons[field.fieldId] =
      saved !== undefined ? fromComparison(saved) : { matches: null, actual: "", reason: "" };
  }
  return {
    decision: initial.decision,
    compartment: initial.inspection.compartment ?? null,
    joint_carriage: initial.inspection.jointCarriage ?? null,
    delivered: { ...initial.delivered },
    accepted: { ...initial.accepted },
    returned: { ...initial.returned },
    return_reason_code: initial.return_reason?.code ?? "",
    return_reason_text: initial.return_reason?.text ?? "",
    repeat_required: initial.repeat?.required ?? null,
    repeat_reason: initial.repeat?.reason ?? "",
    repeat_act_number: initial.repeat?.actNumber ?? "",
    transaction_planned: initial.transaction.planned ?? null,
    transaction_type: initial.transaction.type ?? null,
    fair: initial.fair,
    comparisons,
  };
}

function toPayload(values: FormValues, party: IncomingView): ReconciliationWrite {
  const checks: ReconciliationWrite["checks"] = {};
  for (const field of comparedFields(party)) {
    const saved = values.comparisons[field.fieldId];
    if (saved === undefined || saved.matches === null) {
      continue;
    }
    checks[field.fieldId] = {
      matches: saved.matches,
      ...(saved.matches === false && saved.actual !== "" ? { actual: saved.actual } : {}),
      ...(saved.reason !== "" ? { reason: saved.reason } : {}),
    };
  }
  // CHK-F36–38: the repeat selection exists only when the source carries a
  // previous ВСЭ; without one the answer is a new local ВСЭ (no fictitious
  // selection is ever sent, FT-ARR-11).
  const previous = previousVse(party);
  const repeat: ReconciliationWrite["repeat"] =
    previous !== null
      ? {
          required: values.repeat_required === true,
          ...(values.repeat_required === true
            ? {
                reason: values.repeat_reason === "" ? null : values.repeat_reason,
                actNumber: values.repeat_act_number === "" ? null : values.repeat_act_number,
              }
            : {}),
        }
      : null;
  return {
    checks,
    inspection: { compartment: values.compartment, jointCarriage: values.joint_carriage },
    delivered: values.delivered,
    accepted: values.accepted,
    returned: values.returned,
    decision: values.decision,
    returnReason:
      values.decision === "PARTIAL" || values.decision === "RETURN_ALL"
        ? values.return_reason_code === ""
          ? null
          : {
              code: values.return_reason_code,
              ...(values.return_reason_code === "OTHER_REASON" && values.return_reason_text !== ""
                ? { text: values.return_reason_text }
                : {}),
            }
        : null,
    repeat,
    transaction: {
      planned: values.transaction_planned,
      type: values.transaction_planned === true ? values.transaction_type : null,
    },
    fair: values.fair,
    services: [],
  };
}

export function ReconciliationForm({ party, initial, onSaved }: ReconciliationFormProps): React.ReactElement {
  const compared = useMemo(() => comparedFields(party), [party]);
  const previous = useMemo(() => previousVse(party), [party]);
  const form = useForm<FormValues>({ defaultValues: initialValues(party, initial) });
  const values = useWatch({ control: form.control }) as FormValues;
  useDirtyGuard(form.formState.isDirty, "Сверка");
  const command = useCommand<ReconciliationView>();
  const [formError, setFormError] = useState("");

  const submit = form.handleSubmit((formValues) => {
    const parsed = formSchema.safeParse(formValues);
    if (!parsed.success) {
      setFormError("Проверьте введённые значения количеств и отметки.");
      return;
    }
    setFormError("");
    void command.submit(
      async (ctx) => {
        const result = await saveReconciliation(
          party.party_id,
          toPayload(formValues, party),
          revisionEtag(party),
        )(ctx);
        if (result.response.ok && result.data !== undefined) {
          // The server returned the saved view: publish it and refresh the
          // form state (dirty flag clears with the confirmed facts).
          onSaved(result.data);
          form.reset(initialValues(party, result.data));
        }
        return result;
      },
      { queryKey: [party.laboratory_id, party.party_id, "reconciliation"] },
    );
  });

  const decisionErrors: Record<string, string> = {};
  const problem = command.error;
  if (problem !== null && problem.code === "VALIDATION_ERROR") {
    const items =
      (problem as unknown as { errors?: { field_id?: string | null; message: string }[] }).errors ?? [];
    for (const item of items) {
      if (item.field_id === "CHK-F34") decisionErrors.decision = item.message;
      if (item.field_id === "CHK-F35" && item.message.includes("текст")) {
        decisionErrors.return_reason_text = item.message;
      }
    }
  }
  // The allowed decisions are recomputed from the CURRENT input (the same
  // rules the server applies); the server stays authoritative at save time
  // and any mismatch surfaces as its validation errors (FT-ARR-09).
  const allowed: Decision[] = computeAllowedDecisions(values.delivered, values.comparisons);
  const decision = values.decision;
  const actErrors: ReceiptProblemItem[] = problemItemsOf(problem);
  const comparisonValue = (fieldId: string): ComparisonValue =>
    values.comparisons[fieldId] ?? { matches: null, actual: "", reason: "" };
  const comparisonChange = (fieldId: string) => (next: ComparisonValue) =>
    form.setValue(`comparisons.${fieldId}`, next, { shouldDirty: true });

  return (
    <form className="vse-reconciliation-form" onSubmit={(event) => void submit(event)} noValidate>
      <section className="vse-check-block" aria-label="Документ">
        <h3>Документ</h3>
        <dl className="vse-check-info">
          <div>
            <dt>Номер эВСД</dt>
            <dd>{party.external.fields.documentNumber ?? "—"}</dd>
          </div>
          <div>
            <dt>Статус</dt>
            <dd>{party.external.status}</dd>
          </div>
        </dl>
      </section>

      {(["Участники перевозки", "Идентификация транспорта", "Идентификация продукции"] as const).map(
        (block) => (
          <section key={block} className="vse-check-block" aria-label={block}>
            <h3>{block}</h3>
            {compared
              .filter((field) => field.block === block)
              .map((field) => (
                <ComparisonField
                  key={field.fieldId}
                  fieldId={field.fieldId}
                  label={field.label}
                  block={field.block}
                  source={field.source}
                  value={comparisonValue(field.fieldId)}
                  onChange={comparisonChange(field.fieldId)}
                />
              ))}
            {block === "Идентификация транспорта" ? (
              <>
                <div className="app-field">
                  <div className="app-field-heading">
                    <label htmlFor="inspection-compartment">Состояние грузового отделения</label>
                  </div>
                  <select
                    id="inspection-compartment"
                    value={values.compartment ?? ""}
                    onChange={(event) =>
                      form.setValue(
                        "compartment",
                        (event.target.value === "" ? null : event.target.value) as FormValues["compartment"],
                        { shouldDirty: true },
                      )
                    }
                  >
                    <option value="">Не указано</option>
                    <option value="COMPLIANT">Без загрязнений и повреждений</option>
                    <option value="DIRTY_OR_DAMAGED">Есть загрязнения или повреждения</option>
                  </select>
                </div>
                <div className="app-field">
                  <div className="app-field-heading">
                    <label htmlFor="inspection-joint">Совместная перевозка с другими грузами</label>
                  </div>
                  <select
                    id="inspection-joint"
                    value={values.joint_carriage ?? ""}
                    onChange={(event) =>
                      form.setValue(
                        "joint_carriage",
                        (event.target.value === ""
                          ? null
                          : event.target.value) as FormValues["joint_carriage"],
                        { shouldDirty: true },
                      )
                    }
                  >
                    <option value="">Не указано</option>
                    <option value="NONE">Без других грузов</option>
                    <option value="SEPARATED">Совместная с разделением</option>
                    <option value="NOT_SEPARATED">Совместная без разделения</option>
                  </select>
                </div>
              </>
            ) : null}
            {block === "Идентификация продукции" ? (
              <div className="vse-quantities">
                {(["delivered", "accepted", "returned"] as const).map((part) => (
                  <div key={part} className="vse-quantities-part">
                    <p className="vse-quantities-title">
                      {{ delivered: "Доставлено", accepted: "Принято", returned: "Возвращается" }[part]}
                    </p>
                    <Field
                      label="Вес, кг"
                      value={values[part].mass_kg}
                      onChange={(next) => form.setValue(`${part}.mass_kg`, next, { shouldDirty: true })}
                    />
                    <Field
                      label="Количество"
                      value={values[part].quantity}
                      onChange={(next) => form.setValue(`${part}.quantity`, next, { shouldDirty: true })}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ),
      )}

      <section className="vse-check-block" aria-label="Сопроводительные документы">
        <h3>Сопроводительные документы</h3>
        <p className="vse-check-note">
          Сведения транспортного документа приходят из эВСД; отдельные серии и связанные документы не вводятся
          (FT-ARR-05).
        </p>
      </section>

      <section className="vse-check-block" aria-label="Прежняя ВСЭ">
        <h3>Прежняя ВСЭ</h3>
        {previous === null ? (
          <p className="vse-check-note">
            Сведений прежней ВСЭ в эВСД нет: по этой партии обязательна местная ВСЭ (без фиктивного выбора
            повторной).
          </p>
        ) : (
          <>
            <dl className="vse-check-info">
              {previous.stamp !== "" ? (
                <div>
                  <dt>Клеймо убойного пункта</dt>
                  <dd>{previous.stamp}</dd>
                </div>
              ) : null}
              <div>
                <dt>Номер экспертизы</dt>
                <dd>{previous.number || "—"}</dd>
              </div>
              <div>
                <dt>Дата проведения</dt>
                <dd>{previous.performedOn || "—"}</dd>
              </div>
              <div>
                <dt>Организация-оператор</dt>
                <dd>{previous.organization || "—"}</dd>
              </div>
              <div>
                <dt>Результат осмотра</dt>
                <dd>{previous.result || "—"}</dd>
              </div>
              {previous.conclusion !== "" ? (
                <div>
                  <dt>Заключение</dt>
                  <dd>{previous.conclusion}</dd>
                </div>
              ) : null}
            </dl>
            <fieldset className="vse-repeat">
              <legend>Необходимость повторного ВСЭ</legend>
              <label className="vse-comparison-mark">
                <input
                  type="radio"
                  name="repeat.required"
                  checked={values.repeat_required === true}
                  onChange={() => form.setValue("repeat_required", true, { shouldDirty: true })}
                />
                Требуется
              </label>
              <label className="vse-comparison-mark">
                <input
                  type="radio"
                  name="repeat.required"
                  checked={values.repeat_required === false}
                  onChange={() => form.setValue("repeat_required", false, { shouldDirty: true })}
                />
                Не требуется
              </label>
              {values.repeat_required === true ? (
                <div className="vse-repeat-inputs">
                  <Field
                    id="repeat-reason"
                    label="Основание для проведения повторной ВСЭ"
                    value={values.repeat_reason}
                    onChange={(next) => form.setValue("repeat_reason", next, { shouldDirty: true })}
                  />
                  <Field
                    id="repeat-act-number"
                    label="№ акта"
                    value={values.repeat_act_number}
                    onChange={(next) => form.setValue("repeat_act_number", next, { shouldDirty: true })}
                  />
                </div>
              ) : null}
            </fieldset>
          </>
        )}
      </section>

      <section className="vse-check-block" aria-label="Результаты">
        <h3>Результаты</h3>
        <ReceiptDecision
          value={{
            decision: values.decision,
            return_reason_code: values.return_reason_code,
            return_reason_text: values.return_reason_text,
            transaction_planned: values.transaction_planned,
            transaction_type: values.transaction_type,
            fair: values.fair,
          }}
          onChange={(next) => {
            form.setValue("decision", next.decision, { shouldDirty: true });
            form.setValue("return_reason_code", next.return_reason_code, { shouldDirty: true });
            form.setValue("return_reason_text", next.return_reason_text, { shouldDirty: true });
            form.setValue("transaction_planned", next.transaction_planned, { shouldDirty: true });
            form.setValue("transaction_type", next.transaction_type, { shouldDirty: true });
            form.setValue("fair", next.fair, { shouldDirty: true });
          }}
          allowed={allowed}
          errors={decisionErrors}
        />
      </section>

      <section className="vse-check-block" aria-label="Стоимость">
        <h3>Стоимость</h3>
        <p className="vse-check-note">
          Расчёт стоимости формируется сервером по принятому составу; ярмарка обнуляет платные услуги
          (CHK-F41).
        </p>
      </section>

      <ActPreview act={initial.act} decision={decision} problemItems={actErrors} />

      {formError !== "" ? <StatusView state="forbidden" title={formError} /> : null}

      {problem !== null && problem.code !== "VALIDATION_ERROR" ? (
        <StatusView
          state={
            problem.code === "REVISION_CONFLICT" || problem.code === "STATE_CONFLICT"
              ? "not-found"
              : "network-error"
          }
          title={
            problem.code === "REVISION_CONFLICT" || problem.code === "STATE_CONFLICT"
              ? "Сверка изменена или подтверждена другим пользователем."
              : "Не удалось сохранить сверку."
          }
          detail={problem.detail}
          trace={problem.trace_id !== "" ? `trace_id: ${problem.trace_id}` : undefined}
          onRetry={
            problem.code === "REVISION_CONFLICT" || problem.code === "STATE_CONFLICT"
              ? () => void command.refresh()
              : () => void command.retry()
          }
        />
      ) : null}
      {problem !== null && problem.code === "VALIDATION_ERROR" && decisionErrors.decision === undefined ? (
        <StatusView
          state="forbidden"
          title="Сервер вернул ошибки проверки."
          detail={problem.detail}
          trace={problem.trace_id !== "" ? `trace_id: ${problem.trace_id}` : undefined}
        />
      ) : null}

      <div className="vse-form-actions">
        <Button type="submit" variant="primary" disabled={command.status === "pending"}>
          {command.status === "pending" ? "Сохранение…" : "Сохранить сверку"}
        </Button>
        {initial.complete ? (
          <span className="vse-arrival-hint">
            Сверка заполнена полностью; отправка приёмки — следующим шагом.
          </span>
        ) : (
          <span className="vse-arrival-hint">
            Начатая сверка сохраняется и может быть неполной
            {decision !== null ? `; выбрано: ${decisionLabel(decision)}` : ""}.
          </span>
        )}
      </div>
    </form>
  );
}

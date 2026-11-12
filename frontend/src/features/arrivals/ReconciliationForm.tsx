/**
 * ReconciliationForm (A02, FT-ARR-02/03): the composed CHK screen aligned
 * with the approved evsd-check mockup — the fixed section order (документ →
 * участники → транспорт → продукция → сопроводительные → ранее проведённая
 * ВСЭ → результаты сверки → расчёт стоимости услуг), the comparison cards,
 * the sticky action panel and the linked discrepancy act. RHF + zod
 * validation at submit (the catalog-editor pattern); the save command runs
 * through ``useCommand`` so a conflict offers the actual state (never merges)
 * and a network error never loses the entered input. The started
 * reconciliation may be incomplete: it is saved separately and the completion
 * belongs to the external receipt (ТЗ-11).
 */
import "./reconciliation.css";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useDirtyGuard } from "../context/SwitchContext";
import { useCommand } from "../../shared/api/command";
import type { Problem } from "../../shared/api/problem";
import { Field } from "../../shared/ui/Field";
import { StatusView } from "../../shared/ui/StatusView";
import {
  CHECK_SECTION_DESCRIPTIONS,
  CHECK_SECTION_TITLES,
  comparedFields,
  computeAllowedDecisions,
  decisionLabel,
  documentFacts,
  hasSourceUnit,
  moneyLabel,
  partyUnit,
  partyUnitLabel,
  participantOwner,
  pricingUnitLabel,
  previousVse,
  reconciliationEtag,
  saveReconciliation,
  type Decision,
  type IncomingView,
  type ReceiptProblemItem,
  type ReconciliationView,
  type ReconciliationWrite,
} from "./api";
import { ComparisonField, ReferenceField, type ComparisonValue } from "./ComparisonField";
import { CheckSectionCard } from "./CheckSectionCard";
import { ReconciliationActions } from "./ReconciliationActions";
import { ReconciliationFeedback } from "./ReconciliationFeedback";
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

/** ТЗ DR8 §6.2/§10: OTHER_REASON demands its own text of 1–240 characters. */
const OTHER_REASON_MAX = 240;

const formSchemaWithComparisonFacts = formSchema.superRefine((values, ctx) => {
  // CHK-F44: the discrepancy act carries the reason, so a mismatch without
  // one is a client-side validation error of the comparison card (§7.3).
  for (const [fieldId, comparison] of Object.entries(values.comparisons)) {
    if (comparison.matches === false && comparison.reason.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["comparisons", fieldId],
        message: "Укажите причину несоответствия для отметки «Не совпадает».",
      });
    }
  }
  if (
    (values.decision === "PARTIAL" || values.decision === "RETURN_ALL") &&
    values.return_reason_code === "OTHER_REASON"
  ) {
    const text = values.return_reason_text.trim();
    if (text === "") {
      ctx.addIssue({
        code: "custom",
        path: ["return_reason_text"],
        message: "Для иной причины обязателен текст причины возврата.",
      });
    } else if (text.length > OTHER_REASON_MAX) {
      ctx.addIssue({
        code: "custom",
        path: ["return_reason_text"],
        message: `Текст иной причины не должен превышать ${OTHER_REASON_MAX} символов.`,
      });
    }
  }
});

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
  // ТЗ DR8 R-DR8-1: the canonical source unit GUID is filled into all three
  // QuantitySets automatically (allowed sources per ТЗ DR10 §4); the user
  // never types a unit.
  const sourceUnitId = partyUnit(party).id;
  const unitIdOf = (part: "delivered" | "accepted" | "returned"): string =>
    initial[part].unit_id !== "" ? initial[part].unit_id : sourceUnitId;
  return {
    decision: initial.decision,
    compartment: initial.inspection.compartment ?? null,
    joint_carriage: initial.inspection.jointCarriage ?? null,
    delivered: { ...initial.delivered, unit_id: unitIdOf("delivered") },
    accepted: { ...initial.accepted, unit_id: unitIdOf("accepted") },
    returned: { ...initial.returned, unit_id: unitIdOf("returned") },
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

/** The observation cards of the transport section with semantic tone. */
const COMPARTMENT_TONES: Readonly<Record<string, string>> = Object.freeze({
  COMPLIANT: "positive",
  DIRTY_OR_DAMAGED: "negative",
});

const JOINT_TONES: Readonly<Record<string, string>> = Object.freeze({
  NONE: "positive",
  SEPARATED: "positive",
  NOT_SEPARATED: "negative",
});

const QUANTITY_PARTS = ["delivered", "accepted", "returned"] as const;

/** Idempotency key of one save session (ТЗ DR13): a stable key while the
 * payload AND the shown revision stay unchanged, so a repeated identical
 * «Сохранить сверку» lets the server replay the saved state; any edit or a
 * moved revision starts a fresh key. */
function newIdempotencyKey(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ReconciliationForm({ party, initial, onSaved }: ReconciliationFormProps): React.ReactElement {
  const compared = useMemo(() => comparedFields(party), [party]);
  const previous = useMemo(() => previousVse(party), [party]);
  const unit = useMemo(() => partyUnit(party), [party]);
  // ТЗ DR10 §6: the unit counts as present only with a valid canonical GUID;
  // a missing display NAME never means a missing unit.
  const hasUnit = useMemo(() => hasSourceUnit(party), [party]);
  const facts = useMemo(() => documentFacts(party), [party]);
  const senderOwner = participantOwner(party, "sender");
  const receiverOwner = participantOwner(party, "receiver");
  const form = useForm<FormValues>({ defaultValues: initialValues(party, initial) });
  const values = useWatch({ control: form.control }) as FormValues;
  useDirtyGuard(form.formState.isDirty, "Сверка");
  const command = useCommand<ReconciliationView>();
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** The key + fingerprint of the save session (ТЗ DR13): reused while the
   * payload and the shown revision stay unchanged, otherwise re-keyed. */
  const sessionRef = useRef<{ key: string; fingerprint: string; etag: string } | null>(null);
  const refresh = command.refresh;

  // ТЗ DR13: a REVISION_CONFLICT never implies another user interfered with
  // an editable OPEN form — the shown revision is simply stale. The actual
  // state is re-read automatically (no merge, nothing resent); the feedback
  // line stays honest about what happened.
  const staleRevision = command.error?.code === "REVISION_CONFLICT";
  useEffect(() => {
    if (staleRevision) {
      void refresh();
    }
  }, [staleRevision, refresh]);

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    const formElement = event.currentTarget;
    void form.handleSubmit((formValues) => {
      const parsed = formSchemaWithComparisonFacts.safeParse(formValues);
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          errors[issue.path.join(".")] = issue.message;
        }
        setFieldErrors(errors);
        setFormError("Проверьте введённые значения количеств и отметки.");
        // The focus moves to the first invalid field of the composed form:
        // a text input (quantities, the reason of a mismatch) or, for a
        // mark-level comparison error without fact inputs, the first radio
        // of the invalid mark group (§7.3).
        requestAnimationFrame(() => {
          (
            formElement.querySelector<HTMLElement>('.app-field input[aria-invalid="true"]') ??
            formElement.querySelector<HTMLElement>('.vse-rec-check-buttons[aria-invalid="true"] input')
          )?.focus();
        });
        return;
      }
      setFieldErrors({});
      setFormError("");
      // ТЗ DR13: If-Match is the SHOWN reconciliation revision (the empty OPEN
      // view carries the parent party revision, a saved view its own), and the
      // idempotency key is stable while the payload and revision are
      // unchanged — a repeated identical save replays the saved state.
      const payload = toPayload(formValues, party);
      const etag = reconciliationEtag(initial);
      const fingerprint = JSON.stringify(payload);
      const session = sessionRef.current;
      const key =
        session !== null && session.fingerprint === fingerprint && session.etag === etag
          ? session.key
          : newIdempotencyKey();
      sessionRef.current = { key, fingerprint, etag };
      void command.submit(
        async (ctx) => {
          const result = await saveReconciliation(party.party_id, payload, etag)(ctx);
          if (result.response.ok && result.data !== undefined) {
            // The server returned the saved view: publish it and refresh the
            // form state (dirty flag clears with the confirmed facts).
            onSaved(result.data);
            form.reset(initialValues(party, result.data));
          }
          return result;
        },
        { queryKey: [party.laboratory_id, party.party_id, "reconciliation"], idempotencyKey: key },
      );
    })(event);
  };

  const decisionErrors: Record<string, string> = {};
  // ТЗ DR8 §10: CHK-F20 is bound to the unit/quantity block of the exact
  // part the server named (path delivered/accepted/returned), not only to
  // the common banner.
  const quantityErrors: Record<string, string> = {};
  const problem = command.error;
  if (problem !== null && problem.code === "VALIDATION_ERROR") {
    const items =
      (
        problem as unknown as {
          errors?: { field_id?: string | null; path?: string | null; message: string }[];
        }
      ).errors ?? [];
    for (const item of items) {
      if (item.field_id === "CHK-F34") decisionErrors.decision = item.message;
      if (item.field_id === "CHK-F35" && item.message.includes("текст")) {
        decisionErrors.return_reason_text = item.message;
      }
      if (
        item.field_id === "CHK-F20" &&
        item.path !== null &&
        item.path !== undefined &&
        QUANTITY_PARTS.includes(item.path as (typeof QUANTITY_PARTS)[number])
      ) {
        quantityErrors[item.path] = item.message;
      }
    }
  }
  // The allowed decisions are recomputed from the CURRENT input (the same
  // rules the server applies); the server stays authoritative at save time
  // and any mismatch surfaces as its validation errors (FT-ARR-09).
  // ТЗ DR10 §8.6: a server UNIT_MISSING (and a CHK-F20 problem the server
  // sent without a resolvable part) is bound to the quantity/unit block of
  // THIS form, not only to the common banner.
  let unitError = "";
  if (problem !== null && problem.code === "UNIT_MISSING") {
    unitError = problem.detail;
  } else if (
    problem !== null &&
    problem.code === "VALIDATION_ERROR" &&
    Object.keys(quantityErrors).length === 0 &&
    ((problem as unknown as { errors?: { field_id?: string | null }[] }).errors ?? []).some(
      (item) => item.field_id === "CHK-F20",
    )
  ) {
    unitError = "Единица измерения сверки не совпадает с исходным эВСД.";
  }
  const allowed: Decision[] = computeAllowedDecisions(values.delivered, values.comparisons);
  const decision = values.decision;
  const actErrors: ReceiptProblemItem[] = problemItemsOf(problem);
  const comparisonValue = (fieldId: string): ComparisonValue =>
    values.comparisons[fieldId] ?? { matches: null, actual: "", reason: "" };
  const comparisonChange = (fieldId: string) => (next: ComparisonValue) =>
    form.setValue(`comparisons.${fieldId}`, next, { shouldDirty: true });

  const markAllCompared = (): void => {
    for (const field of compared) {
      const current = comparisonValue(field.fieldId);
      if (current.matches !== true) {
        form.setValue(`comparisons.${field.fieldId}`, { ...current, matches: true }, { shouldDirty: true });
      }
    }
  };

  const compareField = (fieldId: string): React.ReactElement => {
    const field = compared.find((entry) => entry.fieldId === fieldId);
    if (field === undefined) {
      throw new TypeError(`Сравниваемое поле не найдено: ${fieldId}`);
    }
    return (
      <ComparisonField
        key={field.fieldId}
        fieldId={field.fieldId}
        label={field.label}
        block={field.block}
        source={field.source}
        actualPlaceholder={field.actualPlaceholder}
        value={comparisonValue(field.fieldId)}
        onChange={comparisonChange(field.fieldId)}
        error={fieldErrors[`comparisons.${field.fieldId}`] ?? ""}
      />
    );
  };

  const compareGrid = (block: "participants" | "transport" | "product" | "documents"): React.ReactElement[] =>
    compared.filter((field) => field.block === block).map((field) => compareField(field.fieldId));

  return (
    <form className="vse-rec-form" onSubmit={(event) => void submit(event)} noValidate>
      {/* 1. Документ — real available facts, neutral reference cards. */}
      <CheckSectionCard
        sectionKey="document"
        title={CHECK_SECTION_TITLES.document}
        description={CHECK_SECTION_DESCRIPTIONS.document}
      >
        <div className="vse-rec-compare-grid">
          {facts.map((fact) => (
            <ReferenceField key={fact.label} label={fact.label} value={fact.value} />
          ))}
        </div>
      </CheckSectionCard>

      {/* 2. Участники перевозки — sender/receiver sub-cards of the mockup. */}
      <CheckSectionCard
        sectionKey="participants"
        title={CHECK_SECTION_TITLES.participants}
        description={CHECK_SECTION_DESCRIPTIONS.participants}
      >
        <div className="vse-rec-participants">
          <div className="vse-rec-participant-card" aria-labelledby="vse-rec-sender-title">
            <h3 id="vse-rec-sender-title">Сведения об отправителе</h3>
            {compared.some((field) => field.fieldId === "CHK-F05") ? compareField("CHK-F05") : null}
            {/* CHK-F06 (ТЗ DR13): the owner is a compared ground when the
                source carries it; the reference card stays for absent data. */}
            {compared.some((field) => field.fieldId === "CHK-F06") ? (
              compareField("CHK-F06")
            ) : senderOwner !== null ? (
              <div className="vse-rec-compare reference">
                <span className="vse-rec-compare-name">Владелец продукции</span>
                <span className="vse-rec-mercury-value vse-rec-owner-value">{senderOwner}</span>
              </div>
            ) : null}
          </div>
          <div className="vse-rec-participant-card" aria-labelledby="vse-rec-receiver-title">
            <h3 id="vse-rec-receiver-title">Сведения о получателе</h3>
            {compared.some((field) => field.fieldId === "CHK-F07") ? compareField("CHK-F07") : null}
            {/* CHK-F08 (ТЗ DR13): the same compared-owner rule on the receiver. */}
            {compared.some((field) => field.fieldId === "CHK-F08") ? (
              compareField("CHK-F08")
            ) : receiverOwner !== null ? (
              <div className="vse-rec-compare reference">
                <span className="vse-rec-compare-name">Владелец продукции</span>
                <span className="vse-rec-mercury-value vse-rec-owner-value">{receiverOwner}</span>
              </div>
            ) : null}
          </div>
        </div>
      </CheckSectionCard>

      {/* 3. Транспорт — comparison grid + the two observation cards. */}
      <CheckSectionCard
        sectionKey="transport"
        title={CHECK_SECTION_TITLES.transport}
        description={CHECK_SECTION_DESCRIPTIONS.transport}
      >
        <div className="vse-rec-compare-grid">{compareGrid("transport")}</div>
        <div className="vse-rec-observations" aria-label="Фактическое состояние перевозки">
          <div
            className={`vse-rec-observation${
              values.compartment !== null ? ` ${COMPARTMENT_TONES[values.compartment] ?? ""}` : ""
            }`}
          >
            <label htmlFor="inspection-compartment">Состояние грузового отделения</label>
            <select
              id="inspection-compartment"
              required
              value={values.compartment ?? ""}
              onChange={(event) =>
                form.setValue(
                  "compartment",
                  (event.target.value === "" ? null : event.target.value) as FormValues["compartment"],
                  { shouldDirty: true },
                )
              }
            >
              <option value="">Выберите значение</option>
              <option value="COMPLIANT">Соответствует требованиям</option>
              <option value="DIRTY_OR_DAMAGED">Есть загрязнения или повреждения</option>
            </select>
          </div>
          <div
            className={`vse-rec-observation${
              values.joint_carriage !== null ? ` ${JOINT_TONES[values.joint_carriage] ?? ""}` : ""
            }`}
          >
            <label htmlFor="inspection-joint">Совместная перевозка с другими грузами</label>
            <select
              id="inspection-joint"
              required
              value={values.joint_carriage ?? ""}
              onChange={(event) =>
                form.setValue(
                  "joint_carriage",
                  (event.target.value === "" ? null : event.target.value) as FormValues["joint_carriage"],
                  { shouldDirty: true },
                )
              }
            >
              <option value="">Выберите значение</option>
              <option value="NONE">Нет</option>
              <option value="SEPARATED">Да, грузы разделены</option>
              <option value="NOT_SEPARATED">Да, разделение не обеспечено</option>
            </select>
          </div>
        </div>
      </CheckSectionCard>

      {/* 4. Продукция — classification grid + the quantity sets. */}
      <CheckSectionCard
        sectionKey="product"
        title={CHECK_SECTION_TITLES.product}
        description={CHECK_SECTION_DESCRIPTIONS.product}
      >
        <div className="vse-rec-compare-grid">{compareGrid("product")}</div>
        <div className="vse-rec-quantities" aria-label="Количества партии">
          <div className="vse-rec-quantities-unit">
            <span className="vse-rec-quantities-title">Единица измерения (из эВСД)</span>
            {/* ТЗ DR10 §6: with a name the GUID stays an accessible tooltip;
                without one the honest GUID fallback is the value itself. */}
            {hasUnit ? (
              <span
                className="vse-rec-mercury-value"
                title={unit.name !== "" ? `Единица из ВСД (GUID: ${unit.id})` : undefined}
              >
                {partyUnitLabel(party)}
              </span>
            ) : (
              <span className="vse-rec-mercury-value">—</span>
            )}
          </div>
          {hasUnit ? null : (
            <p className="vse-rec-prior-note">
              Исходный эВСД не содержит единицу измерения: гашение будет недоступно, пока единица не появится
              в документе.
            </p>
          )}
          {unitError !== "" ? (
            <p className="app-field-message app-field-error" aria-live="polite">
              {unitError}
            </p>
          ) : null}
          {QUANTITY_PARTS.map((part) => {
            const title = { delivered: "Доставлено", accepted: "Принято", returned: "Возвращается" }[part];
            return (
              <div key={part} className="vse-rec-quantities-part">
                <p className="vse-rec-quantities-title">{title}</p>
                <Field
                  label="Вес, кг"
                  value={values[part].mass_kg}
                  error={fieldErrors[`${part}.mass_kg`] ?? ""}
                  onChange={(next) => form.setValue(`${part}.mass_kg`, next, { shouldDirty: true })}
                />
                <Field
                  label={unit.name !== "" ? `Количество (${unit.name})` : "Количество"}
                  value={values[part].quantity}
                  error={fieldErrors[`${part}.quantity`] ?? ""}
                  onChange={(next) => form.setValue(`${part}.quantity`, next, { shouldDirty: true })}
                />
                {quantityErrors[part] !== undefined ? (
                  <p className="app-field-message app-field-error" aria-live="polite">
                    {quantityErrors[part]}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </CheckSectionCard>

      {/* 5. Сопроводительные документы — the compared requisites of the source
          projection; without one the honest empty state stays (no FT-ARR-05 id). */}
      <CheckSectionCard
        sectionKey="documents"
        title={CHECK_SECTION_TITLES.documents}
        description={CHECK_SECTION_DESCRIPTIONS.documents}
      >
        {compared.some((field) => field.block === "documents") ? (
          <div className="vse-rec-compare-grid">{compareGrid("documents")}</div>
        ) : (
          <p className="vse-rec-prior-note">
            Отдельные реквизиты транспортного документа в эВСД этой партии не заполнены. Документ сверки — сам
            транспортный эВСД, дополнительные серии не вводятся.
          </p>
        )}
      </CheckSectionCard>

      {/* 6. Ранее проведённая ВСЭ. */}
      <CheckSectionCard
        sectionKey="priorVse"
        title={CHECK_SECTION_TITLES.priorVse}
        description={CHECK_SECTION_DESCRIPTIONS.priorVse}
      >
        {previous === null ? (
          <p className="vse-rec-prior-note">
            Сведений ранее проведённой ВСЭ в эВСД нет: по этой партии обязательна местная ВСЭ (без фиктивного
            выбора повторной).
          </p>
        ) : (
          <>
            <div className="vse-rec-compare-grid">
              {previous.stamp !== "" ? (
                <ReferenceField label="Клеймо убойного пункта" value={previous.stamp} />
              ) : null}
              <ReferenceField label="Номер экспертизы" value={previous.number || "—"} />
              <ReferenceField label="Дата проведения" value={previous.performedOn || "—"} />
              <ReferenceField label="Организация-оператор" value={previous.organization || "—"} />
              <ReferenceField label="Результат осмотра" value={previous.result || "—"} />
            </div>
            {previous.conclusion !== "" ? (
              <details className="vse-rec-prior-conclusion">
                <summary>Заключение</summary>
                <p>{previous.conclusion}</p>
              </details>
            ) : null}
            <fieldset className="vse-rec-repeat">
              <legend>Необходимость повторного ВСЭ</legend>
              <label className="vse-rec-mark">
                <input
                  type="radio"
                  name="repeat.required"
                  checked={values.repeat_required === true}
                  onChange={() => form.setValue("repeat_required", true, { shouldDirty: true })}
                />
                Требуется
              </label>
              <label className="vse-rec-mark">
                <input
                  type="radio"
                  name="repeat.required"
                  checked={values.repeat_required === false}
                  onChange={() => form.setValue("repeat_required", false, { shouldDirty: true })}
                />
                Не требуется
              </label>
              {values.repeat_required === true ? (
                <div className="vse-rec-repeat-inputs">
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
      </CheckSectionCard>

      {/* 7. Результаты сверки — decisions, transaction, derived act. */}
      <CheckSectionCard
        sectionKey="results"
        title={CHECK_SECTION_TITLES.results}
        description={CHECK_SECTION_DESCRIPTIONS.results}
      >
        <ReceiptDecision
          value={{
            decision: values.decision,
            return_reason_code: values.return_reason_code,
            return_reason_text: values.return_reason_text,
            transaction_planned: values.transaction_planned,
            transaction_type: values.transaction_type,
          }}
          onChange={(next) => {
            form.setValue("decision", next.decision, { shouldDirty: true });
            form.setValue("return_reason_code", next.return_reason_code, { shouldDirty: true });
            form.setValue("return_reason_text", next.return_reason_text, { shouldDirty: true });
            form.setValue("transaction_planned", next.transaction_planned, { shouldDirty: true });
            form.setValue("transaction_type", next.transaction_type, { shouldDirty: true });
          }}
          allowed={allowed}
          errors={{
            ...decisionErrors,
            ...(fieldErrors.return_reason_text !== undefined
              ? { return_reason_text: fieldErrors.return_reason_text }
              : {}),
          }}
        />
        <ActPreview act={initial.act} decision={decision} problemItems={actErrors} />
      </CheckSectionCard>

      {/* 8. Расчёт стоимости услуг — the server-computed snapshot; the fair flag. */}
      <CheckSectionCard
        sectionKey="invoice"
        title={CHECK_SECTION_TITLES.invoice}
        description={CHECK_SECTION_DESCRIPTIONS.invoice}
      >
        {initial.pricing === undefined || initial.pricing === null ? (
          <p className="vse-rec-invoice-empty">
            Стоимость будет рассчитана после сохранения и подтверждения сверки.
          </p>
        ) : (
          <div className="vse-rec-invoice-table-wrap">
            <table className="vse-rec-invoice-table">
              <caption className="vse-visually-hidden">Расчёт стоимости услуг по сверке</caption>
              <thead>
                <tr>
                  <th scope="col">Услуга</th>
                  <th scope="col">Единица расчёта</th>
                  <th scope="col">Количество</th>
                  <th scope="col">Тариф</th>
                  <th scope="col">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {initial.pricing.lines.map((line) => (
                  <tr key={line.service_code}>
                    <td>{line.name}</td>
                    <td>{pricingUnitLabel(line.unit_id)}</td>
                    <td>{line.quantity}</td>
                    <td>{moneyLabel(line.unit_price)}</td>
                    <td>{moneyLabel(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="vse-rec-invoice-total">
              <span>Итого</span>
              {/* The total is the SAVED server value; the client never computes it. */}
              <strong>{moneyLabel(initial.pricing.total)}</strong>
            </p>
          </div>
        )}
        <label className="vse-rec-invoice-waiver">
          <input
            type="checkbox"
            checked={values.fair}
            onChange={(event) => form.setValue("fair", event.target.checked, { shouldDirty: true })}
          />
          <span>
            <span className="vse-rec-invoice-waiver-title">Ярмарка</span>
            <span className="vse-rec-invoice-waiver-note">
              Сверка данных и ВСЭ по этой партии проводятся без оплаты.
            </span>
          </span>
        </label>
      </CheckSectionCard>

      {formError !== "" ? <StatusView state="forbidden" title={formError} /> : null}

      <ReconciliationFeedback
        problem={problem}
        decisionError={decisionErrors.decision}
        onRefresh={() => void command.refresh()}
        onRetry={() => void command.retry()}
      />

      {/* 9. Sticky action panel of the mockup. */}
      <ReconciliationActions
        laboratoryId={party.laboratory_id}
        busy={command.status === "pending"}
        complete={initial.complete}
        chosenDecision={decision !== null ? decisionLabel(decision) : undefined}
        canMarkAll={compared.length > 0}
        onMarkAll={markAllCompared}
      />
    </form>
  );
}

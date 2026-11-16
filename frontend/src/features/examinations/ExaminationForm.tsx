/**
 * ExaminationForm (E04, FT-VSE, API-05, DR35): the composed card form.
 *
 * The form lives ONLY in memory: no persisted draft, no autosave (AT-25) and
 * no «Сохранить как черновик» button ever exists. The two create actions
 * (wait / complete) are strictly separate API commands, the same-day edit is
 * a third (PUT) — no combined button.
 *
 * DR35 data rules: the readonly party sections read the confirmed snapshot
 * (unified participant names, Russian product type, formatted accepted mass
 * and quantity); the sample flow is NEW-only; the specialist is an explicit
 * scoped selection (created_by stays the audit actor); the pricing section is
 * the live server preview and the final COMPLETED save carries the confirmed
 * preview total to receive an honest managed conflict when it changed.
 */
import "./examinations.css";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useCommand } from "../../shared/api/command";
import { useDirtyGuard } from "../context/SwitchContext";
import { useDirtyStore } from "../../entities/session/context";
import { Button } from "../../shared/ui/Button";
import { Field } from "../../shared/ui/Field";
import { FormSection } from "../../shared/ui/FormSection";
import { ReadonlyField } from "../../shared/ui/ReadonlyField";
import { StatusView } from "../../shared/ui/StatusView";
import type { IncomingView } from "../arrivals/api";
import { revisionEtag } from "../arrivals/api";
import {
  createExamination,
  updateExamination,
  type ExaminationFormView,
  type ExaminationView,
  type ResearchWrite,
} from "./api";
import type { PricingPreviewRequestBody } from "./api";
import {
  DEFAULT_SAMPLE_MASS_KG,
  formSchemaFor,
  initialValues,
  researchErrors,
  toWritePayload,
  type ExaminationFormValues,
  type ResearchEntry,
} from "./formValues";
import { ExaminationFactsSection, ParticipantsSection } from "./ExaminationSections";
import { ResearchFields } from "./ResearchFields";
import { SampleSelection } from "./SampleSelection";
import { OutcomeFields } from "./OutcomeFields";
import { PricingSection, usePricingPreview, type PricingPreviewState } from "./PricingPreview";
import { INDICATORS } from "./indicators";

export interface ExaminationFormProps {
  party: IncomingView;
  /** The saved card in an edit; null for a create. */
  view: ExaminationView | null;
  today: string;
  /**
   * DR35 §4: the frozen reconciliation-step read model — the required
   * research set and the scoped specialist options come from the server.
   */
  formView: ExaminationFormView | null;
  /** The current session user id (the default specialist when eligible). */
  currentUserId: string | null;
  /**
   * The linked collection facts of a saved card (the same-day EDIT sample);
   * a create never uses them (DR35 §11: NEW-only).
   */
  availableCollections?: {
    id: string;
    collected_on: string;
    mass_kg: string;
    revision: number;
  }[];
  onSaved: (view: ExaminationView) => void;
  onCancel: () => void;
}

/** The initial sample entry: always a NEW selection for a create (DR35 §11.2);
 * an edit of a linked card corrects that same fact. */
export function initialSample(
  view: ExaminationView | null,
  collections: { id: string; collected_on: string; mass_kg: string; revision: number }[],
  today: string,
): ExaminationFormValues["sample"] {
  if (view !== null && view.sample_collection_id !== "") {
    const linked = collections.find((collection) => collection.id === view.sample_collection_id);
    if (linked !== undefined) {
      return {
        mode: "EDIT",
        collectionId: linked.id,
        expectedRevision: String(linked.revision),
        collectedOn: linked.collected_on,
        massKg: linked.mass_kg,
      };
    }
  }
  return {
    mode: "NEW",
    collectedOn: today,
    massKg: DEFAULT_SAMPLE_MASS_KG,
    collectionId: "",
    expectedRevision: "",
  };
}

export function ExaminationForm({
  party,
  view,
  today,
  formView,
  currentUserId,
  availableCollections,
  onSaved,
  onCancel,
}: ExaminationFormProps): React.ReactElement {
  const defaults = useMemo(
    () => ({
      number: "",
      today,
      sample: initialSample(view, availableCollections ?? [], today),
      sentToLab: false,
      specialistId:
        formView?.eligible_specialists.find((option) => option.id === currentUserId)?.id ??
        formView?.eligible_specialists[0]?.id ??
        "",
    }),
    [view, today, formView, currentUserId, availableCollections],
  );
  const form = useForm<ExaminationFormValues>({
    defaultValues: initialValues(defaults, view),
  });
  const values = useWatch({ control: form.control }) as ExaminationFormValues;
  const command = useCommand<ExaminationView>();
  const [formError, setFormError] = useState("");
  const [previewNonce, setPreviewNonce] = useState(0);
  const busy = command.status === "pending";
  const isEdit = view !== null;
  useDirtyGuard(form.formState.isDirty, "Карточка ВСЭ");

  const requiredResearchIds = useMemo(() => new Set(formView?.required_research_ids ?? []), [formView]);

  // DR35 §9: a server-pinned required research is always performed — the card
  // appears immediately and has no add/remove control.
  useEffect(() => {
    if (formView === null) return;
    for (const id of formView.required_research_ids) {
      const entry = form.getValues(`researches.${id}`) as ResearchEntry | undefined;
      if (entry !== undefined && !entry.performed) {
        form.setValue(`researches.${id}.performed`, true, { shouldDirty: false });
      }
    }
  }, [formView, form]);

  // DR35 §13.4: the preview payload covers the FULLY performed researches
  // only; the memoized identity keeps the debounce effect stable.
  const researchesKey = JSON.stringify(values.researches);
  const previewRequest = useMemo<PricingPreviewRequestBody | null>(() => {
    const researches: ResearchWrite[] = [];
    for (const def of INDICATORS) {
      const entry = values.researches[def.id];
      if (entry === undefined || !entry.performed) continue;
      if (def.kind === "DOSIMETRY") {
        if (entry.first === "" || entry.last === "") continue;
        researches.push({
          indicatorId: def.id,
          kind: "DOSIMETRY",
          value: { first: entry.first, last: entry.last },
        });
        continue;
      }
      if (entry.value === "") continue;
      if (def.kind === "ENUM" && entry.value === "OTHER" && entry.otherText.trim() === "") continue;
      if (def.kind === "TEXT" && entry.value.trim() === "") continue;
      const converted = toResearchValue(def.id, def.kind, entry.value, entry.otherText);
      if (converted !== null) researches.push(converted);
    }
    return researches.length === 0 ? null : { researches };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchesKey, previewNonce]);

  const preview: PricingPreviewState = usePricingPreview(party.party_id, previewRequest);
  const confirmedPreviewTotal = preview.status === "success" ? preview.snapshot.total : null;

  const runCreate = (mode: "WAITING" | "COMPLETED"): void => {
    // Readable per-field client errors first; the schema parse is the last
    // coarse guard.
    const clientErrors = researchErrors(values, requiredResearchIds);
    if (clientErrors.length > 0) {
      setFormError(clientErrors.join(" "));
      return;
    }
    if (mode === "WAITING" && !values.sentToLab) {
      setFormError("Ожидание возможно только после отправки проб в специальную лабораторию.");
      return;
    }
    if (mode === "COMPLETED" && values.outcome.outcome === "") {
      setFormError("Выберите итог экспертизы.");
      return;
    }
    if (values.specialistId === "") {
      setFormError("Выберите специалиста Госветслужбы.");
      return;
    }
    const parsed = formSchemaFor(mode).safeParse(values);
    if (!parsed.success) {
      setFormError("Проверьте обязательные поля формы.");
      return;
    }
    const payload = toWritePayload(parsed.data as ExaminationFormValues, mode, {
      expectedTotal: mode === "COMPLETED" ? confirmedPreviewTotal : null,
    });
    if (payload === null) {
      setFormError("Выполните хотя бы одно исследование.");
      return;
    }
    setFormError("");
    void command.submit(
      async (ctx) => {
        const result = await createExamination(party.party_id, payload, revisionEtag(party))(ctx);
        if (result.response.ok && result.data !== undefined) {
          // The saved card leaves the form: clear the dirty guard so the
          // programmatic navigation to the card is not blocked.
          useDirtyStore.getState().setDirty(false);
          onSaved(result.data);
        }
        return result;
      },
      { queryKey: ["arrivals", party.party_id, "examination"] },
    );
  };

  const runUpdate = (): void => {
    if (view === null) return;
    const mode: "WAITING" | "COMPLETED" = view.status === "WAITING" ? "WAITING" : "COMPLETED";
    const parsed = formSchemaFor(mode).safeParse(values);
    if (!parsed.success) {
      setFormError("Проверьте обязательные поля формы.");
      return;
    }
    const clientErrors = researchErrors(values, requiredResearchIds);
    if (clientErrors.length > 0) {
      setFormError(clientErrors.join(" "));
      return;
    }
    // A WAITING card edited same-day stays WAITING: no medical outcome is
    // invented, the later completion is an explicit separate action.
    const payload = toWritePayload(parsed.data as ExaminationFormValues, mode, {
      expectedTotal: mode === "COMPLETED" ? confirmedPreviewTotal : null,
    });
    if (payload === null) {
      setFormError("Выполните хотя бы одно исследование.");
      return;
    }
    if (mode === "WAITING" && !payload.sentToLab) {
      setFormError("Ожидание возможно только после отправки проб в специальную лабораторию.");
      return;
    }
    setFormError("");
    void command.submit(
      async (ctx) => {
        const result = await updateExamination(view.id, payload, `"${view.revision}"`)(ctx);
        if (result.response.ok && result.data !== undefined) {
          useDirtyStore.getState().setDirty(false);
          onSaved(result.data);
        }
        return result;
      },
      { queryKey: ["examinations", view.id] },
    );
  };

  const problem = command.error;
  const showProblem =
    problem !== null &&
    problem.code !== "VALIDATION_ERROR" &&
    !(
      problem.code === "REVISION_CONFLICT" ||
      problem.code === "STATE_CONFLICT" ||
      problem.code === "PRICE_CONFLICT"
    );
  const conflict =
    problem !== null &&
    (problem.code === "REVISION_CONFLICT" ||
      problem.code === "STATE_CONFLICT" ||
      problem.code === "PRICE_CONFLICT");
  const validationItems =
    problem !== null && problem.code === "VALIDATION_ERROR"
      ? ((problem as unknown as { errors?: { message: string }[] }).errors ?? [])
      : [];

  return (
    <form className="vse-exam-form" noValidate onSubmit={(event) => event.preventDefault()}>
      <ExaminationFactsSection party={party}>
        <div className="vse-span6">
          <Field
            id="exam-number"
            label="Номер ВСЭ *"
            value={values.number}
            disabled={busy}
            onChange={(next) => form.setValue("number", next, { shouldDirty: true })}
          />
        </div>
      </ExaminationFactsSection>

      <ParticipantsSection party={party} participants={formView?.participants}>
        <div className="vse-span4">
          <Field
            id="exam-stamp"
            label="Маркировка — ветеринарное клеймо лаборатории *"
            value={values.stamp}
            disabled={busy}
            onChange={(next) => form.setValue("stamp", next, { shouldDirty: true })}
          />
        </div>
      </ParticipantsSection>

      <ResearchFields
        values={values}
        view={view}
        disabled={busy}
        requiredResearchIds={requiredResearchIds}
        onChange={(next) => {
          form.setValue("researches", next.researches, { shouldDirty: true });
          form.setValue("invasive", next.invasive, { shouldDirty: true });
          form.setValue("noncontagious", next.noncontagious, { shouldDirty: true });
        }}
      />

      <SampleSelection
        values={values}
        view={view}
        disabled={busy}
        onChange={(next) => form.setValue("sample", next.sample, { shouldDirty: true })}
      />

      <FormSection
        icon="check-complete"
        title="Итог экспертизы"
        description="Заключение, стоимость и специалист, проводивший ВСЭ."
      >
        <div className="vse-sample-inputs">
          <label className="app-field">
            <span className="app-field-heading">
              <span>Дата отбора проб *</span>
            </span>
            <input
              type="date"
              max={today}
              value={values.sample.collectedOn}
              disabled={busy}
              aria-label="Дата отбора проб"
              onChange={(event) =>
                form.setValue(
                  "sample",
                  { ...values.sample, collectedOn: event.target.value },
                  { shouldDirty: true },
                )
              }
            />
          </label>
        </div>
        <label className="vse-sent-flag">
          <input
            type="checkbox"
            checked={values.sentToLab}
            disabled={busy || (isEdit && view.sent_to_lab)}
            onChange={(event) => form.setValue("sentToLab", event.target.checked, { shouldDirty: true })}
          />
          Пробы отправлены на специальные лабораторные исследования
        </label>
        {view === null || view.status === "COMPLETED" ? (
          <OutcomeFields
            value={values.outcome}
            disabled={busy}
            onChange={(next) => form.setValue("outcome", next, { shouldDirty: true })}
          />
        ) : (
          <p className="vse-exam-note">
            Карточка в ожидании: итог и направление вводятся отдельным действием после ответа специальной
            лаборатории.
          </p>
        )}
        <SpecialistChoice
          formView={formView}
          values={values}
          disabled={busy}
          onChange={(next) => form.setValue("specialistId", next, { shouldDirty: true })}
        />
      </FormSection>

      <FormSection
        icon="check-invoice"
        title="Расчёт стоимости услуг"
        description="Заполненные исследования, их количество, тарифы и итоговая сумма."
      >
        <PricingSection
          state={preview}
          disabled={busy}
          onRetry={() => setPreviewNonce((nonce) => nonce + 1)}
        />
      </FormSection>

      {formError !== "" ? (
        <StatusView state="forbidden" title="Проверьте введённые значения." detail={formError} />
      ) : null}
      {validationItems.length > 0 ? (
        <StatusView
          state="forbidden"
          title="Сервер вернул ошибки проверки."
          detail={validationItems.map((item) => item.message).join(" ")}
          trace={problem !== null && problem.trace_id !== "" ? `trace_id: ${problem.trace_id}` : undefined}
        />
      ) : null}
      {conflict ? (
        <StatusView
          state="unknown"
          title={
            problem.code === "PRICE_CONFLICT"
              ? "Стоимость изменилась с момента предварительного расчёта."
              : problem.code === "STATE_CONFLICT"
                ? "Действие отклонено: состояние партии или карточки изменилось."
                : "Карточка изменена другим пользователем."
          }
          detail={problem.detail}
          trace={problem.trace_id !== "" ? `trace_id: ${problem.trace_id}` : undefined}
          onRetry={() => void command.refresh()}
        />
      ) : null}
      {showProblem ? (
        <StatusView
          state="network-error"
          title="Не удалось сохранить ВСЭ."
          detail={problem.detail}
          trace={problem.trace_id !== "" ? `trace_id: ${problem.trace_id}` : undefined}
          onRetry={() => void command.retry()}
        />
      ) : null}

      <div className="vse-exam-actions">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Отменить
        </Button>
        {view === null ? (
          <>
            <Button
              variant="primary"
              busy={busy}
              busyLabel="Сохраняем ожидание…"
              onClick={() => runCreate("WAITING")}
            >
              Отправить в ожидание результата
            </Button>
            <Button
              variant="primary"
              busy={busy}
              busyLabel="Завершаем ВСЭ…"
              onClick={() => runCreate("COMPLETED")}
            >
              Завершить ВСЭ
            </Button>
          </>
        ) : (
          <Button variant="primary" busy={busy} busyLabel="Сохраняем правку…" onClick={() => runUpdate()}>
            Сохранить правку
          </Button>
        )}
      </div>
    </form>
  );
}

/** DR35 §12.3: the scoped specialist select; a single option stays readonly. */
function SpecialistChoice({
  formView,
  values,
  disabled,
  onChange,
}: {
  formView: ExaminationFormView | null;
  values: ExaminationFormValues;
  disabled: boolean;
  onChange: (specialistId: string) => void;
}): React.ReactElement {
  const options = formView?.eligible_specialists ?? [];
  if (options.length === 0) {
    return (
      <div className="vse-span12">
        <ReadonlyField label="Специалист Госветслужбы" value="Список специалистов недоступен." />
      </div>
    );
  }
  if (options.length === 1) {
    // ТЗ §12.3: without the right to appoint someone else the select keeps
    // only the current name, readonly in the same visual field format.
    return (
      <div className="vse-span4">
        <label className="app-field">
          <span className="app-field-heading">
            <span>Специалист Госветслужбы *</span>
          </span>
          <select
            value={options[0].id}
            disabled={true}
            aria-label="Специалист Госветслужбы"
            onChange={(event) => onChange(event.target.value)}
          >
            <option value={options[0].id}>{options[0].fullName}</option>
          </select>
        </label>
      </div>
    );
  }
  return (
    <div className="vse-span4">
      <label className="app-field">
        <span className="app-field-heading">
          <span>Специалист Госветслужбы *</span>
        </span>
        <select
          value={values.specialistId}
          disabled={disabled}
          aria-label="Специалист Госветслужбы"
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" disabled>
            Выберите специалиста
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.fullName}
            </option>
          ))}
        </select>
      </label>
      <p className="vse-exam-note">
        Выбран специалист, проводящий ВСЭ; оператор сохранения остаётся в аудите.
      </p>
    </div>
  );
}

/** One typed preview research from the form entry (client conversion only —
 * the server validates and prices). */
function toResearchValue(
  indicatorId: string,
  kind: string,
  value: string,
  otherText: string,
): ResearchWrite | null {
  switch (kind) {
    case "BOOLEAN":
      return { indicatorId, kind: "BOOLEAN", value: value === "true" };
    case "INTEGER":
      return /^\d+$/.test(value) ? { indicatorId, kind: "INTEGER", value: Number(value) } : null;
    case "DECIMAL":
      return /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) ? { indicatorId, kind: "DECIMAL", value } : null;
    case "TEXT":
      return value.trim() === "" ? null : { indicatorId, kind: "TEXT", value };
    case "ENUM":
      return {
        indicatorId,
        kind: "ENUM",
        value,
        ...(value === "OTHER" && otherText.trim() !== "" ? { otherText: otherText.trim() } : {}),
      };
    default:
      return null;
  }
}

/**
 * ExaminationForm (E04, FT-VSE, API-05): the composed card form.
 *
 * The form lives ONLY in memory: no persisted draft, no autosave (AT-25) and
 * no «Сохранить как черновик» button ever exists. The two create actions
 * (wait / complete) are strictly separate API commands, the same-day edit is
 * a third (PUT) — no combined button. RHF + the zod mirror validate at
 * submit; ``useCommand`` keeps the input on any failure and offers the
 * actual state after a conflict (409 preserves values, never merges).
 */
import "./examinations.css";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useCommand } from "../../shared/api/command";
import { useDirtyGuard } from "../context/SwitchContext";
import { useDirtyStore } from "../../entities/session/context";
import { Button } from "../../shared/ui/Button";
import { Field } from "../../shared/ui/Field";
import { StatusView } from "../../shared/ui/StatusView";
import type { CollectionView } from "../samples/api";
import type { IncomingView } from "../arrivals/api";
import { revisionEtag } from "../arrivals/api";
import { createExamination, updateExamination, type ExaminationView } from "./api";
import {
  DEFAULT_SAMPLE_MASS_KG,
  formSchemaFor,
  initialValues,
  researchErrors,
  toWritePayload,
  type ExaminationFormValues,
} from "./formValues";
import { ResearchFields } from "./ResearchFields";
import { SampleSelection } from "./SampleSelection";
import { OutcomeFields } from "./OutcomeFields";

export interface ExaminationFormProps {
  party: IncomingView;
  /** The saved card in an edit; null for a create. */
  view: ExaminationView | null;
  today: string;
  /** Available collection facts of the same party (REUSE default). */
  availableCollections: CollectionView[];
  onSaved: (view: ExaminationView) => void;
  onCancel: () => void;
}

/** The initial sample entry: REUSE default when an available collection exists. */
export function initialSample(
  view: ExaminationView | null,
  collections: CollectionView[],
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
    return {
      mode: "NEW",
      collectedOn: today,
      massKg: DEFAULT_SAMPLE_MASS_KG,
      collectionId: "",
      expectedRevision: "",
    };
  }
  const available = collections.find((collection) => collection.disposal_id === null);
  if (available !== undefined) {
    return {
      mode: "REUSE",
      collectionId: available.id,
      collectedOn: "",
      massKg: "",
      expectedRevision: "",
    };
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
  availableCollections,
  onSaved,
  onCancel,
}: ExaminationFormProps): React.ReactElement {
  const defaults = useMemo(
    () => ({
      number: "",
      today,
      sample: initialSample(view, availableCollections, today),
      sentToLab: false,
    }),
    [view, availableCollections, today],
  );
  const form = useForm<ExaminationFormValues>({
    defaultValues: initialValues(defaults, view),
  });
  const values = useWatch({ control: form.control }) as ExaminationFormValues;
  const command = useCommand<ExaminationView>();
  const [formError, setFormError] = useState("");
  const busy = command.status === "pending";
  const isEdit = view !== null;
  useDirtyGuard(form.formState.isDirty, "Карточка ВСЭ");

  const runCreate = (mode: "WAITING" | "COMPLETED"): void => {
    // Readable per-field client errors first; the schema parse is the last
    // coarse guard.
    const clientErrors = researchErrors(values);
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
    const parsed = formSchemaFor(mode).safeParse(values);
    if (!parsed.success) {
      setFormError("Проверьте обязательные поля формы.");
      return;
    }
    const payload = toWritePayload(parsed.data as ExaminationFormValues, mode);
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
    const clientErrors = researchErrors(values);
    if (clientErrors.length > 0) {
      setFormError(clientErrors.join(" "));
      return;
    }
    // A WAITING card edited same-day stays WAITING: no medical outcome is
    // invented, the later completion is an explicit separate action.
    const payload = toWritePayload(parsed.data as ExaminationFormValues, mode);
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
    !(problem.code === "REVISION_CONFLICT" || problem.code === "STATE_CONFLICT");
  const conflict =
    problem !== null && (problem.code === "REVISION_CONFLICT" || problem.code === "STATE_CONFLICT");
  const validationItems =
    problem !== null && problem.code === "VALIDATION_ERROR"
      ? ((problem as unknown as { errors?: { message: string }[] }).errors ?? [])
      : [];

  return (
    <form className="vse-exam-form" noValidate onSubmit={(event) => event.preventDefault()}>
      <section className="vse-exam-block" aria-label="Карточка ВСЭ">
        <h3>Карточка ВСЭ</h3>
        <div className="vse-exam-grid">
          <Field
            id="exam-number"
            label="Номер ВСЭ *"
            value={values.number}
            disabled={busy}
            onChange={(next) => form.setValue("number", next, { shouldDirty: true })}
          />
          <Field
            id="exam-stamp"
            label="Маркировка — ветеринарное клеймо лаборатории *"
            value={values.stamp}
            disabled={busy}
            onChange={(next) => form.setValue("stamp", next, { shouldDirty: true })}
          />
        </div>
        <label className="vse-comparison-mark">
          <input
            type="checkbox"
            checked={values.sentToLab}
            disabled={busy || (isEdit && view.sent_to_lab)}
            onChange={(event) => form.setValue("sentToLab", event.target.checked, { shouldDirty: true })}
          />
          Пробы отправлены на специальные лабораторные исследования
        </label>
      </section>

      <ResearchFields
        values={values}
        view={view}
        disabled={busy}
        onChange={(next) => {
          form.setValue("researches", next.researches, { shouldDirty: true });
          form.setValue("invasive", next.invasive, { shouldDirty: true });
          form.setValue("noncontagious", next.noncontagious, { shouldDirty: true });
        }}
      />

      <SampleSelection
        values={values}
        view={view}
        today={today}
        disabled={busy}
        availableCollections={availableCollections}
        onChange={(next) => form.setValue("sample", next.sample, { shouldDirty: true })}
      />

      {view === null || view.status === "COMPLETED" ? (
        <section className="vse-exam-block" aria-label="Итог">
          <h3>Итог экспертизы</h3>
          <OutcomeFields
            value={values.outcome}
            disabled={busy}
            onChange={(next) => form.setValue("outcome", next, { shouldDirty: true })}
          />
        </section>
      ) : (
        <section className="vse-exam-block" aria-label="Итог">
          <h3>Итог экспертизы</h3>
          <p className="vse-exam-note">
            Карточка в ожидании: итог и направление вводятся отдельным действием после ответа специальной
            лаборатории.
          </p>
        </section>
      )}

      <section className="vse-exam-block" aria-label="Расчёт стоимости">
        <h3>Расчёт стоимости</h3>
        <p className="vse-exam-note">
          Стоимость рассчитывает сервер по принятому составу и действующим тарифам; ярмарка обнуляет платные
          услуги.
        </p>
      </section>

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
            problem.code === "STATE_CONFLICT"
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

      <div className="vse-form-actions">
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
        <Button disabled={busy} onClick={onCancel}>
          Отменить
        </Button>
      </div>
    </form>
  );
}

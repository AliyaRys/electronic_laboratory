/**
 * Bulk price dialog (Task C02, API-03): whole-set price command of ADMIN/
 * ANALYST. The FULL coverage list of affected laboratories is shown BEFORE
 * the confirmation; after the accepted 202 the per-target actual results are
 * shown (partial results stay visible) and only FAILED targets can be
 * retried with a NEW command key.
 */
import "./catalogs.css";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../shared/ui/Button";
import { createBulkPrice, fetchBulkJob, retryBulkJob, BULK_STATE_LABELS, type BulkPriceJobView } from "./api";
import { MONEY, isUuid, problemFieldErrors, shortId } from "./common";

export const bulkPriceSchema = z.object({
  product_species_id: z
    .string()
    .trim()
    .refine((value) => isUuid(value), "Укажите корректный UUID вида продукции."),
  service_code: z.string().trim().min(1, "Укажите код услуги."),
  unit_id: z.string().trim().min(1, "Укажите единицу измерения."),
  price: z
    .string()
    .trim()
    .refine((value) => MONEY.test(value), "Цена — конечное число с точкой, не отрицательная."),
  laboratory_ids: z.array(z.string()),
  /** Manual UUID entry when the context exposes no laboratories (ADMIN). */
  laboratory_ids_text: z.string(),
});

export type BulkPriceValues = z.input<typeof bulkPriceSchema>;
export type BulkPriceParsed = z.output<typeof bulkPriceSchema>;

/** Coverage ids from the checkboxes or the manual UUID entry (ADMIN fallback). */
export function coverageIds(values: BulkPriceValues, laboratories: { id: string }[]): string[] {
  if (laboratories.length > 0) return values.laboratory_ids;
  return values.laboratory_ids_text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => isUuid(item));
}

export interface BulkPriceDialogProps {
  laboratories: { id: string; name: string }[];
  productSpeciesId?: string | undefined;
  serviceCode?: string | undefined;
  unitId?: string | undefined;
  onClose: () => void;
  onApplied?: () => void | undefined;
}

export function BulkPriceDialog({
  laboratories,
  productSpeciesId = "",
  serviceCode = "",
  unitId = "",
  onClose,
  onApplied,
}: BulkPriceDialogProps): React.ReactElement {
  const [step, setStep] = useState<"form" | "result">("form");
  const [job, setJob] = useState<BulkPriceJobView | null>(null);
  const [formError, setFormError] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  // The coverage checkboxes are controlled locally: RHF turns an unchecked
  // checkbox group into a non-array value, which broke partial coverage.
  // The laboratory list can arrive AFTER the mount (async contexts query),
  // so the selection is re-synced when the id list changes.
  const [coverage, setCoverage] = useState<string[]>(laboratories.map((item) => item.id));
  const laboratoryKey = laboratories.map((item) => item.id).join(",");
  const [coverageKey, setCoverageKey] = useState(laboratoryKey);
  if (coverageKey !== laboratoryKey) {
    // The laboratory list arrived after the mount (async contexts query):
    // reset the selection to the full coverage, per the "adjust state during
    // render" pattern (setState-in-effect is disallowed).
    setCoverageKey(laboratoryKey);
    setCoverage(laboratories.map((item) => item.id));
  }

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<BulkPriceValues>({
    defaultValues: {
      product_species_id: productSpeciesId,
      service_code: serviceCode,
      unit_id: unitId,
      price: "",
      laboratory_ids: laboratories.map((item) => item.id),
      laboratory_ids_text: "",
    },
  });
  const pending = isSubmitting || submitBusy || retryBusy;

  const runSubmit = handleSubmit(async (values) => {
    const ids = laboratories.length > 0 ? coverage : coverageIds(values, laboratories);
    if (ids.length === 0) {
      setError(laboratories.length > 0 ? "laboratory_ids" : "laboratory_ids_text", {
        message: "Отметьте хотя бы одну лабораторию охвата.",
      } as never);
      return;
    }
    const parsed = bulkPriceSchema.safeParse({ ...values, laboratory_ids: ids });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        setError(issue.path.join(".") as never, { message: issue.message });
      }
      return;
    }
    setFormError("");
    setSubmitBusy(true);
    // laboratory_ids_text is the ADMIN manual-entry fallback only; the
    // backend write schema forbids extra inputs (422 otherwise).
    const { laboratory_ids_text: _manualEntry, ...write } = parsed.data;
    const result = await createBulkPrice({ ...write, laboratory_ids: ids }, crypto.randomUUID());
    setSubmitBusy(false);
    if ("code" in result) {
      let bound = false;
      for (const [path, message] of Object.entries(problemFieldErrors(result))) {
        setError(path as never, { message });
        bound = true;
      }
      setFormError(
        bound ? result.detail : result.detail !== "" ? result.detail : "Не удалось применить массовую цену.",
      );
      return;
    }
    setJob({ id: result.accepted.operation_id, state: result.accepted.state, targets: [] });
    setStep("result");
  });

  // The 202 does not equal confirmation: the job is polled until every target
  // has its actual result (API-01/SPEC-04).
  const poll = useQuery({
    queryKey: ["bulk-job", job?.id],
    queryFn: ({ signal }) => fetchBulkJob(job?.id ?? "", signal),
    enabled: step === "result" && job !== null,
    refetchInterval: (query) => {
      const state = (query.state.data as BulkPriceJobView | undefined)?.state;
      return state === "PENDING" || state === "RUNNING" ? 1000 : false;
    },
  });

  const polled = poll.data !== undefined && !("code" in poll.data) ? poll.data : null;
  const current = polled ?? job;
  const finished = current !== null && current.state !== "PENDING" && current.state !== "RUNNING";
  const appliedRef = useRef(false);
  useEffect(() => {
    if (finished && !appliedRef.current) {
      appliedRef.current = true;
      onApplied?.();
    }
  }, [finished, onApplied]);

  const runRetry = async (): Promise<void> => {
    if (current === null) return;
    setRetryBusy(true);
    const result = await retryBulkJob(current.id, crypto.randomUUID());
    setRetryBusy(false);
    if ("code" in result) {
      setFormError(result.detail !== "" ? result.detail : "Не удалось повторить команду.");
      return;
    }
    setJob({ ...current, state: result.accepted.state });
    await poll.refetch();
  };

  return (
    <>
      {step === "form" ? (
        <form className="vse-auth-form vse-catalog-editor" onSubmit={runSubmit} noValidate>
          <p className="vse-bulk-note">
            Массовая цена применяется только к отмеченным лабораториям; наследования между лабораториями нет.
          </p>
          <div className="vse-bulk-coverage" data-testid="bulk-coverage">
            {laboratories.length === 0 ? (
              <fieldset>
                <legend>Охват: лаборатории административной области (UUID через запятую)</legend>
                <input
                  id="bulk-labs-text"
                  type="text"
                  disabled={pending}
                  aria-invalid={errors.laboratory_ids_text !== undefined ? "true" : undefined}
                  {...register("laboratory_ids_text")}
                />
              </fieldset>
            ) : (
              <fieldset>
                <legend>Охват: затронутые лаборатории ({laboratories.length})</legend>
                {laboratories.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={coverage.includes(item.id)}
                      disabled={pending}
                      onChange={(event) =>
                        setCoverage((current) =>
                          event.target.checked
                            ? [...current, item.id]
                            : current.filter((id) => id !== item.id),
                        )
                      }
                    />{" "}
                    {item.name}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
          {errors.laboratory_ids !== undefined || errors.laboratory_ids_text !== undefined ? (
            <p className="app-field-message app-field-error" role="alert">
              {errors.laboratory_ids?.message ?? errors.laboratory_ids_text?.message}
            </p>
          ) : null}
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor="bulk-species">Вид продукции (UUID)</label>
            </div>
            <input
              id="bulk-species"
              type="text"
              disabled={pending}
              aria-invalid={errors.product_species_id !== undefined ? "true" : undefined}
              {...register("product_species_id")}
            />
            {errors.product_species_id !== undefined ? (
              <p className="app-field-message app-field-error" role="alert">
                {errors.product_species_id.message}
              </p>
            ) : null}
          </div>
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor="bulk-code">Код услуги</label>
            </div>
            <input
              id="bulk-code"
              type="text"
              disabled={pending}
              aria-invalid={errors.service_code !== undefined ? "true" : undefined}
              {...register("service_code")}
            />
            {errors.service_code !== undefined ? (
              <p className="app-field-message app-field-error" role="alert">
                {errors.service_code.message}
              </p>
            ) : null}
          </div>
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor="bulk-unit">Единица измерения</label>
            </div>
            <input id="bulk-unit" type="text" disabled={pending} {...register("unit_id")} />
            {errors.unit_id !== undefined ? (
              <p className="app-field-message app-field-error" role="alert">
                {errors.unit_id.message}
              </p>
            ) : null}
          </div>
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor="bulk-price">Новая цена, ₽</label>
            </div>
            <input
              id="bulk-price"
              type="text"
              inputMode="decimal"
              disabled={pending}
              aria-invalid={errors.price !== undefined ? "true" : undefined}
              {...register("price")}
            />
            {errors.price !== undefined ? (
              <p className="app-field-message app-field-error" role="alert">
                {errors.price.message}
              </p>
            ) : null}
          </div>
          {formError !== "" ? (
            <p className="app-dialog-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="vse-auth-actions">
            <Button type="submit" variant="primary" busy={pending} busyLabel="Применение…">
              Применить цену
            </Button>
            <Button type="button" onClick={() => onClose()} disabled={pending}>
              Отмена
            </Button>
          </div>
        </form>
      ) : (
        <div className="vse-bulk-result" data-testid="bulk-result">
          <p data-testid="bulk-state">
            {current === null ? "Состояние недоступно." : (BULK_STATE_LABELS[current.state] ?? current.state)}
          </p>
          {current !== null && current.targets.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Лаборатория</th>
                  <th>Результат</th>
                  <th>Проблема</th>
                </tr>
              </thead>
              <tbody>
                {current.targets.map((target) => (
                  <tr key={target.lab_id}>
                    <td>{shortId(target.lab_id)}</td>
                    <td>{BULK_STATE_LABELS[target.state] ?? target.state}</td>
                    <td>{target.problem ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {formError !== "" ? (
            <p className="app-dialog-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="vse-auth-actions">
            {current !== null && current.targets.some((target) => target.state === "FAILED") ? (
              <Button
                type="button"
                variant="primary"
                busy={retryBusy}
                busyLabel="Повтор…"
                onClick={() => void runRetry()}
              >
                Повторить неуспешные
              </Button>
            ) : null}
            <Button type="button" onClick={() => onClose()}>
              Закрыть
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

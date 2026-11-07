/**
 * Tariff editor dialog (Task C02, API-03/INPUT-03): the price of one service
 * code for the laboratory/species scope. Money is a scale-2 decimal string;
 * the price may be explicitly zero but never negative (SPEC-05).
 */
import "./catalogs.css";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import type { Problem } from "../../shared/api/problem";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { createTariff, deleteTariff, updateTariff, type TariffView } from "./api";
import { MONEY, problemFieldErrors } from "./common";

export const MONEY_MESSAGE = "Цена — конечное число с точкой, не более 2 знаков, не отрицательная.";

export const tariffEditorSchema = z.object({
  service_code: z.string().trim().min(1, "Укажите код услуги."),
  unit_id: z.string().trim().min(1, "Укажите единицу измерения."),
  price: z
    .string()
    .trim()
    .refine((value) => MONEY.test(value), MONEY_MESSAGE),
  version: z
    .string()
    .trim()
    .refine((value) => /^\d+$/.test(value) && Number(value) >= 1, "Версия — целое число ≥ 1."),
  source_name: z.string().trim().min(1, "Укажите источник прейскуранта."),
});

export type TariffEditorValues = z.infer<typeof tariffEditorSchema>;

export function tariffEditorDefaults(tariff?: TariffView | null): TariffEditorValues {
  return {
    service_code: tariff?.service_code ?? "",
    unit_id: tariff?.unit_id ?? "",
    price: tariff?.price ?? "",
    version: String(tariff?.version ?? 1),
    source_name: typeof tariff?.source.name === "string" ? tariff.source.name : "",
  };
}

export interface TariffEditorProps {
  mode: "create" | "edit";
  laboratoryId: string;
  productSpeciesId: string;
  tariff?: TariffView | null;
  busy?: boolean | undefined;
  onSaved: (tariff: TariffView) => void;
  onDeleted?: () => void | undefined;
  onClose: () => void;
}

export function TariffEditor({
  mode,
  laboratoryId,
  productSpeciesId,
  tariff,
  busy = false,
  onSaved,
  onDeleted,
  onClose,
}: TariffEditorProps): React.ReactElement {
  const defaults = tariffEditorDefaults(tariff);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TariffEditorValues>({ defaultValues: defaults });
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const pending = isSubmitting || busy || deleteBusy;

  const payload = (values: TariffEditorValues): Parameters<typeof createTariff>[0] => ({
    laboratory_id: laboratoryId,
    product_species_id: productSpeciesId,
    service_code: values.service_code,
    unit_id: values.unit_id,
    price: values.price,
    version: Number(values.version),
    source: { name: values.source_name },
  });

  function applyProblem(problem: Problem): void {
    let bound = false;
    for (const [path, message] of Object.entries(problemFieldErrors(problem))) {
      const formPath = path.replace(/^body\./, "").replace(/\.(rule|source)\./, ".");
      setError(formPath as keyof TariffEditorValues as never, { message });
      bound = true;
    }
    setFormError(
      bound ? problem.detail : problem.detail !== "" ? problem.detail : "Не удалось сохранить тариф.",
    );
  }

  const submit = handleSubmit(async (values) => {
    setFormError("");
    if (mode === "create") {
      const result = await createTariff(payload(values), crypto.randomUUID());
      if ("code" in result) {
        applyProblem(result);
        return;
      }
      onSaved(result.tariff);
      onClose();
      return;
    }
    if (tariff === undefined || tariff === null) return;
    const result = await updateTariff(tariff.id, payload(values), `"${tariff.revision}"`);
    if ("code" in result) {
      applyProblem(result);
      return;
    }
    onSaved(result.tariff);
    onClose();
  });

  const runDelete = async (): Promise<void> => {
    if (tariff === null || tariff === undefined || onDeleted === undefined) return;
    setDeleteBusy(true);
    const problem = await deleteTariff(tariff.id, `"${tariff.revision}"`, crypto.randomUUID());
    setDeleteBusy(false);
    if (problem !== null) {
      setConfirmDelete(false);
      setFormError(problem.detail !== "" ? problem.detail : "Не удалось удалить тариф.");
      return;
    }
    onDeleted();
    onClose();
  };

  return (
    <>
      <form className="vse-auth-form vse-catalog-editor" onSubmit={submit} noValidate>
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="tariff-code">Код услуги</label>
          </div>
          <input
            id="tariff-code"
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
            <label htmlFor="tariff-unit">Единица измерения</label>
          </div>
          <input id="tariff-unit" type="text" disabled={pending} {...register("unit_id")} />
          {errors.unit_id !== undefined ? (
            <p className="app-field-message app-field-error" role="alert">
              {errors.unit_id.message}
            </p>
          ) : null}
        </div>
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="tariff-price">Цена, ₽</label>
          </div>
          <input
            id="tariff-price"
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
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="tariff-version">Версия прейскуранта</label>
          </div>
          <input id="tariff-version" type="text" disabled={pending} {...register("version")} />
          {errors.version !== undefined ? (
            <p className="app-field-message app-field-error" role="alert">
              {errors.version.message}
            </p>
          ) : null}
        </div>
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="tariff-source">Источник прейскуранта</label>
          </div>
          <input
            id="tariff-source"
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
        title="Удалить тариф?"
        description="Тариф перестанет покрывать расчёты этого показателя: готовность раздела станет неполной. Сохранённые расчёты не пересчитываются."
        confirmLabel="Удалить тариф"
        danger
        busy={deleteBusy}
        onConfirm={() => void runDelete()}
      />
    </>
  );
}

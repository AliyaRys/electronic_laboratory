/**
 * DisposalDialog (API-06, FT-SMP-06/07, S03): the confirmation of one full
 * basket disposal.
 *
 * BEFORE the confirmation the dialog shows the kind (species), the readonly
 * weight, the date and the outgoing eVSD number fields. The weight is never
 * an input and is never rounded — the exact decimal goes to the guard
 * ``expected_mass_kg``, while the stored mass is always computed by the
 * server from every active collection.
 *
 * A stale dialog never confirms silently: a 409 conflict keeps the dialog
 * open with the problem text, re-reads the actual balances through the bound
 * query (the new remainder becomes visible in the table behind) and requires
 * an explicit fresh confirmation afterwards — the command itself is never
 * resent automatically. After a success the dialog waits for the refreshed
 * server state (no optimistic zeroing); the 201 answer may carry no ETag, so
 * the basket revision is refreshed through the balances read model.
 *
 * The component mounts per opened balance (the page keys it by the open
 * counter), so every opening starts from the clean input state without an
 * effect.
 */
import "./samples.css";
import { z } from "zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useCommand } from "../../shared/api/command";
import { problemFromParsed } from "../../shared/api/problem";
import { Dialog } from "../../shared/ui/Dialog";
import { StatusView } from "../../shared/ui/StatusView";
import { balancesKey, disposeSamples, type BalanceView, type DisposalView } from "./api";

const formSchema = z.object({
  disposed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату утилизации."),
  external_vsd_number: z.string().trim().min(1, "Введите номер исходящей эВСД."),
});

type FormValues = z.infer<typeof formSchema>;

export interface DisposalDialogProps {
  laboratoryId: string;
  /** The balance the dialog was opened against (readonly facts source). */
  balance: BalanceView | null;
  open: boolean;
  /** Today, ISO — the date input suggests today and never a future day (R-06). */
  today: string;
  onClose: () => void;
  onDisposed: (view: DisposalView) => void;
}

export function DisposalDialog({
  laboratoryId,
  balance,
  open,
  today,
  onClose,
  onDisposed,
}: DisposalDialogProps): React.ReactElement {
  const command = useCommand<DisposalView>();
  const [detail, setDetail] = useState("");
  const [stale, setStale] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { disposed_on: today, external_vsd_number: "" } });
  const busy = command.status === "pending";

  const submit = handleSubmit((values: FormValues) => {
    const parsed = formSchema.safeParse(values);
    if (!parsed.success) {
      setDetail("Проверьте дату и номер исходящей эВСД.");
      return;
    }
    if (balance === null) return;
    setDetail("");
    void (async () => {
      let view: DisposalView | null = null;
      let conflict = false;
      let problemDetail = "";
      await command.submit(
        async (ctx) => {
          const result = await disposeSamples(
            {
              laboratoryId,
              productSpeciesId: balance.product_species_id,
              disposedOn: parsed.data.disposed_on,
              externalVsdNumber: parsed.data.external_vsd_number,
              expectedMassKg: balance.mass_kg,
            },
            balance.revision,
          )(ctx);
          if (result.data !== undefined) view = result.data;
          if (!result.response.ok) {
            const problem = problemFromParsed((result as { error?: unknown }).error, result.response.status);
            problemDetail = problem.detail;
            conflict = problem.code === "REVISION_CONFLICT" || problem.code === "STATE_CONFLICT";
          }
          return result;
        },
        { queryKey: balancesKey(laboratoryId) },
      );
      if (view !== null) {
        // 201: the server stored the disposal. Refresh the balances read
        // model (the answer carries no ETag) and only then close — no
        // optimistic zeroing of the balance.
        await command.refresh();
        onDisposed(view);
        onClose();
        return;
      }
      if (conflict) {
        // A stale dialog: show the problem, refresh the actual remainder and
        // require an explicit fresh confirmation — never a silent re-send.
        setStale(true);
        setDetail(problemDetail);
        await command.refresh();
        return;
      }
      setDetail(problemDetail !== "" ? problemDetail : "Ошибка сети.");
    })();
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title="Утилизация остатка"
      description="Утилизируется весь остаток выбранного вида продукции. Операция необратима."
      confirmLabel={stale ? "Подтвердить заново" : "Утилизировать"}
      busy={busy}
      error={detail}
      onConfirm={() => void submit()}
    >
      {balance === null ? (
        <StatusView state="not-found" title="Остаток не указан." />
      ) : (
        <div>
          <dl className="vse-samples-dialog-facts">
            <div>
              <dt>Вид продукции</dt>
              <dd>{balance.product_species_id}</dd>
            </div>
            <div>
              <dt>Вес (только чтение)</dt>
              <dd data-testid="disposal-shown-mass">{balance.mass_kg} кг</dd>
            </div>
          </dl>
          {stale ? (
            <StatusView
              state="unknown"
              title="Остаток изменился после открытия диалога."
              detail="Актуальный остаток обновлён в таблице. Проверьте новый вес и подтвердите утилизацию заново — прежнее подтверждение не применено."
            />
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="app-field">
              <div className="app-field-heading">
                <label htmlFor="disposal-date">Дата утилизации</label>
              </div>
              <input
                id="disposal-date"
                type="date"
                max={today}
                disabled={busy}
                aria-invalid={errors.disposed_on !== undefined ? "true" : undefined}
                {...register("disposed_on")}
              />
              {errors.disposed_on !== undefined ? (
                <p className="app-field-message app-field-error" role="alert">
                  {errors.disposed_on.message}
                </p>
              ) : null}
            </div>
            <div className="app-field">
              <div className="app-field-heading">
                <label htmlFor="disposal-number">Номер исходящей эВСД</label>
              </div>
              <input
                id="disposal-number"
                type="text"
                disabled={busy}
                aria-invalid={errors.external_vsd_number !== undefined ? "true" : undefined}
                {...register("external_vsd_number")}
              />
              <p className="app-field-message">
                Номер вводится вручную как факт; автоматической проверки через API нет.
              </p>
              {errors.external_vsd_number !== undefined ? (
                <p className="app-field-message app-field-error" role="alert">
                  {errors.external_vsd_number.message}
                </p>
              ) : null}
            </div>
          </form>
        </div>
      )}
    </Dialog>
  );
}

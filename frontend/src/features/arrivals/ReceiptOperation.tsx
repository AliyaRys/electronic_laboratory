import "./arrivals.css";
import "./reconciliation.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "../../shared/ui/Button";
import { StatusView } from "../../shared/ui/StatusView";
import {
  fetchOperationState,
  fetchReceiptContext,
  previewReceipt,
  submitReceipt,
  SOURCE_PRESENCE_STALE_TEXT,
  isStaleSourcePresence,
  type IncomingView,
  type Problem,
  type ReceiptContext,
  type ReceiptPreview,
  type ReconciliationView,
  type VetInspection,
} from "./api";
import { ReceiptConfirmationDialog } from "./ReceiptConfirmationDialog";

const TERMINAL = new Set(["CONFIRMED", "REJECTED", "UNKNOWN"]);

/** ТЗ DR27 §4.2: the honest message when the displayed reconciliation and
 * the fresh server context no longer agree — no stale preview is sent. */
const STALE_RECONCILIATION_TEXT = "Сверка обновилась. Проверьте данные и сохраните сверку заново";

/** ТЗ DR27 §5.2 (R-DR27-6): the error taxonomy the client distinguishes. */
function receiptProblemView(problem: Problem): { title: string; detail: string } {
  if (problem.code === "REVISION_CONFLICT") {
    return {
      title: "Источник или сверка изменились",
      detail: problem.detail,
    };
  }
  if (problem.code === "SOURCE_CHECKSUM_MISMATCH") {
    return {
      title: "Закреплённый исходный XML повреждён",
      detail: "Критическая ошибка данных: слепое повторение запрещено, обратитесь к администратору.",
    };
  }
  if (problem.code === "RECONCILIATION_INCOMPLETE") {
    return { title: "Сверка неполная", detail: problem.detail };
  }
  if (problem.code === "INTEGRATION_WRITE_DISABLED") {
    return {
      title: "Гашение не включено оператором",
      detail: "Это настройка установки, а не ошибка ревизий. Обратитесь к оператору.",
    };
  }
  if (problem.code === "VALIDATION_ERROR") {
    return { title: "Проверьте значения формы", detail: problem.detail };
  }
  return { title: "Гашение не подготовлено", detail: problem.detail };
}

function nowLocal(): string {
  const date = new Date();
  date.setSeconds(0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function operationCopy(state: string): {
  title: string;
  detail: string;
  status: "loading" | "forbidden" | "unknown" | "empty";
} {
  if (state === "CONFIRMED")
    return {
      title: "Гашение подтверждено ВетИС",
      detail: "Внешний результат и состав подтверждены.",
      status: "empty",
    };
  if (state === "REJECTED")
    return {
      title: "ВетИС отклонил гашение",
      detail: "Местная ВСЭ не открыта. Проверьте причину операции.",
      status: "forbidden",
    };
  if (state === "UNKNOWN")
    return {
      title: "Результат гашения пока неизвестен",
      detail: "Не отправляйте гашение повторно. Безопасно только проверить результат.",
      status: "unknown",
    };
  return {
    title: "Гашение обрабатывается ВетИС",
    detail: "Запрос отправлен один раз. Система проверяет результат.",
    status: "loading",
  };
}

export interface ReceiptOperationProps {
  party: IncomingView;
  reconciliation: ReconciliationView;
}

export function ReceiptOperation({ party, reconciliation }: ReceiptOperationProps): React.ReactElement {
  const queryClient = useQueryClient();
  const contextQuery = useQuery({
    queryKey: [party.laboratory_id, party.party_id, "receipt-context"],
    queryFn: ({ signal }) => fetchReceiptContext(party.party_id, signal),
  });
  const context =
    contextQuery.data !== undefined && !("code" in contextQuery.data) ? contextQuery.data : null;
  const contextProblem =
    contextQuery.data !== undefined && "code" in contextQuery.data ? contextQuery.data : null;
  const [operationId, setOperationId] = useState<string | null>(null);
  const activeOperationId = operationId ?? context?.operation_id ?? null;
  const operationQuery = useQuery({
    queryKey: [party.laboratory_id, activeOperationId, "receipt-operation"],
    queryFn: () => fetchOperationState(activeOperationId ?? ""),
    enabled: activeOperationId !== null,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data !== undefined && "state" in data && !TERMINAL.has(data.state) ? 2_000 : false;
    },
  });
  const operation =
    operationQuery.data !== undefined && "state" in operationQuery.data ? operationQuery.data : null;
  const state = operation?.state ?? context?.operation_state ?? null;
  const [vetInspection, setVetInspection] = useState<VetInspection | "">("");
  const [deliveryDate, setDeliveryDate] = useState(nowLocal);
  const [returnDate, setReturnDate] = useState("");
  const [preview, setPreview] = useState<ReceiptPreview | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const submitted = useRef(false);
  const invalidatedTerminal = useRef<string | null>(null);
  const deliveryIso = useMemo(() => new Date(deliveryDate).toISOString(), [deliveryDate]);
  const returnIso = useMemo(
    () => (returnDate === "" ? null : new Date(returnDate).toISOString()),
    [returnDate],
  );
  const isReturn = reconciliation.decision === "PARTIAL" || reconciliation.decision === "RETURN_ALL";

  useEffect(() => {
    if (state === null || !TERMINAL.has(state) || invalidatedTerminal.current === state) return;
    invalidatedTerminal.current = state;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: [party.laboratory_id, party.party_id, "arrival"] }),
      queryClient.invalidateQueries({ queryKey: [party.laboratory_id, party.party_id, "reconciliation"] }),
      queryClient.invalidateQueries({ queryKey: [party.laboratory_id, party.party_id, "receipt-context"] }),
    ]);
  }, [party.laboratory_id, party.party_id, queryClient, state]);

  /** ТЗ DR27 §4.2: a fresh GET of the receipt context right before any
   * decision; the closure-captured `context` is never trusted for revisions.
   * The fresh value also replaces the cache so the displayed state agrees. */
  async function fetchFreshContext(): Promise<ReceiptContext | Problem> {
    const fresh = await fetchReceiptContext(party.party_id);
    if (!("code" in fresh)) {
      queryClient.setQueryData([party.laboratory_id, party.party_id, "receipt-context"], fresh);
    }
    return fresh;
  }

  /** R-DR27-4: after a rejected write the whole server state is re-read once
   * (party, reconciliation, context) — the user sees the actual revisions. */
  async function refreshEverything(): Promise<void> {
    await Promise.all([
      queryClient.refetchQueries({
        queryKey: [party.laboratory_id, party.party_id, "arrival"],
        exact: true,
      }),
      queryClient.refetchQueries({
        queryKey: [party.laboratory_id, party.party_id, "reconciliation"],
        exact: true,
      }),
      queryClient.refetchQueries({
        queryKey: [party.laboratory_id, party.party_id, "receipt-context"],
        exact: true,
      }),
    ]);
  }

  async function prepare(): Promise<void> {
    if (vetInspection === "" || deliveryDate === "") return;
    if (isReturn && returnIso === null) return;
    setProblem(null);
    setBusy(true);
    try {
      // ТЗ DR27 §4.2 (R-DR27-2): prepare always re-reads the context, never
      // the values captured by the previous render.
      let fresh = await fetchFreshContext();
      if ("code" in fresh) {
        setProblem(fresh);
        return;
      }
      // A stale cached context right after a confirmed save gets exactly ONE
      // automatic context refetch; a persistent divergence stops honestly.
      if (fresh.reconciliation_revision !== reconciliation.revision) {
        fresh = await fetchFreshContext();
      }
      if ("code" in fresh) {
        setProblem(fresh);
        return;
      }
      // §4.2 preflight: the context must agree with the DISPLAYED
      // reconciliation and be usable at all.
      const mismatch =
        fresh.reconciliation_revision === null ||
        fresh.source_revision === null ||
        fresh.reconciliation_revision !== reconciliation.revision ||
        reconciliation.state !== "OPEN" ||
        !reconciliation.complete;
      if (mismatch) {
        await refreshEverything();
        setProblem({
          type: "about:blank",
          title: "Сверка обновилась",
          status: 409,
          detail: STALE_RECONCILIATION_TEXT,
          code: "STALE_RECONCILIATION",
        });
        return;
      }
      if (!fresh.write_enabled) {
        setProblem({
          type: "about:blank",
          title: "Гашение не включено оператором",
          status: 503,
          detail: "Отправка в ВетИС появится только после контролируемого включения установки.",
          code: "INTEGRATION_WRITE_DISABLED",
        });
        return;
      }
      const result = await previewReceipt(party.party_id, {
        source_revision: fresh.source_revision ?? -1,
        reconciliation_revision: fresh.reconciliation_revision ?? -1,
        vet_inspection: vetInspection,
        delivery_date: deliveryIso,
        return_date: returnIso ?? null,
      });
      if ("code" in result) {
        setProblem(result);
        return;
      }
      submitted.current = false; // a new preview earns exactly one new submit
      setPreview(result);
      setDialogOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (preview === null || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setProblem(null);
    // ТЗ DR27 §4.3 (R-DR27-3): the frozen preview is the ONLY source of the
    // submit payload — revisions, dates and the fingerprint all come from
    // preview.intent / preview.fingerprint, never from a stale context.
    const intent = preview.intent;
    const result = await submitReceipt(
      party.party_id,
      {
        source_revision: intent.source_revision,
        reconciliation_revision: intent.reconciliation_revision,
        vet_inspection: intent.vet_inspection,
        delivery_date: intent.delivery_date,
        return_date: intent.return_date ?? null,
        issue_date: intent.issue_date,
        fingerprint: preview.fingerprint,
      },
      crypto.randomUUID(),
    );
    setBusy(false);
    if ("code" in result) {
      submitted.current = false;
      if (result.code === "REVISION_CONFLICT") {
        // ТЗ DR27 §4.3 (R-DR27-4): no automatic submit retry, no new external
        // write without an explicit new confirmation. The stale preview is
        // dropped, the server state is re-read, the user input is kept.
        setDialogOpen(false);
        setPreview(null);
        await refreshEverything();
        setProblem(result);
        return;
      }
      setProblem(result);
      return;
    }
    setDialogOpen(false);
    setOperationId(result.operation_id);
    await queryClient.invalidateQueries({ queryKey: [party.laboratory_id, party.party_id] });
  }

  // ТЗ DR9 §6: a direct read of a stale document blocks the repeat гашение —
  // the source no longer carries this eVSD in the current confirmed queue.
  // The check is purely from the party read model and comes FIRST.
  if (isStaleSourcePresence(party)) {
    return (
      <section className="vse-receipt-operation" aria-labelledby="receipt-operation-title">
        <h2 id="receipt-operation-title">Гашение эВСД</h2>
        <StatusView
          state="forbidden"
          title={SOURCE_PRESENCE_STALE_TEXT}
          detail="Повторное гашение недоступно: документ отсутствует в текущем подтверждённом списке ВетИС."
        />
      </section>
    );
  }

  if (contextQuery.isLoading) return <StatusView state="loading" title="Проверяем возможность гашения…" />;
  if (contextProblem !== null) {
    return (
      <StatusView
        state="forbidden"
        title="Гашение недоступно"
        detail={contextProblem.detail}
        onRetry={() => void contextQuery.refetch()}
      />
    );
  }
  if (context === null)
    return (
      <StatusView
        state="network-error"
        title="Не удалось проверить возможность гашения."
        onRetry={() => void contextQuery.refetch()}
      />
    );

  if (state !== null) {
    const copy = operationCopy(state);
    return (
      <section className="vse-receipt-operation" aria-labelledby="receipt-operation-title">
        <h2 id="receipt-operation-title">Гашение эВСД</h2>
        <StatusView
          state={copy.status}
          title={copy.title}
          detail={operation?.problem ? `${copy.detail} Код: ${operation.problem}.` : copy.detail}
          onRetry={state === "UNKNOWN" ? () => void operationQuery.refetch() : undefined}
        />
        {state === "CONFIRMED" && reconciliation.route === "EXAMINATION" ? (
          <Link
            className="app-button primary vse-receipt-route"
            to={`/labs/${party.laboratory_id}/arrivals/${party.party_id}/examination/new`}
          >
            Создать ВСЭ
          </Link>
        ) : null}
      </section>
    );
  }

  if (!context.write_enabled) {
    return (
      <section className="vse-receipt-operation" aria-labelledby="receipt-operation-title">
        <h2 id="receipt-operation-title">Гашение эВСД</h2>
        <StatusView
          state="forbidden"
          title="Гашение не включено оператором"
          detail="Сверка сохранена. Отправка в ВетИС появится только после контролируемого включения установки."
        />
      </section>
    );
  }

  const ready =
    reconciliation.complete && context.source_revision !== null && context.reconciliation_revision !== null;
  return (
    <section className="vse-receipt-operation" aria-labelledby="receipt-operation-title">
      <h2 id="receipt-operation-title">Гашение эВСД</h2>
      <p className="vse-check-note">
        Подготовьте запрос, проверьте неизменяемое резюме и подтвердите отправку один раз.
      </p>
      <div className="vse-receipt-fields">
        <label htmlFor="vet-inspection">Результат ветеринарного осмотра</label>
        <select
          id="vet-inspection"
          value={vetInspection}
          onChange={(event) => setVetInspection(event.target.value as VetInspection | "")}
        >
          <option value="">Выберите результат</option>
          <option value="CORRESPONDS">Соответствует ветеринарным требованиям</option>
          <option value="MISMATCH">Не соответствует ветеринарным требованиям</option>
          <option value="UNSUPERVISED">Ветеринарный осмотр не проводился</option>
        </select>
        <label htmlFor="receipt-delivery-date">Дата и время поступления</label>
        <input
          id="receipt-delivery-date"
          type="datetime-local"
          max={nowLocal()}
          value={deliveryDate}
          onChange={(event) => setDeliveryDate(event.target.value)}
        />
        {isReturn ? (
          <>
            <label htmlFor="receipt-return-date">Дата и время возврата</label>
            <input
              id="receipt-return-date"
              type="datetime-local"
              max={nowLocal()}
              value={returnDate}
              onChange={(event) => setReturnDate(event.target.value)}
            />
          </>
        ) : null}
      </div>
      {!ready ? <p className="vse-receipt-blocked">Сначала полностью заполните и сохраните сверку.</p> : null}
      {problem !== null ? (
        <div>
          <StatusView
            state="forbidden"
            title={receiptProblemView(problem).title}
            detail={receiptProblemView(problem).detail}
          />
          {problem.code === "REVISION_CONFLICT" ? (
            <>
              {/* ТЗ DR27 §5.2: the safe technical diagnostics, when present. */}
              {problem.current_source_revision !== undefined &&
              problem.current_reconciliation_revision !== undefined ? (
                <p className="vse-receipt-blocked">
                  {`Актуальные ревизии: источник ${problem.current_source_revision}, сверка ${problem.current_reconciliation_revision}.`}
                </p>
              ) : null}
              {/* R-DR27-4: a fresh preview is always an explicit user action. */}
              <Button variant="secondary" disabled={busy} onClick={() => void prepare()}>
                Сформировать preview заново
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      <Button
        variant="primary"
        disabled={!ready || vetInspection === "" || deliveryDate === "" || (isReturn && returnIso === null)}
        busy={busy}
        busyLabel="Подготавливаем…"
        onClick={() => void prepare()}
      >
        Подготовить гашение
      </Button>
      <ReceiptConfirmationDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!busy) setDialogOpen(open);
        }}
        party={party}
        reconciliation={reconciliation}
        preview={preview}
        busy={busy}
        error={problem?.detail}
        onConfirm={() => void confirm()}
      />
    </section>
  );
}

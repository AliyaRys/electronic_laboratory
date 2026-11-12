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
  type IncomingView,
  type Problem,
  type ReceiptPreview,
  type ReconciliationView,
  type VetInspection,
} from "./api";
import { ReceiptConfirmationDialog } from "./ReceiptConfirmationDialog";

const TERMINAL = new Set(["CONFIRMED", "REJECTED", "UNKNOWN"]);

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

  async function prepare(): Promise<void> {
    if (context === null || vetInspection === "" || deliveryDate === "") return;
    if (isReturn && returnIso === null) return;
    setProblem(null);
    setBusy(true);
    const result = await previewReceipt(party.party_id, {
      source_revision: context.source_revision ?? -1,
      reconciliation_revision: context.reconciliation_revision ?? -1,
      vet_inspection: vetInspection,
      delivery_date: deliveryIso,
      return_date: returnIso,
    });
    setBusy(false);
    if ("code" in result) {
      setProblem(result);
      return;
    }
    setPreview(result);
    setDialogOpen(true);
  }

  async function confirm(): Promise<void> {
    if (preview === null || context === null || vetInspection === "" || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setProblem(null);
    const result = await submitReceipt(
      party.party_id,
      {
        source_revision: context.source_revision ?? -1,
        reconciliation_revision: context.reconciliation_revision ?? -1,
        vet_inspection: vetInspection,
        delivery_date: deliveryIso,
        return_date: returnIso,
        // ТЗ DR8 §9: the frozen server issue date is echoed so the re-built
        // preview keeps the exact fingerprint (one frozen intent).
        issue_date: preview.intent.issue_date,
        fingerprint: preview.fingerprint,
      },
      crypto.randomUUID(),
    );
    setBusy(false);
    if ("code" in result) {
      submitted.current = false;
      setProblem(result);
      return;
    }
    setDialogOpen(false);
    setOperationId(result.operation_id);
    await queryClient.invalidateQueries({ queryKey: [party.laboratory_id, party.party_id] });
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
        <StatusView state="forbidden" title="Гашение не подготовлено" detail={problem.detail} />
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

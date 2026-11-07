/**
 * ExaminationViewPage (E04, API-05): the card view at
 * /labs/:labId/examinations/:examinationId.
 *
 * Readonly: the participants, the four classification levels and the accepted
 * volume (SC-033/034) plus the saved номер/клеймо/исследования/проба/итог.
 * Actions are strictly separate: the same-day edit (PUT), the explicit late
 * completion of a WAITING card (complete-waiting — the outcome block only)
 * and the delete dialog. A WAITING card shows NO conclusion: no outcome,
 * direction or reason is displayed (SC-047) and no print/download control
 * exists here at all.
 */
import "../features/examinations/examinations.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { fetchArrival } from "../features/arrivals/api";
import type { IncomingView, Problem } from "../features/arrivals/api";
import { fetchCollections, type CollectionView } from "../features/samples/api";
import {
  completeWaiting,
  examinationKey,
  fetchExamination,
  type ExaminationView,
  type OutcomeWrite,
} from "../features/examinations/api";
import { ExaminationForm } from "../features/examinations/ExaminationForm";
import { PartyReadonlyFacts } from "../features/examinations/SampleSelection";
import { OutcomeFields, outcomeText } from "../features/examinations/OutcomeFields";
import { DeleteDialog } from "../features/examinations/DeleteDialog";
import { emptyOutcome, type OutcomeEntry } from "../features/examinations/formValues";
import { useCommand } from "../shared/api/command";
import { Button } from "../shared/ui/Button";
import { InfoField } from "../shared/ui/InfoField";
import { StatusView } from "../shared/ui/StatusView";
import { useMe } from "../shared/api/me";

/** Same calendar day in Europe/Moscow (the server's day rule, SPEC-05). */
function moscowDay(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(new Date(iso));
}

export function ExaminationViewPage(): React.ReactElement {
  return (
    <RequireSession>
      <ExaminationViewContent />
    </RequireSession>
  );
}

function problemOf(data: unknown): Problem | null {
  return data !== undefined && data !== null && typeof data === "object" && "code" in data
    ? (data as Problem)
    : null;
}

function ExaminationViewContent(): React.ReactElement {
  const { labId, examinationId } = useParams<{ labId: string; examinationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const command = useCommand<ExaminationView>();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [outcome, setOutcome] = useState<OutcomeEntry>(emptyOutcome());
  const [lateError, setLateError] = useState("");

  const card = useQuery({
    queryKey: examinationKey(examinationId ?? ""),
    queryFn: ({ signal }) => fetchExamination(examinationId ?? "", signal),
    enabled: examinationId !== undefined,
  });
  const view: ExaminationView | null = card.data !== undefined && !("code" in card.data) ? card.data : null;
  const cardProblem = problemOf(card.data);

  const party = useQuery({
    queryKey: [labId ?? null, view?.party_id ?? null, "arrival"],
    queryFn: ({ signal }) => fetchArrival(view?.party_id ?? "", signal),
    enabled: view !== null && labId !== undefined,
  });
  const partyView: IncomingView | null =
    party.data !== undefined && !("code" in party.data) ? party.data : null;

  const collections = useQuery({
    queryKey: [labId ?? null, view?.party_id ?? null, "available-collections"],
    queryFn: ({ signal }) => fetchCollections({ laboratory_id: labId ?? "", page: 1 }, signal),
    enabled: view !== null && labId !== undefined,
  });
  const allCollections: CollectionView[] =
    collections.data !== undefined && !("code" in collections.data)
      ? (collections.data as { items: CollectionView[] }).items
      : [];

  if (labId === undefined || examinationId === undefined) {
    return (
      <div className="vse-app vse-page">
        <StatusView state="not-found" title="Карточка не указана." />
      </div>
    );
  }

  if (cardProblem !== null) {
    return (
      <div className="vse-app vse-page">
        <nav className="vse-breadcrumb" aria-label="Навигация">
          <Link to={`/labs/${labId}/examinations`}>← Журнал ВСЭ</Link>
        </nav>
        <h1>Карточка ВСЭ</h1>
        <StatusView
          state={cardProblem.status === 404 ? "not-found" : "network-error"}
          title={
            cardProblem.status === 404
              ? "Карточка не найдена в доступной области."
              : "Не удалось загрузить карточку."
          }
          detail={cardProblem.detail}
          onRetry={() => void card.refetch()}
        />
      </div>
    );
  }
  if (card.isLoading || view === null) {
    return (
      <div className="vse-app vse-page">
        <StatusView state="loading" title="Загрузка карточки ВСЭ…" />
      </div>
    );
  }

  const waiting = view.status === "WAITING";
  const todayMoscow = moscowDay(new Date().toISOString());
  const sameDay = moscowDay(view.created_at) === todayMoscow;
  const role = me.user?.role ?? null;
  const canAct = role === "VET" || role === "HEAD";

  const runLateOutcome = (): void => {
    if (outcome.outcome === "" || outcome.direction === "") {
      setLateError("Выберите итог и направление.");
      return;
    }
    if (outcome.outcome === "UNFIT" && outcome.reason.trim() === "") {
      setLateError("Укажите причину направления.");
      return;
    }
    setLateError("");
    const payload: OutcomeWrite = {
      outcome: outcome.outcome as "FIT" | "UNFIT",
      direction: outcome.direction as "SALE" | "DISPOSAL" | "DESTRUCTION",
      ...(outcome.outcome === "UNFIT" ? { reason: outcome.reason.trim() } : {}),
    };
    void command.submit(
      async (ctx: { idempotencyKey: string; signal: AbortSignal }) => {
        const result = await completeWaiting(view.id, payload, `"${view.revision}"`)(ctx);
        if (result.response.ok && result.data !== undefined) {
          queryClient.setQueryData(examinationKey(view.id), result.data);
        }
        return result;
      },
      { queryKey: examinationKey(view.id) },
    );
  };

  const problem = command.error;

  return (
    <div className="vse-app vse-page">
      <nav className="vse-breadcrumb" aria-label="Навигация">
        <Link to={`/labs/${labId}/examinations`}>← Журнал ВСЭ</Link>
      </nav>
      <h1>Карточка ВСЭ {view.number}</h1>
      <div className="vse-samples-links">
        <span className={`vse-status-badge ${waiting ? "waiting" : "completed"}`}>
          {waiting ? "Ожидание результатов" : "Завершено"}
        </span>
        {canAct && sameDay && !editing ? (
          <Button variant="primary" onClick={() => setEditing(true)}>
            Исправить карточку
          </Button>
        ) : null}
        {canAct && sameDay && !editing ? (
          <Button variant="danger" onClick={() => setDeleting(true)}>
            Удалить
          </Button>
        ) : null}
        {canAct && !sameDay ? (
          <span className="vse-arrival-hint">
            После дня создания доступны только действия над итогом ожидающей карточки (AT-07).
          </span>
        ) : null}
      </div>

      {partyView !== null ? (
        <PartyReadonlyFacts party={partyView} headline="Подтверждённая партия" />
      ) : party.isLoading ? null : (
        <StatusView
          state="network-error"
          title="Не удалось загрузить партию."
          detail={problemOf(party.data)?.detail}
        />
      )}

      {editing ? (
        <ExaminationForm
          party={partyView as IncomingView}
          view={view}
          today={todayMoscow}
          availableCollections={allCollections.filter(
            (collection) => collection.party_id === view.party_id && collection.disposal_id === null,
          )}
          onSaved={(next) => {
            queryClient.setQueryData(examinationKey(view.id), next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <section className="vse-exam-block" aria-label="Карточка ВСЭ">
          <h3>Карточка ВСЭ</h3>
          <dl className="vse-exam-facts">
            <div>
              <dt>Номер ВСЭ</dt>
              <dd>{view.number}</dd>
            </div>
            <div>
              <dt>Ветеринарное клеймо</dt>
              <dd>{view.stamp}</dd>
            </div>
            <div>
              <dt>Дата и время создания</dt>
              <dd>{view.created_at}</dd>
            </div>
            <div>
              <dt>Специалист Госветслужбы</dt>
              <dd>{view.created_by}</dd>
            </div>
            <div>
              <dt>Связанная проба</dt>
              <dd>{view.sample_collection_id}</dd>
            </div>
            <div>
              <dt>Пробы отправлены в спец. лабораторию</dt>
              <dd>{view.sent_to_lab ? "Да" : "Нет"}</dd>
            </div>
          </dl>
        </section>
      )}

      {!editing ? (
        <section className="vse-exam-block" aria-label="Исследования ВСЭ">
          <h3>Исследования ВСЭ</h3>
          {view.researches.length === 0 ? (
            <p className="vse-exam-note">Результаты не сохранены.</p>
          ) : (
            <dl className="vse-exam-facts">
              {view.researches.map((raw, index) => {
                const item = raw as {
                  indicatorId?: string;
                  kind?: string;
                  value?: unknown;
                  otherText?: string | null;
                };
                const pair =
                  item.kind === "DOSIMETRY" ? (item.value as { first: string; last: string }) : null;
                return (
                  <div key={item.indicatorId ?? index}>
                    <dt>{`Показатель ${item.indicatorId ?? index + 1}`}</dt>
                    <dd>
                      {item.kind === "BOOLEAN"
                        ? item.value === true
                          ? "Не обнаружено"
                          : "Обнаружено"
                        : item.kind === "DOSIMETRY" && pair !== null
                          ? `${pair.first} / ${pair.last} мкЗв/ч`
                          : `${String(item.value ?? "—")}${item.otherText ? ` (${item.otherText})` : ""}`}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
          {view.invasive_findings.length > 0 || view.noncontagious_findings.length > 0 ? (
            <dl className="vse-exam-facts">
              {view.invasive_findings.map((raw, index) => {
                const item = raw as { disease: string; location: string; otherText?: string | null };
                return (
                  <div key={`invasive-${index}`}>
                    <dt>Инвазионная болезнь</dt>
                    <dd>{`${item.disease} — ${item.location}${item.otherText ? ` (${item.otherText})` : ""}`}</dd>
                  </div>
                );
              })}
              {view.noncontagious_findings.map((raw, index) => {
                const item = raw as { disease: string; otherText?: string | null };
                return (
                  <div key={`noncontagious-${index}`}>
                    <dt>Незаразная болезнь</dt>
                    <dd>{`${item.disease}${item.otherText ? ` (${item.otherText})` : ""}`}</dd>
                  </div>
                );
              })}
            </dl>
          ) : null}
          <InfoField
            label="Расчёт стоимости"
            value={
              typeof (view.pricing as { total?: unknown }).total === "string"
                ? `${(view.pricing as { total: string }).total} ₽`
                : "—"
            }
          />
        </section>
      ) : null}

      {!editing ? (
        waiting ? (
          canAct ? (
            <section className="vse-exam-block" aria-label="Итог экспертизы">
              <h3>Итог специальной лаборатории</h3>
              <p className="vse-exam-note">
                Заключение формируется только после завершения карточки. Подтверждение ответа — отдельное
                действие; изменение остальных полей после дня создания невозможно.
              </p>
              <OutcomeFields
                variant="late"
                idPrefix="late"
                value={outcome}
                disabled={command.status === "pending"}
                onChange={(next) => setOutcome(next)}
              />
              <div className="vse-form-actions">
                <Button
                  variant="primary"
                  busy={command.status === "pending"}
                  busyLabel="Завершаем ожидание…"
                  aria-label="Завершить ожидание результата"
                  onClick={() => runLateOutcome()}
                >
                  Завершить ожидание
                </Button>
              </div>
              {lateError !== "" ? (
                <StatusView state="forbidden" title="Проверьте введённые значения." detail={lateError} />
              ) : null}
              {problem !== null && problem.code !== "VALIDATION_ERROR" ? (
                <StatusView
                  state="network-error"
                  title="Не удалось завершить карточку."
                  detail={problem.detail}
                  trace={problem.trace_id !== "" ? `trace_id: ${problem.trace_id}` : undefined}
                  onRetry={() => void command.retry()}
                />
              ) : null}
            </section>
          ) : (
            <section className="vse-exam-block" aria-label="Итог экспертизы">
              <h3>Итог экспертизы</h3>
              <p className="vse-exam-note">Итог не указан: карточка ожидает ответа лаборатории.</p>
            </section>
          )
        ) : (
          <section className="vse-exam-block" aria-label="Итог экспертизы">
            <h3>Итог экспертизы</h3>
            <InfoField label="Результат" value={outcomeText(view.outcome, view.direction)} />
            {view.reason !== null ? <InfoField label="Причина направления" value={view.reason} /> : null}
            <InfoField label="Дата первого завершения" value={view.first_completed_at ?? "—"} />
          </section>
        )
      ) : null}

      <DeleteDialog
        view={view}
        open={deleting}
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          void queryClient.invalidateQueries({ queryKey: ["arrivals"] });
          void navigate(`/labs/${labId}/examinations`);
        }}
      />
    </div>
  );
}

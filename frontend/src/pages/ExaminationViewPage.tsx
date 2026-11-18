/**
 * ExaminationViewPage (E04, API-05, ТЗ DR44 §4): the saved card view at
 * /labs/:labId/examinations/:examinationId, composed like ``vse-view.html``.
 *
 * Six white sections reuse the shared components of the create page
 * (FormSection/ReadonlyField/ExaminationFactsSection/ParticipantsSection) and
 * the readonly saved-card components (SavedResearchResults/SavedPricingTable).
 * The mockup's demonstration data and per-carcass rows are NOT carried over:
 * the actual model is ONE result per accepted party. Actions are strictly
 * separate: the same-day edit (PUT), the explicit late completion of a
 * WAITING card (the outcome block only) and the delete dialog. A WAITING card
 * shows NO fabricated conclusion (SC-047).
 */
import "../features/examinations/examinations.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { fetchArrival, formatRuDate, type IncomingView, type Problem } from "../features/arrivals/api";
import type { CollectionView } from "../features/samples/api";
import { fetchCollections } from "../features/samples/api";
import {
  completeWaiting,
  examinationKey,
  fetchExamination,
  fetchExaminationForm,
  type ExaminationView,
  type OutcomeWrite,
  type PricingSnapshotView,
} from "../features/examinations/api";
import { SavedPricingTable } from "../features/examinations/SavedPricingTable";
import { SavedResearchResults } from "../features/examinations/SavedResearchResults";
import { ExaminationFactsSection, ParticipantsSection } from "../features/examinations/ExaminationSections";
import { ExaminationForm } from "../features/examinations/ExaminationForm";
import { OutcomeFields, outcomeText } from "../features/examinations/OutcomeFields";
import { DeleteDialog } from "../features/examinations/DeleteDialog";
import { emptyOutcome, type OutcomeEntry } from "../features/examinations/formValues";
import { useCommand } from "../shared/api/command";
import { Button } from "../shared/ui/Button";
import { Tooltip } from "../shared/ui/HelpTooltip";
import { FormSection } from "../shared/ui/FormSection";
import { ReadonlyField } from "../shared/ui/ReadonlyField";
import { StatusView } from "../shared/ui/StatusView";
import { formatDecimalDisplay } from "../shared/lib/domain";
import { formatMoscowCellDateTime } from "../shared/lib/dates";
import { useMe } from "../shared/api/me";

/** Same calendar day in Europe/Moscow (the server's day rule, SPEC-05). */
function moscowDay(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(new Date(iso));
}

/** ТЗ DR44 §4.1: «ВСЭ №154» stays, «154» becomes «ВСЭ №154». */
export function examinationTitle(number: string): string {
  const trimmed = number.trim();
  return trimmed.startsWith("№") ? `ВСЭ ${trimmed}` : `ВСЭ №${trimmed}`;
}

/** The frozen pricing snapshot of the card (honest absence on damage). */
function savedSnapshot(view: ExaminationView): PricingSnapshotView | null {
  try {
    return view.pricing as PricingSnapshotView;
  } catch {
    return null;
  }
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
    enabled: view !== null && labId !== undefined && editing,
  });
  const allCollections: CollectionView[] =
    collections.data !== undefined && !("code" in collections.data)
      ? (collections.data as { items: CollectionView[] }).items
      : [];

  // DR35 §4: the frozen form read model for the same-day edit (required
  // researches and the scoped specialist list).
  const formViewQuery = useQuery({
    queryKey: [labId ?? null, view?.party_id ?? null, "examination-form"],
    queryFn: ({ signal }) => fetchExaminationForm(view?.party_id ?? "", signal),
    enabled: view !== null && labId !== undefined && editing,
  });
  const formView =
    formViewQuery.data !== undefined && !("code" in formViewQuery.data) ? formViewQuery.data : null;

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
        <h1>Просмотр записи</h1>
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
    <div className="vse-app vse-page vse-exam-page">
      {/* ТЗ DR46 §3.2: no «← Журнал ВСЭ» breadcrumb and no title badge — the
          journal navigation stays in the shell header and the status lives in
          the «Сведения об экспертизе» block. */}
      <div className="vse-page-head">
        <div>
          <p className="vse-eyebrow">Просмотр записи</p>
          <h1>{examinationTitle(view.number)}</h1>
        </div>
        <div className="vse-page-actions">
          {canAct && sameDay && !editing ? (
            <Tooltip text="Редактировать ВСЭ">
              <Button
                variant="secondary"
                icon="admin-edit"
                iconOnly
                label="Редактировать ВСЭ"
                onClick={() => setEditing(true)}
              />
            </Tooltip>
          ) : null}
          {canAct && sameDay && !editing ? (
            <Tooltip text="Удалить ВСЭ">
              <Button
                variant="danger"
                icon="admin-delete"
                iconOnly
                label="Удалить ВСЭ"
                onClick={() => setDeleting(true)}
              />
            </Tooltip>
          ) : null}
          {canAct && !sameDay ? (
            /* ТЗ DR47 §2.2: the honest day rule — no internal codes, in the
               same subject condition as the hidden same-day actions. */
            <span className="vse-arrival-hint">
              Редактировать или удалить карточку можно только в день её создания.
            </span>
          ) : null}
        </div>
      </div>

      {/* In edit mode the form itself carries the party sections (DR30). */}
      {editing ? (
        <ExaminationForm
          party={partyView as IncomingView}
          view={view}
          today={todayMoscow}
          formView={formView}
          currentUserId={me.user?.id ?? null}
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
        <>
          {partyView === null ? (
            party.isLoading ? null : (
              <StatusView
                state="network-error"
                title="Не удалось загрузить партию."
                detail={problemOf(party.data)?.detail}
              />
            )
          ) : (
            <>
              {/* 1 «Сведения об экспертизе»: the card facts + the document. */}
              <ExaminationFactsSection party={partyView}>
                <div className="vse-span6">
                  <ReadonlyField label="Номер ВСЭ" value={view.number} />
                </div>
                <div className="vse-span6">
                  <ReadonlyField
                    label="Дата и время создания"
                    value={formatMoscowCellDateTime(view.created_at)}
                  />
                </div>
                <div className="vse-span6">
                  <ReadonlyField
                    label="Статус карточки"
                    value={waiting ? "Ожидание результатов" : "Завершено"}
                  />
                </div>
              </ExaminationFactsSection>

              {/* 2 «Участники и продукция»: the create-page component + клеймо. */}
              <ParticipantsSection party={partyView}>
                <div className="vse-span6">
                  <ReadonlyField label="Ветеринарное клеймо" value={view.stamp} />
                </div>
              </ParticipantsSection>

              {/* 3 «Исследования ВСЭ»: only really saved researches. */}
              <SavedResearchResults view={view} />

              {/* 4 «Проба»: the linked physical sample from view.sample. */}
              <FormSection
                icon="exam-sample"
                title="Проба"
                description="Данные физической пробы, отобранной для этой партии."
              >
                {/* ТЗ DR46 §3.3: the readonly view-only sample block is a
                    single-column stack — never the 3/3/6 form grid. */}
                <div className="vse-sample-view-stack">
                  <ReadonlyField label="Дата отбора пробы" value={formatRuDate(view.sample.collected_on)} />
                  <ReadonlyField label="Масса пробы, кг" value={formatDecimalDisplay(view.sample.mass_kg)} />
                  <ReadonlyField
                    label="Пробы отправлены в специальную лабораторию"
                    value={view.sent_to_lab ? "Да" : "Нет"}
                  />
                </div>
              </FormSection>

              {/* 5 «Итог экспертизы»: WAITING never fabricates a conclusion. */}
              {waiting ? (
                <FormSection
                  icon="check-complete"
                  title="Итог экспертизы"
                  description="Заключение и специалист, проводивший ВСЭ."
                >
                  <p className="vse-exam-note">Итог не указан: карточка ожидает ответа лаборатории.</p>
                  {canAct ? (
                    <>
                      <p className="vse-exam-note">
                        Заключение формируется только после завершения карточки. Подтверждение ответа —
                        отдельное действие; изменение остальных полей после дня создания невозможно.
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
                        <StatusView
                          state="forbidden"
                          title="Проверьте введённые значения."
                          detail={lateError}
                        />
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
                    </>
                  ) : null}
                </FormSection>
              ) : (
                <FormSection
                  icon="check-complete"
                  title="Итог экспертизы"
                  description="Заключение и специалист, проводивший ВСЭ."
                >
                  <div className="vse-exam-grid">
                    <div className="vse-span6">
                      <ReadonlyField label="Результат" value={outcomeText(view.outcome, view.direction)} />
                    </div>
                    <div className="vse-span6">
                      <ReadonlyField label="Специалист Госветслужбы" value={view.specialist_name ?? "—"} />
                    </div>
                    {view.reason !== null ? (
                      <div className="vse-span6">
                        <ReadonlyField label="Причина направления" value={view.reason} />
                      </div>
                    ) : null}
                    <div className="vse-span6">
                      <ReadonlyField
                        label="Дата первого завершения"
                        value={
                          view.first_completed_at !== null
                            ? formatMoscowCellDateTime(view.first_completed_at)
                            : "—"
                        }
                      />
                    </div>
                  </div>
                </FormSection>
              )}

              {/* 6 «Расчёт стоимости услуг»: the frozen snapshot, no preview. */}
              <SavedPricingTable snapshot={savedSnapshot(view)} />
            </>
          )}
        </>
      )}

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

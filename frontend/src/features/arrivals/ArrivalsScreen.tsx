/**
 * The arrivals queue screen composition (DR3): ONE composition used by the
 * working route AND the Storybook full-page stories — the same React code
 * and styles everywhere. Data and callbacks arrive as props; the page owns
 * the queries, URL state and mutations.
 */
import "./arrivals.css";
import {
  ACCEPTED_OPTIONAL_COLUMN_IDS,
  CompletedArrivalsTable,
  ExpectedArrivalsTable,
  WorkArrivalsTable,
} from "./ArrivalTables";
import { ArrivalsFilters, ColumnsChooser } from "./ArrivalsFilters";
import { ArrivalsPagination } from "./ArrivalsPagination";
import { ReconciliationDateFilter, type AppliedReconciliationDate } from "./ReconciliationDateFilter";
import { StageTabs, type StageCount } from "./StageTabs";
import {
  STAGE_DESCRIPTIONS,
  SORT_LABELS_BY_QUEUE,
  type ArrivalQueue,
  type ArrivalSort,
  type IncomingView,
  type Problem,
} from "./api";
import { StatusView } from "../../shared/ui/StatusView";

export interface ArrivalsScreenProps {
  queue: ArrivalQueue;
  counts: Readonly<Record<ArrivalQueue, StageCount>>;
  onQueueChange: (queue: ArrivalQueue) => void;
  q: string;
  onSearch: (q: string) => void;
  result: string;
  onResultChange: (result: string) => void;
  /** DR15 §5.1: the issue-date sort of the EXPECTED queue only. */
  sort: ArrivalSort;
  onSortChange: (sort: ArrivalSort) => void;
  /** ТЗ DR39 §7: the ACCEPTED-only applied reconciliation date (URL state). */
  reconciled: AppliedReconciliationDate;
  onReconciledApply: (next: AppliedReconciliationDate) => void;
  hiddenColumns: ReadonlySet<string>;
  onToggleColumn: (id: string) => void;
  labId: string;
  items: readonly IncomingView[];
  loading: boolean;
  problem: Problem | null;
  onRetry: () => void;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  onHide?: ((partyId: string) => void) | undefined;
  sync?: React.ReactElement | undefined;
  syncStatus?: string;
}

const OPTIONAL_COLUMN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  checkAuthor: "Автор сверки данных",
  vseAuthor: "Автор ВСЭ",
  vseNumber: "Номер ВСЭ",
});

export function ArrivalsScreen({
  queue,
  counts,
  onQueueChange,
  q,
  onSearch,
  result,
  onResultChange,
  sort,
  onSortChange,
  reconciled,
  onReconciledApply,
  hiddenColumns,
  onToggleColumn,
  labId,
  items,
  loading,
  problem,
  onRetry,
  page,
  pageCount,
  onPage,
  onHide,
  sync,
  syncStatus,
}: ArrivalsScreenProps): React.ReactElement {
  const table = (): React.ReactElement => {
    switch (queue) {
      case "WORK":
        return <WorkArrivalsTable labId={labId} items={items} />;
      case "ACCEPTED":
        return <CompletedArrivalsTable labId={labId} items={items} hiddenColumns={hiddenColumns} />;
      default:
        return <ExpectedArrivalsTable labId={labId} items={items} onHide={onHide} />;
    }
  };

  const filters =
    queue === "ACCEPTED" ? (
      <ArrivalsFilters
        key={q}
        q={q}
        onSearch={onSearch}
        result={result}
        onResultChange={onResultChange}
        // ТЗ DR39 §4.2: the ACCEPTED sort + its own labels; the date filter
        // arrives as an additional control slot of the same panel.
        sort={sort}
        onSortChange={onSortChange}
        sortLabels={SORT_LABELS_BY_QUEUE.ACCEPTED}
        columns={
          <>
            {/* ТЗ DR39 §7: the date filter lives INSIDE the same filter panel. */}
            <ReconciliationDateFilter applied={reconciled} onApply={onReconciledApply} />
            <ColumnsChooser
              options={ACCEPTED_OPTIONAL_COLUMN_IDS.map((id) => ({
                id,
                label: OPTIONAL_COLUMN_LABELS[id] ?? id,
              }))}
              hidden={hiddenColumns}
              onToggle={onToggleColumn}
            />
          </>
        }
      />
    ) : (
      <ArrivalsFilters
        key={q}
        q={q}
        onSearch={onSearch}
        // ТЗ DR39 §4: the sort is queue-aware on EVERY queue — one select,
        // one «asc|desc» contract, the labels belong to the queue.
        sort={sort}
        onSortChange={onSortChange}
        sortLabels={SORT_LABELS_BY_QUEUE[queue]}
      />
    );

  return (
    <div className="arrivals-shell">
      <div className="arrivals-title-row">
        <div>
          <h1>Поступления</h1>
          <p>{STAGE_DESCRIPTIONS[queue]}</p>
        </div>
        {/* DR29 §3 / ТЗ DR41 §5: the sync status lives IN the sync group,
            directly above the refresh button — ONE compact role=status with
            the short user text; technical counters are never appended. */}
        {sync !== undefined ? (
          <div className="arrivals-sync">
            {(syncStatus ?? "") !== "" ? (
              <p className="arrivals-sync-status" role="status">
                {syncStatus}
              </p>
            ) : null}
            {sync}
          </div>
        ) : (syncStatus ?? "") !== "" ? (
          <p className="arrivals-sync-status" role="status">
            {syncStatus}
          </p>
        ) : null}
      </div>

      <StageTabs current={queue} counts={counts} onQueueChange={onQueueChange} />
      {filters}

      {loading ? (
        <StatusView state="loading" title="Загрузка поступлений…" />
      ) : problem !== null ? (
        <StatusView
          state={problem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
          title={problem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить поступления."}
          detail={problem.detail}
          trace={problem.trace_id !== "" ? `trace_id: ${problem.trace_id}` : undefined}
          onRetry={onRetry}
        />
      ) : (
        <>
          {table()}
          <ArrivalsPagination page={page} pageCount={pageCount} onPage={onPage} />
        </>
      )}
    </div>
  );
}

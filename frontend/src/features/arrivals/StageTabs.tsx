/**
 * StageTabs (DR3, spec 7): the pill tabs of the three arrival stages with
 * their REAL queue totals. A failed counter renders a neutral dash and never
 * blocks the queue. The active stage is announced by aria-selected; the URL
 * stays the single source of truth (queue=expected|work|accepted).
 */
import { STAGE_LABELS, type ArrivalQueue } from "./api";

export type StageCount = number | "loading" | "failed";

export interface StageTabsProps {
  current: ArrivalQueue;
  counts: Readonly<Record<ArrivalQueue, StageCount>>;
  onQueueChange: (queue: ArrivalQueue) => void;
}

function countText(count: StageCount): string {
  if (count === "loading") return "…";
  if (count === "failed") return "—";
  return String(count);
}

export function StageTabs({ current, counts, onQueueChange }: StageTabsProps): React.ReactElement {
  const queues: readonly ArrivalQueue[] = ["EXPECTED", "WORK", "ACCEPTED"];
  return (
    <nav className="arrivals-stage-tabs" aria-label="Разделы поступлений">
      {queues.map((queue) => (
        <button
          key={queue}
          type="button"
          className="arrivals-stage-tab"
          aria-selected={current === queue}
          aria-current={current === queue ? "true" : undefined}
          onClick={() => onQueueChange(queue)}
        >
          {STAGE_LABELS[queue]}
          <span className="count">{countText(counts[queue])}</span>
        </button>
      ))}
    </nav>
  );
}

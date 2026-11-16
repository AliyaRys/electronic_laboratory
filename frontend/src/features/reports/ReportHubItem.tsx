/**
 * ReportHubItem (DR37 §Task 4): one row-card of the reports hub, the React
 * composition of the ``.analyst-item`` row of ``analyst_makets``. The name
 * and the meta are real data of the direction (never a static period or a
 * technical UUID); the action is one keyboard-accessible link or button —
 * the row container itself is NOT clickable, so the nested control is not
 * duplicated by a wrapper.
 */
import { Link } from "react-router";

export interface ReportHubItemProps {
  name: string;
  /** Real metadata: a saved period, a real count, an honest empty/loading state. */
  meta?: string;
  /** Target of the «Открыть» action; omit when the row has no action. */
  to?: string;
  /** Accessible name of the action link (defaults to the visible «Открыть»). */
  actionLabel?: string;
  actionVisibleLabel?: string;
}

export function ReportHubItem({
  name,
  meta,
  to,
  actionLabel,
  actionVisibleLabel = "Открыть",
}: ReportHubItemProps): React.ReactElement {
  return (
    <article className="vse-reports-hub-item">
      <div>
        <div className="vse-reports-hub-name">{name}</div>
        {meta !== undefined ? <div className="vse-reports-hub-meta">{meta}</div> : null}
      </div>
      {to !== undefined ? (
        <div className="vse-reports-hub-actions">
          <Link className="app-button secondary" to={to} aria-label={actionLabel ?? actionVisibleLabel}>
            {actionVisibleLabel}
          </Link>
        </div>
      ) : null}
    </article>
  );
}

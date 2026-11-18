/**
 * ReportHeader (DR51 §6.1): the single compact header of the 5-вет report,
 * shared by the preview and the saved view. It shows only the creation
 * date, the period and the laboratory — no sources, versions, signature,
 * formal half-year heading or the cancelled seven codes. All instants are
 * formatted from the SERVER time in Europe/Moscow («ДД.ММ.ГГГГ, ЧЧ:ММ»);
 * the browser clock is never used.
 */

const MOSCOW = "Europe/Moscow";

/** «ДД.ММ.ГГГГ, ЧЧ:ММ» in Europe/Moscow from an ISO instant (server time). */
export function formatMoscow(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return formatter.format(instant).replace(",", ", ");
}

/** «ДД.ММ.ГГГГ — ДД.ММ.ГГГГ»; one day prints a single date. */
export function periodLabel(dateFrom: string, dateTo: string): string {
  const ru = (iso: string): string => {
    const parts = iso.split("-");
    return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : iso;
  };
  return dateFrom === dateTo ? ru(dateFrom) : `${ru(dateFrom)} — ${ru(dateTo)}`;
}

export interface ReportHeaderProps {
  /** «Дата создания» (saved) or «Дата формирования» (preview before save). */
  createdLabel: string;
  /** The server instant (ISO) of the preview generation or the save. */
  createdAt: string;
  dateFrom: string;
  dateTo: string;
  laboratory: string;
}

export function ReportHeader({
  createdLabel,
  createdAt,
  dateFrom,
  dateTo,
  laboratory,
}: ReportHeaderProps): React.ReactElement {
  return (
    <section className="vse-report-header" aria-label="Шапка отчёта">
      <h2 className="vse-report-header-title">5-вет, раздел III</h2>
      <dl className="vse-report-header-meta">
        <div>
          <dt>{createdLabel}</dt>
          <dd>{formatMoscow(createdAt)}</dd>
        </div>
        <div>
          <dt>Период</dt>
          <dd>{periodLabel(dateFrom, dateTo)}</dd>
        </div>
        <div>
          <dt>Лаборатория</dt>
          <dd>{laboratory}</dd>
        </div>
      </dl>
    </section>
  );
}

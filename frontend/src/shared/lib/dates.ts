/**
 * Time helpers (SPEC-05). Creation day and period bounds are defined in
 * Europe/Moscow; the server remains the source of the instant for commands.
 * Identifiers are never converted to numbers here.
 */

const MOSCOW_OFFSET = "+03:00";

/** Half-open day range ``[from 00:00, to+1day 00:00)`` in Europe/Moscow (API-01). */
export function moscowDayRange(fromDay: string, toDay: string): { from: string; to: string } {
  return { from: `${fromDay}T00:00:00${MOSCOW_OFFSET}`, to: `${nextDay(toDay)}T00:00:00${MOSCOW_OFFSET}` };
}

function nextDay(day: string): string {
  const instant = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError(`Некорректная дата: ${day}`);
  }
  instant.setUTCDate(instant.getUTCDate() + 1);
  return instant.toISOString().slice(0, 10);
}

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatMoscowDate(instant: string | Date): string {
  return dateFormatter.format(new Date(instant));
}

export function formatMoscowDateTime(instant: string | Date): string {
  return dateTimeFormatter.format(new Date(instant));
}

/**
 * ТЗ DR39 §4.1: the table cell form «ДД.ММ.ГГГГ ЧЧ:ММ» (a space, no comma —
 * the accepted cell format of the arrivals tables) in Europe/Moscow, never
 * the browser timezone.
 */
export function formatMoscowCellDateTime(instant: string): string {
  const parts = dateTimeFormatter.formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")}.${value("month")}.${value("year")} ${value("hour")}:${value("minute")}`;
}

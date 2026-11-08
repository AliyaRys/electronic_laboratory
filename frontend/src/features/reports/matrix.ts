/**
 * Matrix projection helpers (R03, API-08/ФТ 09): one saved snapshot payload →
 * the read-only displayed matrix. The client NEVER recomputes a saved
 * snapshot (R02 contract): the screen shows the payload's own values, and a
 * changed source never invalidates it. The printed form merges the two bird
 * data columns into one «Птица — куры/другие» column, exactly like the
 * backend projection for PDF/XLSX.
 */

/** The automatic row names of the printed form (ФТ 09, INPUT-04). */
export const ROW_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "166": "Проведено ВСЭ",
  "167": "Бактериоскопия и микроскопия",
  "168": "Трихинеллоскопия",
  "169": "pH, пероксидаза, реакция с сернокислой медью",
  "170": "Дозометрическое исследование",
  "171": "Проба варки, люминесцентный анализ, температура",
  "172": "Отправка проб в аккредитованную лабораторию",
  "240": "На уничтожение, тонн",
  "241": "в том числе мясо",
  "242": "в том числе субпродукты",
});

const COLUMN_NAMES: Readonly<Record<string, string>> = Object.freeze({
  CATTLE: "КРС",
  PIG: "Свиньи",
  SHEEP_GOAT: "Овцы и козы",
  RABBIT_NUTRIA: "Кролики и нутрии",
  CHICKEN: "Птица — куры",
  OTHER_BIRDS: "Птица — другие",
  FISH: "Рыба",
  OTHER_ANIMALS: "Прочие",
});

export const BIRD_COLUMN = "Птица — куры/другие";
export const NOT_CALCULATED = "Не рассчитывается";
export const DASH = "—";

const MANUAL_ROWS: readonly { code: string; name: string }[] = [
  { code: "sickness_of_animals", name: "Заболеваемость животных" },
  { code: "inspections_of_meat", name: "Осмотры мяса" },
];

export interface MatrixRow {
  code: string;
  name: string;
  automatic: boolean;
  /** One displayed cell per printed column; strings exactly as saved. */
  values: string[];
}

export interface MatrixModel {
  columns: string[];
  rows: MatrixRow[];
  /** Frozen provenance shown under the matrix ("версия классификации …"). */
  versions: string[];
  sourceCount: number;
}

/** Exact decimal-string addition on scale-6 BigInt units; no float arithmetic. */
export const DECIMAL_SCALE = 6n;

/** Parse one payload decimal string into scale-6 integer units (BigInt). */
export function toScaledUnits(value: string): bigint {
  if (value === "") return 0n;
  const trimmed = value.trim();
  const match = /^-?\d+(\.\d+)?$/.exec(trimmed);
  if (match === null) return 0n;
  const negative = trimmed.startsWith("-");
  const digits = negative ? trimmed.slice(1) : trimmed;
  const [integer = "0", fraction = ""] = digits.split(".");
  const paddedFraction = (fraction + "000000").slice(0, 6);
  const units = BigInt(integer) * 10n ** DECIMAL_SCALE + BigInt(paddedFraction);
  return negative ? -units : units;
}

/** Format scale-6 integer units back into a plain decimal string. */
export function formatScaled(units: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const integerPart = magnitude / 10n ** DECIMAL_SCALE;
  const fractionPart = magnitude % 10n ** DECIMAL_SCALE;
  const fraction = fractionPart.toString().padStart(6, "0").replace(/0+$/, "");
  if (units === 0n) return "0";
  const sign = negative ? "-" : "";
  return fraction === "" ? `${sign}${integerPart}` : `${sign}${integerPart}.${fraction}`;
}

/** The sum of two decimal strings without any float arithmetic; "" stays ""-neutral. */
export function addDecimals(left: string, right: string): string {
  const total = toScaledUnits(left) + toScaledUnits(right);
  if (left === "" && right === "") return "";
  return formatScaled(total);
}

/**
 * Build the displayed matrix strictly from the saved payload. No live data
 * ever contributes; missing payload pieces degrade to «—», never a guess.
 */
export function buildMatrix(payload: Record<string, unknown>, sourceCount: number): MatrixModel {
  const rawColumns = Array.isArray(payload["columns"]) ? (payload["columns"] as unknown[]) : [];
  const rawRows = Array.isArray(payload["matrix"]) ? (payload["matrix"] as unknown[]) : [];
  const columns = rawColumns.map((column) => String(column));
  const printed: string[] = [];
  const offsets: number[][] = [];
  columns.forEach((column, index) => {
    if (column === "OTHER_BIRDS") return;
    if (column === "CHICKEN") {
      const other = columns.indexOf("OTHER_BIRDS");
      printed.push(BIRD_COLUMN);
      offsets.push(other >= 0 ? [index, other] : [index]);
    } else {
      printed.push(COLUMN_NAMES[column] ?? column);
      offsets.push([index]);
    }
  });

  const cell = (row: unknown[], columnIndex: number): string =>
    row.length > columnIndex && row[columnIndex] !== null && row[columnIndex] !== undefined
      ? String(row[columnIndex])
      : "";

  const rows: MatrixRow[] = Object.keys(ROW_NAMES).map((code) => {
    const rowIndex = Object.keys(ROW_NAMES).indexOf(code);
    const row = (rawRows[rowIndex] as unknown[]) ?? [];
    return {
      code,
      name: ROW_NAMES[code] ?? code,
      automatic: true,
      values: offsets.map((indices) =>
        indices.length === 0 ? "" : indices.map((index) => cell(row, index)).reduce(addDecimals),
      ),
    };
  });
  for (const manual of MANUAL_ROWS) {
    rows.push({ code: manual.code, name: manual.name, automatic: false, values: printed.map(() => "") });
  }

  const versions: string[] = [];
  const mapping = payload["classification_version"];
  if (typeof mapping === "string" && mapping !== "") versions.push(`версия классификации ${mapping}`);
  const payloadVersion = payload["version"];
  if (payloadVersion !== undefined) versions.push(`версия снимка ${String(payloadVersion)}`);

  return { columns: printed, rows, versions, sourceCount };
}

/** The displayed cell of one column of a row (client-side projection only). */
export function displayCell(row: MatrixRow, columnIndex: number): string {
  if (!row.automatic) return NOT_CALCULATED;
  const value = row.values[columnIndex] ?? "";
  return value === "" ? DASH : value;
}

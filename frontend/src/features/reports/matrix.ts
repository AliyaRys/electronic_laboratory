/**
 * Matrix projection helpers (R03, API-08/DR51): one full-form snapshot
 * payload → the read-only displayed matrix. The client NEVER recomputes a
 * saved snapshot: the screen shows the payload's own values, a changed
 * source never invalidates it, and the row catalogue (code/name/mode) comes
 * from the signed payload itself — the client keeps no second list of names.
 *
 * Payload contract (DR51 §4, adapted server-side for legacy snapshots):
 * - ``rows``: the 47 printed rows in exact form order ({code, name, mode});
 * - ``columns``: the 8 stable animal column keys, CHICKEN and OTHER_BIRDS
 *   separate under «Птица»;
 * - ``matrix``: 47×8, AUTO cells decimal strings (a calculated zero is "0"),
 *   BLANK cells null — rendered as empty cells, never «Не рассчитывается»,
 *   «—» or a forged zero.
 */

const COLUMN_NAMES: Readonly<Record<string, string>> = Object.freeze({
  CATTLE: "Крупный рогатый скот, яки, буйволы",
  PIG: "Свиньи",
  SHEEP_GOAT: "Овцы, козы",
  RABBIT_NUTRIA: "Кролики, нутрии",
  CHICKEN: "Птица: куры",
  OTHER_BIRDS: "Птица: другие виды",
  FISH: "Рыба",
  OTHER_ANIMALS: "Другие виды животных",
});

export interface MatrixRow {
  code: string;
  name: string;
  /** AUTO rows carry the payload numbers; BLANK rows are always empty. */
  automatic: boolean;
  /** One raw cell per animal column: a decimal string or null. */
  values: (string | null)[];
}

export interface MatrixModel {
  columns: string[];
  rows: MatrixRow[];
}

/** Exact decimal-string arithmetic on scale-6 BigInt units (no floats). */
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

/** The displayed cell of one column of a row: null stays an empty cell. */
export function displayCell(row: MatrixRow, columnIndex: number): string | null {
  if (!row.automatic) return null;
  return row.values[columnIndex] ?? null;
}

interface PayloadRowMeta {
  code: string;
  name: string;
  mode: string;
}

/**
 * Build the displayed matrix strictly from the full-form payload. Missing
 * payload pieces degrade to nulls, never a guess; the canonical catalogue
 * always comes from the payload (server-side adapted for legacy snapshots).
 */
export function buildMatrix(payload: Record<string, unknown>): MatrixModel {
  const rawColumns = Array.isArray(payload["columns"]) ? (payload["columns"] as unknown[]) : [];
  const columns = rawColumns.map((column) => COLUMN_NAMES[String(column)] ?? String(column));
  const rawRows = Array.isArray(payload["rows"]) ? (payload["rows"] as unknown[]) : [];
  const rawMatrix = Array.isArray(payload["matrix"]) ? (payload["matrix"] as unknown[]) : [];
  const rows: MatrixRow[] = rawRows.map((meta, rowIndex) => {
    const row = (meta ?? {}) as Partial<PayloadRowMeta>;
    const automatic = row.mode === "AUTO";
    const rawValues = Array.isArray(rawMatrix[rowIndex]) ? (rawMatrix[rowIndex] as unknown[]) : [];
    return {
      code: String(row.code ?? ""),
      name: String(row.name ?? row.code ?? ""),
      automatic,
      values: rawColumns.map((_, columnIndex) => {
        const raw = rawValues[columnIndex];
        return automatic && raw !== null && raw !== undefined ? String(raw) : null;
      }),
    };
  });
  return { columns, rows };
}

/**
 * Documents API (API-07, D02): the conclusion preview and the controlled PDF.
 *
 * The preview route is served by the backend but is not yet present in the
 * generated ``shared/api/schema.d.ts`` (the generator needs a live backend).
 * Both calls therefore use the plain transport here and are confined to this
 * module — page components never call ``fetch`` directly. The same rule as
 * the rest of the transport applies: every failure becomes a shared
 * {@link Problem}, and the PDF is only handed to the caller after the
 * response was checked for a Problem — a Blob is never created for an error.
 */
import { isProblemContentType, networkProblem, parseProblem, type Problem } from "../../shared/api/problem";

export type { Problem } from "../../shared/api/problem";

/** Same-origin base that keeps jsdom fetch absolute (mirrors shared/api/client). */
function base(): string {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
    return "http://localhost";
  }
  return "";
}

/** The preview view-model of one conclusion (API-07 ConclusionView). */
export interface ConclusionView {
  basis_kind: "LOCAL" | "PREVIOUS";
  basis_id: string;
  fields: Record<string, string | null>;
  form_id: string;
  form_version: string;
  official: boolean;
  warnings: string[];
}

export async function fetchConclusion(
  partyId: string,
  signal?: AbortSignal | null,
): Promise<ConclusionView | Problem> {
  try {
    const response = await fetch(`${base()}/api/v1/arrivals/${partyId}/conclusion/preview`, {
      signal: signal ?? null,
    });
    if (!response.ok) {
      return await parseProblem(response);
    }
    return (await response.json()) as ConclusionView;
  } catch (thrown) {
    return networkProblem(thrown instanceof Error ? thrown.message : "Ошибка сети.");
  }
}

export interface PdfResult {
  /** The PDF bytes; handed over only after the Problem check. */
  blob: Blob;
}

/**
 * GET ``.../conclusion.pdf`` — the same live view-model rendered to PDF.
 *
 * The Problem check happens BEFORE any Blob/download/print: a 503 renderer
 * failure or a 422 incomplete basis shows its Russian detail instead of
 * silently downloading a broken file. The call is a pure read — it never
 * writes «выдано/подписано», and a retry repeats exactly the same GET, so the
 * underlying ВСЭ can never change because of a retry.
 */
export async function fetchConclusionPdf(
  partyId: string,
  signal?: AbortSignal | null,
): Promise<PdfResult | { problem: Problem }> {
  try {
    const response = await fetch(`${base()}/api/v1/arrivals/${partyId}/conclusion.pdf`, {
      signal: signal ?? null,
    });
    if (!response.ok || isProblemContentType(response)) {
      return { problem: await parseProblem(response) };
    }
    const data = await response.arrayBuffer();
    return { blob: new Blob([data], { type: "application/pdf" }) };
  } catch (thrown) {
    return { problem: networkProblem(thrown instanceof Error ? thrown.message : "Ошибка сети.") };
  }
}

/** Russian labels of the INPUT-04 manifest spaces, in the form order. */
export const FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  organization: "Организация",
  laboratory: "Лаборатория",
  date: "Дата",
  basis: "Основание",
  evsd: "ЭВСД №",
  owner: "Владелец продукции",
  product: "Продукция",
  mass: "Принятая масса, кг",
  count: "Принятое количество",
  unit: "Единица измерения",
  stamp: "Клеймо / оттиск печати",
  signature: "Подпись (заполняется от руки)",
});

export const BASIS_LABELS: Readonly<Record<ConclusionView["basis_kind"], string>> = Object.freeze({
  LOCAL: "по местной ВСЭ",
  PREVIOUS: "по ВСЭ убойного пункта",
});

/** The field rows of the preview, in the manifest order; the signature row is always shown. */
export function previewRows(view: ConclusionView): { key: string; label: string; value: string }[] {
  return Object.entries(FIELD_LABELS).map(([key, label]) => ({
    key,
    label,
    value: view.fields[key] ?? "",
  }));
}

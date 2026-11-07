/**
 * Catalog editors (Task C02, API-03): shared small helpers for the RHF+Zod
 * dialogs of methods/tariffs/check-services and the bulk price command.
 */
import "./catalogs.css";
import type { Problem } from "../../shared/api/problem";

/** Server Problem.errors are bound to their DTO paths (identity pattern). */
export function problemFieldErrors(problem: Problem): Record<string, string> {
  const map: Record<string, string> = {};
  for (const item of problem.errors ?? []) {
    map[item.path] = item.message;
  }
  return map;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value.trim());
}

/** DecimalString wire form: finite, dot, no exponent, scale ≤ 2 (SPEC-05). */
export const MONEY = /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/;

export function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

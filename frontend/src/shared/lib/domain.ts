/**
 * The shared DR35 domain formatters (§6/§7): ONE decimal display formatter
 * and ONE product-type presentation map for every screen (сверка, гашение,
 * ВСЭ, журнал) — no page ever re-derives these rules.
 */

/** ТЗ DR24 §5 (string-only decimal presentation). */
export function formatDecimalDisplay(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed === "" || /[.,]$/.test(trimmed)) return trimmed;
  const normalized = trimmed.replace(",", ".");
  const dot = normalized.indexOf(".");
  if (dot === -1) return normalized;
  const fraction = normalized.slice(dot + 1).replace(/0+$/, "");
  const integer = normalized.slice(0, dot);
  return fraction === "" ? integer : `${integer}.${fraction}`.replace(".", ",");
}

/** ТЗ §6: the single typed presentation map of the Mercury product types. */
export const PRODUCT_TYPE_LABELS: Readonly<Record<number, string>> = Object.freeze({
  1: "Мясо и мясопродукты",
  2: "Корма и кормовые добавки",
  3: "Живые животные",
  4: "Лекарственные средства",
  5: "Пищевые продукты",
  6: "Непищевые продукты и другое",
  7: "Рыба и морепродукты",
  8: "Продукция, не требующая разрешения",
});

/** ТЗ §6: the honest label of a product type; an unknown/absent code never
 * shows a bare digit and never a fabricated name. */
export function productTypeLabel(code: number | null | undefined): string {
  if (code === null || code === undefined) return "Название типа продукции не получено";
  return PRODUCT_TYPE_LABELS[code] ?? `Неизвестный тип продукции (код: ${code})`;
}

/** ТЗ §6: true when the code is outside the agreed map (diagnostic warning). */
export function isUnknownProductType(code: number | null | undefined): boolean {
  return code !== null && code !== undefined && !(code in PRODUCT_TYPE_LABELS);
}

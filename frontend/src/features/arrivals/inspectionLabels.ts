/**
 * DR56 §7.2: the ONE typed Russian label registry of the two inspections
 * (документарная проверка / ветеринарный осмотр) for the receipt
 * confirmation. The select and the summary both read it, so the texts never
 * diverge; a raw English enum is never rendered to the user — an unknown
 * value is a program error shown as a managed message.
 */
export type InspectionResult = "CORRESPONDS" | "MISMATCH" | "UNSUPERVISED";

const DOCUMENTARY_LABELS: Readonly<Record<InspectionResult, string>> = Object.freeze({
  CORRESPONDS: "Сведения соответствуют документу",
  MISMATCH: "Сведения не соответствуют документу",
  UNSUPERVISED: "Документарная проверка не проводилась",
});

const VETERINARY_LABELS: Readonly<Record<InspectionResult, string>> = Object.freeze({
  CORRESPONDS: "Соответствует ветеринарным требованиям",
  MISMATCH: "Не соответствует ветеринарным требованиям",
  UNSUPERVISED: "Ветеринарный осмотр не проводился",
});

const UNKNOWN = "Неизвестный результат осмотра (обратитесь в поддержку)";

export function documentaryInspectionLabel(value: string): string {
  return DOCUMENTARY_LABELS[value as InspectionResult] ?? UNKNOWN;
}

export function veterinaryInspectionLabel(value: string): string {
  return VETERINARY_LABELS[value as InspectionResult] ?? UNKNOWN;
}

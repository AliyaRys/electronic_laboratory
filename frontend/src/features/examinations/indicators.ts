/**
 * The ФТ VSE research indicator catalogue (VSE-F18–29, INPUT-02) for the form.
 *
 * The indicator identifiers are the server's fixed UUID5 values of
 * ``elab-vse://field/VSE-Fxx`` in the namespace from
 * backend/src/modules/catalog_pricing/mandatory.py — they are the same ids the
 * server validates and prices, hardcoded here with the derivation documented.
 * The form NEVER decides trichinelloscopy by itself: the product-GUID rule
 * lives on the server, so the indicator is always available and the server
 * answers REQUIRED_RESULT_MISSING when the product demands it.
 */

export type ResearchKind = "BOOLEAN" | "INTEGER" | "DECIMAL" | "ENUM" | "TEXT" | "DOSIMETRY";

export interface EnumOption {
  value: string;
  label: string;
  /** «Иное» требует пояснительного текста (E01). */
  other?: boolean;
}

export interface IndicatorDef {
  id: string;
  code: string;
  name: string;
  kind: ResearchKind;
  /** Universally mandatory (FT): no removal control, no add control. */
  mandatory: boolean;
  /** Accusative form for the add/remove accessible names («Добавить …»). */
  addName: string;
  unit?: string;
  options?: readonly EnumOption[];
  /** Server-side value bounds mirrored for readable client validation. */
  min?: number;
  max?: number;
}

const MATCH_OPTIONS: readonly EnumOption[] = [
  { value: "MATCH", label: "Соответствует" },
  { value: "MISMATCH", label: "Не соответствует" },
];
const REACTION_OPTIONS: readonly EnumOption[] = [
  { value: "NEGATIVE", label: "Отрицательная" },
  { value: "POSITIVE", label: "Положительная" },
];
const COOKING_OPTIONS: readonly EnumOption[] = [
  { value: "Бульон прозрачный, аромат специфический", label: "Бульон прозрачный, аромат специфический" },
  { value: "Бульон мутный", label: "Бульон мутный" },
  { value: "Бульон с хлопьями", label: "Бульон с хлопьями" },
  { value: "Бульон с осадком", label: "Бульон с осадком" },
  { value: "Нехарактерный / неприятный запах", label: "Нехарактерный / неприятный запах" },
  { value: "OTHER", label: "Иное (указать)", other: true },
];

export const INDICATORS: readonly IndicatorDef[] = Object.freeze([
  Object.freeze({
    id: "c8d1e50e-bf49-5475-bb82-860f6fc47e74",
    code: "VSE-F18",
    name: "Органолептическое исследование",
    kind: "ENUM",
    mandatory: true,
    addName: "органолептическое исследование",
    options: MATCH_OPTIONS,
  }),
  Object.freeze({
    id: "5410ca53-ffae-5a27-ab8d-51cb20fe4011",
    code: "VSE-F19",
    name: "Идентификация продукции",
    kind: "ENUM",
    mandatory: true,
    addName: "идентификацию продукции",
    options: MATCH_OPTIONS,
  }),
  Object.freeze({
    id: "ec2fba68-e4d1-5c82-9591-92ee9da5293e",
    code: "VSE-F20",
    name: "Температура в толще мышц",
    kind: "DECIMAL",
    mandatory: true,
    addName: "температуру в толще мышц",
    unit: "°C",
  }),
  Object.freeze({
    id: "adf96c8a-a6d6-50c4-9ec9-86f058b329f1",
    code: "VSE-F21",
    name: "Трихинеллоскопия",
    kind: "BOOLEAN",
    mandatory: false,
    addName: "трихинеллоскопию",
  }),
  Object.freeze({
    id: "6e126f72-4871-566b-809b-8765c562d2d6",
    code: "VSE-F22",
    name: "Люминесцентный анализ",
    kind: "ENUM",
    mandatory: false,
    addName: "люминесцентный анализ",
    options: MATCH_OPTIONS,
  }),
  Object.freeze({
    id: "e6be5304-d6d2-5f49-86a3-8e1308b344d4",
    code: "VSE-F23",
    name: "Бактериоскопия",
    kind: "TEXT",
    mandatory: false,
    addName: "бактериоскопию",
  }),
  Object.freeze({
    id: "72c55a55-4708-58d5-8d69-ec1c7ee2d1f9",
    code: "VSE-F24",
    name: "Микроскопия",
    kind: "INTEGER",
    mandatory: false,
    addName: "микроскопию",
  }),
  Object.freeze({
    id: "dab12c02-d03b-5212-a264-3b3aaf32689c",
    code: "VSE-F25",
    name: "pH",
    kind: "DECIMAL",
    mandatory: false,
    addName: "pH",
    min: 0,
    max: 14,
  }),
  Object.freeze({
    id: "4901561b-a838-55e6-aa5c-d43797951455",
    code: "VSE-F26",
    name: "Проба варки",
    kind: "ENUM",
    mandatory: false,
    addName: "пробу варки",
    options: COOKING_OPTIONS,
  }),
  Object.freeze({
    id: "30062c12-7b25-541b-973f-b42c9fde8b56",
    code: "VSE-F27",
    name: "Реакция с сернокислой медью",
    kind: "ENUM",
    mandatory: false,
    addName: "реакцию с сернокислой медью",
    options: REACTION_OPTIONS,
  }),
  Object.freeze({
    id: "dc521803-109e-5a78-8a22-742658ab3330",
    code: "VSE-F28",
    name: "Пероксидаза",
    kind: "ENUM",
    mandatory: false,
    addName: "пероксидазу",
    options: REACTION_OPTIONS,
  }),
  Object.freeze({
    id: "fcca2571-990b-53bb-8b7b-9144643cb890",
    code: "VSE-F29",
    name: "Дозометрическое исследование",
    kind: "DOSIMETRY",
    mandatory: false,
    addName: "дозиметрическое исследование",
    unit: "мкЗв/ч",
  }),
]);

/** The disease dictionaries of ФТ 10 (VSE-F30/31). */
export const INVASIVE_DISEASES: readonly string[] = Object.freeze([
  "Цистицеркоз",
  "Трихинеллёз",
  "Эхинококкоз",
  "Альвеококкоз",
  "Фасциолёз",
  "Дикроцелиоз",
  "Саркоцистоз",
  "Аскаридоз",
  "Стронгилятозы",
  "Метастронгилёз",
  "Другое паразитарное заболевание",
]);

export const NONCONTAGIOUS_DISEASES: readonly string[] = Object.freeze([
  "Пастереллёз",
  "Лептоспироз",
  "Колибациллёз",
  "Сальмонеллёз",
  "Отёчная болезнь",
  "Рожа свиней",
  "Эмфизематозный карбункул",
  "Мыт лошадей",
  "Болезнь Ауески",
  "Другое незаразное заболевание",
]);

export const indicator = (id: string): IndicatorDef => {
  const found = INDICATORS.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`Неизвестный показатель ВСЭ: ${id}`);
  }
  return found;
};

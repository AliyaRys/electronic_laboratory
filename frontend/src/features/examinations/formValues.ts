/**
 * The examination form value model (E04, API-05/FT-VSE): RHF values, the zod
 * mirror of the server's typed research shapes and the payload builders.
 *
 * The model is the typed ExaminationWrite contract, not an independent
 * invention: every performed research maps to its fixed indicator id and
 * discriminated kind, the sample is NEW/REUSE/EDIT (API-06) and the outcome
 * matrix (FIT→SALE without reason, UNFIT→DISPOSAL|DESTRUCTION with reason) is
 * mirrored for readable client validation — the server stays authoritative.
 *
 * No medical outcome is ever prefilled: the outcome block starts empty and
 * every state change is an explicit user action.
 */
import { z } from "zod";
import type { ExaminationView, ExaminationWrite, ResearchWrite, SampleSelection } from "./api";
import { INDICATORS, indicator } from "./indicators";

/** One research card in form state (string inputs; converted at submit). */
export interface ResearchEntry {
  performed: boolean;
  value: string;
  otherText: string;
  /** DOSIMETRY pair. */
  first: string;
  last: string;
}

export interface FindingEntry {
  disease: string;
  location: string;
  otherText: string;
}

export interface SampleEntry {
  mode: "NEW" | "REUSE" | "EDIT";
  collectedOn: string;
  massKg: string;
  collectionId: string;
  expectedRevision: string;
}

export interface OutcomeEntry {
  outcome: "" | "FIT" | "UNFIT";
  direction: "" | "SALE" | "DISPOSAL" | "DESTRUCTION";
  reason: string;
}

export interface ExaminationFormValues {
  number: string;
  stamp: string;
  sentToLab: boolean;
  sample: SampleEntry;
  researches: Record<string, ResearchEntry>;
  invasive: FindingEntry[];
  noncontagious: FindingEntry[];
  outcome: OutcomeEntry;
}

export const DEFAULT_SAMPLE_MASS_KG = "0.8";

/** The DECIMAL string grammar of API-01 (finite decimal, dot, no exponent). */
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

export function emptyResearch(entry: Partial<ResearchEntry> = {}): ResearchEntry {
  return {
    performed: false,
    value: "",
    otherText: "",
    first: "",
    last: "",
    ...entry,
  };
}

export function emptyOutcome(): OutcomeEntry {
  return { outcome: "", direction: "", reason: "" };
}

/** The research snapshot of a saved view keyed by indicator id. */
export function savedResearches(view: ExaminationView | null): Map<string, ResearchWrite> {
  const saved = new Map<string, ResearchWrite>();
  if (view === null) return saved;
  for (const raw of view.researches) {
    const item = raw as { indicatorId?: string };
    if (typeof item.indicatorId === "string") {
      saved.set(item.indicatorId, raw as ResearchWrite);
    }
  }
  return saved;
}

/** Initial form values from a confirmed party's facts and a saved card. */
export function initialValues(
  defaults: { number: string; today: string; sample: SampleEntry; sentToLab: boolean },
  view: ExaminationView | null,
): ExaminationFormValues {
  const researches: Record<string, ResearchEntry> = {};
  const saved = savedResearches(view);
  for (const def of INDICATORS) {
    const row = saved.get(def.id);
    if (row === undefined) {
      researches[def.id] = emptyResearch({ performed: def.mandatory });
      continue;
    }
    if (row.kind === "DOSIMETRY") {
      const pair = row.value as { first: string; last: string };
      researches[def.id] = emptyResearch({
        performed: true,
        first: String(pair.first ?? ""),
        last: String(pair.last ?? ""),
      });
    } else if (row.kind === "ENUM") {
      const enumRow = row as { value: string; otherText?: string | null };
      researches[def.id] = emptyResearch({
        performed: true,
        value: String(enumRow.value ?? ""),
        otherText: enumRow.otherText ?? "",
      });
    } else {
      researches[def.id] = emptyResearch({ performed: true, value: String(row.value ?? "") });
    }
  }
  const invasive: FindingEntry[] = (view?.invasive_findings ?? []).map((raw) => {
    const item = raw as { disease: string; location: string; otherText?: string | null };
    return { disease: item.disease, location: item.location, otherText: item.otherText ?? "" };
  });
  const noncontagious: FindingEntry[] = (view?.noncontagious_findings ?? []).map((raw) => {
    const item = raw as { disease: string; otherText?: string | null };
    return { disease: item.disease, location: "", otherText: item.otherText ?? "" };
  });
  return {
    number: view?.number ?? defaults.number,
    stamp: view?.stamp ?? "",
    sentToLab: view?.sent_to_lab ?? defaults.sentToLab,
    sample: defaults.sample,
    researches,
    invasive,
    noncontagious,
    outcome: emptyOutcome(),
  };
}

/** The zod mirror of the ExaminationWrite rules for readable submit errors. */
export function formSchemaFor(mode: "WAITING" | "COMPLETED"): z.ZodType {
  const researchSchema = z.record(
    z.string(),
    z.object({
      performed: z.boolean(),
      value: z.string(),
      otherText: z.string(),
      first: z.string(),
      last: z.string(),
    }),
  );
  const sampleSchema = z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("NEW"),
      collectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату отбора."),
      massKg: z.string().regex(DECIMAL, "Вес пробы — положительное десятичное число."),
      collectionId: z.string(),
      expectedRevision: z.string(),
    }),
    z.object({
      mode: z.literal("REUSE"),
      collectedOn: z.string(),
      massKg: z.string(),
      collectionId: z.string().min(1, "Выберите доступную пробу."),
      expectedRevision: z.string(),
    }),
    z.object({
      mode: z.literal("EDIT"),
      collectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату отбора."),
      massKg: z.string().regex(DECIMAL, "Вес пробы — положительное десятичное число."),
      collectionId: z.string().min(1, "Выберите пробу."),
      expectedRevision: z.string().regex(/^[1-9][0-9]*$/, "Ревизия пробы не указана."),
    }),
  ]);
  const base = z.object({
    number: z.string().trim().min(1, "Введите номер ВСЭ."),
    stamp: z.string().trim().min(1, "Введите ветеринарное клеймо."),
    sentToLab: z.boolean(),
    sample: sampleSchema,
    researches: researchSchema,
    invasive: z.array(
      z.object({
        disease: z.string().min(1, "Выберите болезнь."),
        location: z.string().trim().min(1, "Укажите место обнаружения."),
        otherText: z.string(),
      }),
    ),
    noncontagious: z
      .array(
        z.object({
          disease: z.string().min(1, "Выберите болезнь."),
          location: z.string(),
          otherText: z.string(),
        }),
      )
      .max(10, "Незаразных болезней не больше десяти."),
    outcome: z
      .object({
        outcome: z.enum(["", "FIT", "UNFIT"]),
        direction: z.enum(["", "SALE", "DISPOSAL", "DESTRUCTION"]),
        reason: z.string(),
      })
      .refine((entry) => mode !== "COMPLETED" || entry.outcome !== "", {
        message: "Выберите итог экспертизы.",
      })
      .refine((entry) => mode !== "COMPLETED" || entry.outcome !== "UNFIT" || entry.direction !== "", {
        message: "Выберите направление.",
      })
      .refine((entry) => mode !== "COMPLETED" || entry.outcome !== "UNFIT" || entry.reason.trim() !== "", {
        message: "Укажите причину направления.",
      }),
  });
  return base satisfies z.ZodType<ExaminationFormValues>;
}

type ParsedForm = ExaminationFormValues;

function toResearchWrite(def: (typeof INDICATORS)[number], entry: ResearchEntry): ResearchWrite | null {
  if (!entry.performed) return null;
  switch (def.kind) {
    case "BOOLEAN":
      return { indicatorId: def.id, kind: "BOOLEAN", value: entry.value === "true" };
    case "INTEGER": {
      if (!/^\d+$/.test(entry.value)) return null;
      return { indicatorId: def.id, kind: "INTEGER", value: Number(entry.value) };
    }
    case "DECIMAL":
      if (!DECIMAL.test(entry.value)) return null;
      return { indicatorId: def.id, kind: "DECIMAL", value: entry.value };
    case "TEXT":
      if (entry.value.trim() === "") return null;
      return { indicatorId: def.id, kind: "TEXT", value: entry.value };
    case "ENUM": {
      if (entry.value === "") return null;
      return {
        indicatorId: def.id,
        kind: "ENUM",
        value: entry.value,
        ...(entry.value === "OTHER" && entry.otherText.trim() !== ""
          ? { otherText: entry.otherText.trim() }
          : {}),
      };
    }
    case "DOSIMETRY":
      if (!DECIMAL.test(entry.first) || !DECIMAL.test(entry.last)) return null;
      return {
        indicatorId: def.id,
        kind: "DOSIMETRY",
        value: { first: entry.first, last: entry.last },
      };
  }
}

function toSample(values: ParsedForm["sample"]): SampleSelection {
  switch (values.mode) {
    case "NEW":
      return { mode: "NEW", collectedOn: values.collectedOn, massKg: values.massKg };
    case "REUSE":
      return { mode: "REUSE", collectionId: values.collectionId };
    case "EDIT":
      return {
        mode: "EDIT",
        collectionId: values.collectionId,
        expectedRevision: Number(values.expectedRevision),
        collectedOn: values.collectedOn,
        massKg: values.massKg,
      };
  }
}

/**
 * Client-side mirror of the server's typed research validation (FT-VSE-03–05):
 * same rules, readable Russian messages; the server repeats every check.
 */
export function researchErrors(values: ExaminationFormValues): string[] {
  const errors: string[] = [];
  for (const def of INDICATORS) {
    const entry = values.researches[def.id];
    if (entry === undefined || !entry.performed) {
      if (def.mandatory) {
        errors.push(`Обязательное исследование не выполнено: ${def.name}.`);
      }
      continue;
    }
    if (def.kind === "INTEGER" && !/^\d+$/.test(entry.value)) {
      errors.push(`${def.name}: введите целое число, ноль допускается.`);
    }
    if (def.kind === "DECIMAL" && !DECIMAL.test(entry.value)) {
      errors.push(`${def.name}: введите неотрицательное десятичное число.`);
    }
    if (def.kind === "DECIMAL" && DECIMAL.test(entry.value)) {
      const value = Number(entry.value);
      if (def.min !== undefined && value < def.min) {
        errors.push(`${def.name}: значение не меньше ${def.min}.`);
      }
      if (def.max !== undefined && value > def.max) {
        errors.push(`${def.name}: значение не больше ${def.max}.`);
      }
    }
    if (def.kind === "TEXT" && entry.value.trim() === "") {
      errors.push(`${def.name}: введите непустой результат.`);
    }
    if (def.kind === "DOSIMETRY" && (!DECIMAL.test(entry.first) || !DECIMAL.test(entry.last))) {
      errors.push(`${def.name}: оба значения обязательны и десятичные.`);
    }
    if (def.kind === "ENUM" && entry.value === "") {
      errors.push(`${def.name}: выберите результат.`);
    }
    if (def.kind === "ENUM" && entry.value === "OTHER" && entry.otherText.trim() === "") {
      errors.push(`${def.name}: для «Иное» требуется пояснение.`);
    }
  }
  for (const item of values.invasive) {
    if (item.disease.trim() === "") errors.push("Инвазионная болезнь: выберите болезнь.");
    if (item.location.trim() === "") errors.push("Инвазионная болезнь: укажите место обнаружения.");
    if (item.disease === "Другое паразитарное заболевание" && item.otherText.trim() === "") {
      errors.push("Инвазионная болезнь: для «Другое» требуется название.");
    }
  }
  for (const item of values.noncontagious) {
    if (item.disease.trim() === "") errors.push("Незаразная болезнь: выберите болезнь.");
    if (item.disease === "Другое незаразное заболевание" && item.otherText.trim() === "") {
      errors.push("Незаразная болезнь: для «Другое» требуется название.");
    }
  }
  return errors;
}

export function toWritePayload(values: ParsedForm, mode: "WAITING" | "COMPLETED"): ExaminationWrite | null {
  const researches: ResearchWrite[] = [];
  for (const def of INDICATORS) {
    const entry = values.researches[def.id];
    if (entry === undefined) continue;
    const row = toResearchWrite(def, entry);
    if (row !== null) researches.push(row);
  }
  if (researches.length === 0) return null;
  const isWaiting = mode === "WAITING";
  return {
    mode,
    number: values.number.trim(),
    stamp: values.stamp.trim(),
    researches,
    invasiveFindings: values.invasive.map((item) => ({
      disease: item.disease,
      location: item.location,
      ...(item.disease === "Другое паразитарное заболевание" && item.otherText.trim() !== ""
        ? { otherText: item.otherText.trim() }
        : {}),
    })),
    noncontagiousFindings: values.noncontagious.map((item) => ({
      disease: item.disease,
      ...(item.disease === "Другое незаразное заболевание" && item.otherText.trim() !== ""
        ? { otherText: item.otherText.trim() }
        : {}),
    })),
    sentToLab: isWaiting ? true : values.sentToLab,
    sample: toSample(values.sample),
    outcome: isWaiting
      ? null
      : values.outcome.outcome === ""
        ? null
        : (values.outcome.outcome as "FIT" | "UNFIT"),
    direction: isWaiting
      ? null
      : values.outcome.direction === ""
        ? null
        : (values.outcome.direction as "SALE" | "DISPOSAL" | "DESTRUCTION"),
    reason: isWaiting ? null : values.outcome.reason.trim() === "" ? null : values.outcome.reason.trim(),
  };
}

/** The indicator snapshot warnings, computed only from known data (E02). */
export function pricingNotes(
  values: ExaminationFormValues,
  view: ExaminationView | null,
): {
  id: string;
  name: string;
  note: string;
}[] {
  if (view === null) return [];
  const saved = savedResearches(view);
  const notes: { id: string; name: string; note: string }[] = [];
  for (const def of INDICATORS) {
    const entry = values.researches[def.id];
    if (entry === undefined || !entry.performed) continue;
    // Only a NEWLY added indicator gets current pricing; an existing one
    // keeps its pinned snapshot and needs no warning.
    if (saved.has(def.id)) continue;
    notes.push({
      id: def.id,
      name: def.name,
      note: "Показатель добавлен сейчас: норма и тариф берутся по текущему справочнику.",
    });
  }
  return notes;
}

export { indicator };

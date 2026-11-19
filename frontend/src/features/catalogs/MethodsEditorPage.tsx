/**
 * «Нормы исследований» editor page (ТЗ DR36 §7–14, mockup directory-norms-edit.html).
 *
 * ONE norm set per laboratory for «Мясо и мясопродукты»: the context is
 * resolved by the laboratory and the product area only (no species/state
 * selectors, no Mercury GUIDs, no party data, no technical fields). ТЗ DR41-B
 * §6: only the CONFIGURABLE indicators (F20/F21/F24/F25/F26/F29) are editable
 * rows — the fixed FT rules (F18/F19/F22/F27/F28) and the norm-free
 * бактериоскопия (F23) never appear as configurable lines. Every unset
 * interval row shows its «Норма от/до» fields directly
 * (no «Настроить» step, no separate unset list) and qualitative blocks use
 * the square ＋/− composition of the mockup. A null boundary stays null
 * (never 0); lower ≤ upper is enforced; technical metadata (source,
 * inclusivity, delete) lives in the folded overflow of the row; one
 * «Сохранить справочник» saves ONLY the dirty rows sequentially with honest
 * per-row results and 409 resolution.
 */
import { useQuery } from "@tanstack/react-query";
import "./catalogs.css";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "../../shared/ui/Button";
import { StatusView } from "../../shared/ui/StatusView";
import {
  createMethod,
  fetchMethodsContext,
  updateMethod,
  type CatalogIndicator,
  type MethodRuleTyped,
  type Problem,
} from "./api";
import {
  CatalogEditorPage,
  CatalogSectionHeader,
  NormRow,
  QualitativeBlock,
  SaveSummary,
  type QualitativeRow,
} from "./editor-parts";
import { CatalogContextSlot } from "./catalog-context-slot";
import { useCatalogContext } from "./use-catalog-context";
import { useDirtyGuard } from "../context/SwitchContext";

const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

export interface MethodDraft {
  lower: string;
  upper: string;
  lowerInclusive: boolean;
  upperInclusive: boolean;
  /** Qualitative: the accepted values of the draft (Норма rows). */
  accepted: string[];
  /** Extra qualitative rows added from the registry or by hand. */
  extra: string[];
}

function intervalDraft(): MethodDraft {
  return { lower: "", upper: "", lowerInclusive: true, upperInclusive: true, accepted: [], extra: [] };
}

function qualitativeDraft(accepted: string[]): MethodDraft {
  return {
    lower: "",
    upper: "",
    lowerInclusive: true,
    upperInclusive: true,
    accepted: [...accepted],
    extra: [],
  };
}

/** The create/update payload of one interval draft (§8.4: only the subject
 * values travel; schema/unit/version/source are server-side data). */
export function intervalPayload(laboratoryId: string, code: string, draft: MethodDraft) {
  return {
    laboratory_id: laboratoryId,
    code,
    rule: {
      type: "interval" as const,
      ...(draft.lower !== "" ? { lower: draft.lower } : {}),
      ...(draft.upper !== "" ? { upper: draft.upper } : {}),
      lower_inclusive: draft.lowerInclusive,
      upper_inclusive: draft.upperInclusive,
    },
  };
}

/** §11.2: an ADDED variant that was never filled in is dropped — it never
 * travels to the server and never counts as a change by itself. */
export function draftAcceptedValues(draft: MethodDraft): string[] {
  return [
    ...draft.accepted,
    ...draft.extra.filter((value) => value.trim() !== "" && !draft.accepted.includes(value)),
  ];
}

/** The create/update payload of one qualitative draft. */
export function qualitativePayload(laboratoryId: string, code: string, draft: MethodDraft) {
  return {
    laboratory_id: laboratoryId,
    code,
    rule: { type: "qualitative" as const, accepted_values: draftAcceptedValues(draft) },
  };
}

const INTERVAL_SCHEMAS = new Set(["DECIMAL", "INTEGER_NONNEGATIVE", "DOSIMETRY_PAIR"]);

interface RowModel {
  key: string;
  /** The active rule of the indicator; null for an honest «Не настроено». */
  rule: MethodRuleTyped | null;
  /** The canonical registry definition (absent for an unknown rule row). */
  indicator: CatalogIndicator | null;
  name: string;
  unit: string | undefined;
  kind: "interval" | "qualitative" | "text";
}

/** Annotation of the conditionally mandatory F21 (spec §4, GUID list — never
 * a per-species policy invented here). */
const CONDITIONAL_NOTE = "Обязательно для указанных видов продукции";
const TEXT_NOTE = "Результат вводится текстом; диапазон нормы не задаётся.";

/** ТЗ DR41-B §6: only the CONFIGURABLE indicators are ever catalog rows —
 * the fixed FT rules (F18/F19/F22/F27/F28) and the norm-free бактериоскопия
 * (F23) never appear as editable norm lines. DR41-B fix-loop: a registry row
 * WITHOUT ``evaluation_mode`` is no longer silently CONFIGURABLE — the honest
 * mode is UNKNOWN (never editable, an explicit diagnostic). */
export type EvaluationMode = "CONFIGURABLE" | "FIXED" | "NONE" | "UNKNOWN";

export function evaluationMode(indicator: CatalogIndicator): EvaluationMode {
  const mode = indicator.evaluation_mode;
  if (mode === "CONFIGURABLE" || mode === "FIXED" || mode === "NONE") return mode;
  // The contract carries ``evaluation_mode`` as a required string; anything
  // else (absent on a legacy row, or an unexpected literal) is UNKNOWN.
  return "UNKNOWN";
}

function isConfigurable(indicator: CatalogIndicator): boolean {
  return evaluationMode(indicator) === "CONFIGURABLE";
}

/**
 * The registry-driven rows (§6.1, ТЗ DR53 Task 5): every CONFIGURABLE
 * indicator of the context is listed in the canonical order — with its active
 * rule or as «Не настроено». FIXED/NONE indicators are simply absent (even
 * with a legacy rule — the old rule stays server-side audit data), and a rule
 * outside the registry is not rendered as a diagnostic card any more.
 */
export function buildMethodRows(
  indicators: readonly CatalogIndicator[],
  rules: MethodRuleTyped[],
): RowModel[] {
  const byIndicator = new Map<string, MethodRuleTyped>();
  for (const rule of rules) byIndicator.set(rule.indicator_id, rule);
  const rows: RowModel[] = [];
  for (const indicator of indicators) {
    if (!isConfigurable(indicator)) continue;
    const rule = byIndicator.get(indicator.id) ?? null;
    const kind: RowModel["kind"] =
      indicator.result_schema === "TEXT"
        ? "text"
        : INTERVAL_SCHEMAS.has(indicator.result_schema)
          ? "interval"
          : "qualitative";
    rows.push({
      key: rule?.id ?? `missing-${indicator.id}`,
      rule,
      indicator,
      name: indicator.name,
      unit: rule?.unit_id === "" ? undefined : (rule?.unit_id ?? indicator.unit_id ?? undefined),
      kind,
    });
  }
  return rows;
}

export function MethodsEditorPage(): React.ReactElement {
  const context = useCatalogContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { laboratoryId, canEdit, allowedToSwitch } = context;

  // The working scope: laboratory + the human-readable product area. No
  // species/state URL parameters exist any more (ТЗ DR31 §9.1).
  const pageReady = laboratoryId !== null && context.configError === null && !context.needsSelection;

  const methods = useQuery({
    queryKey: [laboratoryId, "methods-context"],
    queryFn: ({ signal }) => fetchMethodsContext(laboratoryId ?? "", "meat", signal),
    enabled: pageReady,
  });

  const [drafts, setDrafts] = useState<Record<string, MethodDraft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Active 409 states (§12.6): the fresh revision is loaded, the draft stays. */
  const [conflicts, setConflicts] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState<{
    state: "success" | "partial" | "error";
    text: string;
    details: string[];
  } | null>(null);
  const [savePending, setSavePending] = useState(false);

  const scopedContext = methods.data !== undefined && !("code" in methods.data) ? methods.data : null;

  const rows = useMemo(
    () =>
      scopedContext === null ? [] : buildMethodRows(scopedContext.indicators, scopedContext.active_rules),
    [scopedContext],
  );

  const draftFor = (row: RowModel): MethodDraft => {
    const existing = drafts[row.key];
    if (existing !== undefined) return existing;
    if (row.kind === "interval") {
      if (row.rule?.rule.type === "interval") {
        return {
          lower: row.rule.rule.lower ?? "",
          upper: row.rule.rule.upper ?? "",
          lowerInclusive: row.rule.rule.lower_inclusive ?? true,
          upperInclusive: row.rule.rule.upper_inclusive ?? true,
          accepted: [],
          extra: [],
        };
      }
      // §10.2: the unset interval row starts with empty boundary fields.
      return intervalDraft();
    }
    return qualitativeDraft(
      row.rule?.rule.type === "qualitative" ? row.rule.rule.accepted_values : (row.indicator?.options ?? []),
    );
  };

  const dirty = useMemo(
    () =>
      rows.some((row) => {
        const draft = drafts[row.key];
        if (draft === undefined) return false;
        if (row.rule === null) {
          // A configured-from-row create draft: any entered value is dirty.
          if (row.kind === "interval") return draft.lower !== "" || draft.upper !== "";
          // §11.3: until the FIRST change an unset qualitative block is not
          // dirty — its accepted set starts as the registry options.
          const initial = row.indicator?.options ?? [];
          return (
            draftAcceptedValues(draft).join("\u0001") !==
            initial.filter((value) => value.trim() !== "").join("\u0001")
          );
        }
        if (row.rule.rule.type === "interval") {
          return (
            draft.lower !== (row.rule.rule.lower ?? "") ||
            draft.upper !== (row.rule.rule.upper ?? "") ||
            draft.lowerInclusive !== (row.rule.rule.lower_inclusive ?? true) ||
            draft.upperInclusive !== (row.rule.rule.upper_inclusive ?? true)
          );
        }
        const accepted = draftAcceptedValues(draft);
        return accepted.join("\u0001") !== row.rule.rule.accepted_values.join("\u0001");
      }),
    [rows, drafts],
  );
  useDirtyGuard(dirty, "Справочник норм");

  async function save(): Promise<void> {
    if (laboratoryId === null) return;
    const failures: string[] = [];
    let saved = 0;
    let conflicted = false;
    for (const row of rows) {
      const draft = drafts[row.key];
      // A conflicted row waits for the explicit §12.6 choice; a second
      // «Сохранить» never re-submits the stale draft against the fresh
      // revision.
      if (conflicts[row.key] === true) continue;
      if (draft === undefined) continue;
      const code = row.indicator?.code;
      if (code === undefined) continue;
      const fail = (message: string): void => {
        const text = message === "" ? "Не удалось сохранить норму." : message;
        failures.push(text);
        setErrors((current) => ({ ...current, [row.key]: text }));
      };

      if (row.rule === null) {
        // First setup directly from the row (§10.2): create without any
        // technical field — the registry resolves schema/unit/version/source.
        if (row.kind === "interval") {
          if (draft.lower !== "" && !NUMBER.test(draft.lower)) {
            fail("Граница нормы — конечное число с точкой.");
            continue;
          }
          if (draft.upper !== "" && !NUMBER.test(draft.upper)) {
            fail("Граница нормы — конечное число с точкой.");
            continue;
          }
          if (draft.lower === "" && draft.upper === "") continue;
          if (draft.lower !== "" && draft.upper !== "" && Number(draft.lower) > Number(draft.upper)) {
            fail("Нижняя граница должна быть не больше верхней.");
            continue;
          }
        } else {
          if (draftAcceptedValues(draft).length === 0) continue;
        }
        const payload =
          row.kind === "interval"
            ? intervalPayload(laboratoryId, code, draft)
            : qualitativePayload(laboratoryId, code, draft);
        const result = await createMethod(payload, crypto.randomUUID());
        if ("code" in result) {
          fail(result.detail);
          continue;
        }
      } else if (row.kind === "interval" && row.rule.rule.type === "interval") {
        if (draft.lower !== "" && !NUMBER.test(draft.lower)) {
          fail("Граница нормы — конечное число с точкой.");
          continue;
        }
        if (draft.upper !== "" && !NUMBER.test(draft.upper)) {
          fail("Граница нормы — конечное число с точкой.");
          continue;
        }
        if (draft.lower === "" && draft.upper === "") {
          fail("Укажите хотя бы одну границу нормы.");
          continue;
        }
        if (draft.lower !== "" && draft.upper !== "" && Number(draft.lower) > Number(draft.upper)) {
          fail("Нижняя граница должна быть не больше верхней.");
          continue;
        }
        const interval = row.rule.rule;
        const unchanged =
          draft.lower === (interval.lower ?? "") &&
          draft.upper === (interval.upper ?? "") &&
          draft.lowerInclusive === (interval.lower_inclusive ?? true) &&
          draft.upperInclusive === (interval.upper_inclusive ?? true);
        if (unchanged) continue;
        const result = await updateMethod(
          row.rule.id,
          intervalPayload(laboratoryId, code, draft),
          `"${row.rule.revision}"`,
        );
        if ("code" in result) {
          if (result.code === "REVISION_CONFLICT") {
            conflicted = true;
            setConflicts((current) => ({ ...current, [row.key]: true }));
          }
          fail(result.detail);
          continue;
        }
      } else if (row.kind === "qualitative" && row.rule.rule.type === "qualitative") {
        const accepted = draftAcceptedValues(draft);
        if (accepted.length === 0) {
          fail("Хотя бы один вариант должен быть отмечен как «Норма».");
          continue;
        }
        if (accepted.join("\u0001") === row.rule.rule.accepted_values.join("\u0001")) continue;
        const result = await updateMethod(
          row.rule.id,
          qualitativePayload(laboratoryId, code, draft),
          `"${row.rule.revision}"`,
        );
        if ("code" in result) {
          if (result.code === "REVISION_CONFLICT") {
            conflicted = true;
            setConflicts((current) => ({ ...current, [row.key]: true }));
          }
          fail(result.detail);
          continue;
        }
      } else {
        continue;
      }
      saved += 1;
      setErrors((current) => {
        const next = { ...current };
        delete next[row.key];
        return next;
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.key];
        return next;
      });
    }
    if (failures.length === 0) {
      setSummary(saved === 0 ? null : { state: "success", text: "Справочник норм сохранён.", details: [] });
    } else {
      setSummary({
        state: "partial",
        text: `Сохранено: ${saved}. Не удалось: ${failures.length}. Повторите сохранение для неуспешных строк.`,
        details: conflicted
          ? [...failures, "Запись изменена другим пользователем: проверьте актуальные значения и повторите."]
          : failures,
      });
    }
    if (saved > 0 || conflicted) {
      // The fresh revision of the conflicted rows is loaded BEFORE the
      // §12.6 choice is shown.
      await methods.refetch();
    }
  }

  /** §12.6 «Сохранить моё значение»: retry the draft against the FRESH
   * revision (If-Match of the current server state, never the stale one). */
  async function keepMine(row: RowModel): Promise<void> {
    if (row.rule === null || row.indicator === null) return;
    const draft = drafts[row.key];
    if (draft === undefined) return;
    if (row.kind === "interval") {
      if (draft.lower !== "" && draft.upper !== "" && Number(draft.lower) > Number(draft.upper)) return;
    } else {
      if (draftAcceptedValues(draft).length === 0) return;
    }
    setSavePending(true);
    const payload =
      row.kind === "interval"
        ? intervalPayload(laboratoryId ?? "", row.indicator.code, draft)
        : qualitativePayload(laboratoryId ?? "", row.indicator.code, draft);
    const result = await updateMethod(row.rule.id, payload, `"${row.rule.revision}"`);
    setSavePending(false);
    if ("code" in result) {
      setConflicts((current) => ({ ...current, [row.key]: true }));
      setErrors((current) => ({
        ...current,
        [row.key]: result.detail !== "" ? result.detail : "Запись снова изменена другим пользователем.",
      }));
      await methods.refetch();
      return;
    }
    clearConflict(row.key);
    await methods.refetch();
  }

  /** §12.6 «Взять значение сервера»: the draft is reset to the server state,
   * no save runs. */
  function takeServer(row: RowModel): void {
    if (row.rule === null) return;
    setDrafts((current) => {
      const next = { ...current };
      delete next[row.key];
      return next;
    });
    clearConflict(row.key);
  }

  function clearConflict(key: string): void {
    setConflicts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  const LEAD = "Диапазоны используются для автоматической отметки нормы и отклонений в карточке ВСЭ.";

  if (context.loading) {
    return (
      <CatalogEditorPage title="Нормы исследований" description={LEAD}>
        <StatusView state="loading" title="Загрузка контекста…" />
      </CatalogEditorPage>
    );
  }
  if (context.configError !== null) {
    return (
      <CatalogEditorPage title="Нормы исследований" description={LEAD}>
        <StatusView state="no-scope" title={context.configError} />
        <div className="vse-catalog-actions">
          <Button type="button" variant="secondary" onClick={() => void navigate("/catalogs")}>
            Отменить
          </Button>
        </div>
      </CatalogEditorPage>
    );
  }

  const problem = methods.data !== undefined && "code" in methods.data ? (methods.data as Problem) : null;

  const intervalRows = rows.filter((row) => row.kind === "interval");
  const qualitativeRows = rows.filter((row) => row.kind === "qualitative");
  const textRows = rows.filter((row) => row.kind === "text");

  /** §15.1: the loading skeleton keeps the section geometry. */
  const skeleton =
    methods.isLoading || scopedContext === null ? (
      <section className="vse-catalog-section" aria-busy="true" aria-label="Загрузка норм…">
        <CatalogSectionHeader
          icon="directory-norms"
          title="Диапазоны нормы"
          description="Укажите нижнюю и верхнюю границу для исследований с вводом показателей."
        />
        <div className="vse-catalog-norm-list">
          {[0, 1, 2, 3].map((index) => (
            <div className="vse-catalog-skeleton" key={index} />
          ))}
        </div>
      </section>
    ) : null;

  return (
    <CatalogEditorPage title="Нормы исследований" description={LEAD}>
      <CatalogContextSlot context={context} onPick={allowedToSwitch ? pickLaboratory : null} />
      {summary !== null ? (
        <SaveSummary state={summary.state} text={summary.text} details={summary.details} />
      ) : null}
      {!pageReady ? (
        <StatusView state="empty" title="Выберите лабораторию, чтобы открыть справочник." />
      ) : skeleton !== null && problem === null ? (
        skeleton
      ) : problem !== null && problem.code === "CONFIGURATION_MISSING" ? (
        <StatusView
          state="no-scope"
          title="Область продукции не поддерживается системой."
          detail={problem.detail}
          onRetry={() => void methods.refetch()}
        />
      ) : problem !== null && problem.code === "ACCESS_DENIED" ? (
        <StatusView state="forbidden" detail={problem.detail} onRetry={() => void methods.refetch()} />
      ) : problem !== null ? (
        <StatusView
          state="network-error"
          title="Не удалось загрузить нормы."
          detail={problem.detail}
          onRetry={() => void methods.refetch()}
        />
      ) : (
        <section className="vse-catalog-section" aria-label="Диапазоны нормы">
          <CatalogSectionHeader
            icon="directory-norms"
            title="Диапазоны нормы"
            description="Укажите нижнюю и верхнюю границу для исследований с вводом показателей."
          />
          {/* §7.3: the category is one calm line under the lead — never a
              technical field or an empty context container. Without an area
              name the honest state is no line at all, not an empty label. */}
          {/* ТЗ DR53 Task 5: the context note is gone from the user screen. */}
          <div className="vse-catalog-norm-list">
            {intervalRows.map((row) => {
              const draft = draftFor(row);
              const rule = row.rule;
              const interval = rule?.rule.type === "interval" ? rule.rule : null;
              const serverValue =
                interval !== null && (interval.lower != null || interval.upper != null)
                  ? `от ${interval.lower ?? "—"} до ${interval.upper ?? "—"}${row.unit !== undefined ? ` ${row.unit}` : ""}`
                  : "Не настроено";
              const draftValue = `от ${draft.lower || "—"} до ${draft.upper || "—"}${row.unit !== undefined ? ` ${row.unit}` : ""}`;
              return (
                <NormRow
                  key={row.key}
                  name={row.name}
                  meta={
                    [
                      rule === null ? "Не настроено" : undefined,
                      row.indicator?.conditional === true ? CONDITIONAL_NOTE : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  lower={draft.lower}
                  upper={draft.upper}
                  unit={row.unit}
                  error={errors[row.key]}
                  busy={savePending}
                  readOnly={!canEdit}
                  conflict={
                    conflicts[row.key] === true && drafts[row.key] !== undefined
                      ? { serverValue, draftValue }
                      : undefined
                  }
                  onKeepMine={conflicts[row.key] === true ? () => void keepMine(row) : undefined}
                  onTakeServer={conflicts[row.key] === true ? () => takeServer(row) : undefined}
                  onLowerChange={(next) => {
                    setDrafts((current) => ({
                      ...current,
                      [row.key]: { ...draftFor(row), lower: next },
                    }));
                    setSummary(null);
                  }}
                  onUpperChange={(next) => {
                    setDrafts((current) => ({
                      ...current,
                      [row.key]: { ...draftFor(row), upper: next },
                    }));
                    setSummary(null);
                  }}
                />
              );
            })}
            {qualitativeRows.map((row) => {
              const draft = draftFor(row);
              const indicator = row.indicator;
              const registryOptions = (indicator?.options ?? []).map((value) => ({
                value,
                label: value,
              }));
              const normSet = new Set(draft.accepted);
              const rowsModel: QualitativeRow[] = [
                // The full registry variant list is always shown; an option
                // outside the accepted list is «Отклонение».
                ...registryOptions.map((option) => ({
                  key: option.value,
                  value: option.label,
                  norm: normSet.has(option.value),
                  onNormChange: (norm: boolean) =>
                    setDrafts((current) => {
                      const accepted = norm
                        ? [...draft.accepted, option.value]
                        : draft.accepted.filter((value) => value !== option.value);
                      return { ...current, [row.key]: { ...draftFor(row), accepted } };
                    }),
                  onRemove: undefined,
                })),
                // Manually added rows beyond the registry (honest, removable).
                ...draft.extra
                  .filter((value) => !registryOptions.some((option) => option.value === value))
                  .map((value, index) => ({
                    // The index key keeps the input mounted while typing
                    // (the row value changes on every keystroke).
                    key: `extra-${index}`,
                    value,
                    // §11.2: the focus moves into the just-added field.
                    focus: value === "",
                    norm: normSet.has(value),
                    onValueChange: (next: string) =>
                      setDrafts((current) => {
                        const extra = [...draft.extra];
                        extra[extra.indexOf(value)] = next;
                        return { ...current, [row.key]: { ...draftFor(row), extra } };
                      }),
                    onNormChange: (norm: boolean) =>
                      setDrafts((current) => {
                        const accepted = norm
                          ? [...draft.accepted, value]
                          : draft.accepted.filter((item) => item !== value);
                        return { ...current, [row.key]: { ...draftFor(row), accepted } };
                      }),
                    onRemove: () =>
                      setDrafts((current) => ({
                        ...current,
                        [row.key]: {
                          ...draftFor(row),
                          extra: draft.extra.filter((item) => item !== value),
                        },
                      })),
                  })),
              ];
              return (
                <QualitativeBlock
                  key={row.key}
                  title={row.name}
                  description={
                    [
                      indicator?.result_schema === "ENUM"
                        ? "Укажите варианты результата и отметьте, считается ли вариант нормой."
                        : undefined,
                      indicator?.conditional === true ? CONDITIONAL_NOTE : undefined,
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  rows={rowsModel}
                  onAdd={
                    canEdit
                      ? () =>
                          setDrafts((current) => ({
                            ...current,
                            [row.key]: { ...draftFor(row), extra: [...draft.extra, ""] },
                          }))
                      : undefined
                  }
                  readOnly={!canEdit}
                  busy={savePending}
                  error={errors[row.key]}
                />
              );
            })}
            {textRows.map((row) => (
              <article
                className="vse-catalog-norm-row vse-catalog-text-row"
                key={row.key}
                data-testid={`method-text-${row.key}`}
              >
                <div className="vse-catalog-norm-info">
                  <div className="vse-catalog-norm-name">{row.name}</div>
                  <p className="vse-catalog-norm-meta">{TEXT_NOTE}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="vse-catalog-actions">
        <Button type="button" variant="secondary" onClick={() => void navigate("/catalogs")}>
          Отменить
        </Button>
        <Button
          type="button"
          variant="primary"
          busy={savePending}
          busyLabel="Сохранение…"
          disabled={!canEdit || !dirty}
          onClick={() => void runSave()}
        >
          Сохранить справочник
        </Button>
      </div>

    </CatalogEditorPage>
  );

  async function runSave(): Promise<void> {
    setSavePending(true);
    await save();
    setSavePending(false);
  }

  function pickLaboratory(id: string): void {
    const search = new URLSearchParams(location.search);
    search.set("laboratory_id", id);
    navigate(`/catalogs?${search.toString()}`);
  }
}

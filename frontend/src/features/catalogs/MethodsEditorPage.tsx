/**
 * «Нормы исследований» editor page (ТЗ-DR6 §11 + ТЗ-DR28 §5/§6, mockup
 * directory-norms-edit.html).
 *
 * The working scope is never guessed: the page reads the scoped context
 * (GET /catalogs/methods/context) where the backend resolves the chosen
 * HUMAN-READABLE area onto the real internal species/state pair — a laboratory
 * UUID is never used as a species and no UUID is ever shown. The full
 * VSE-F18–F29 registry is listed even without rules: an active norm renders as
 * an editable row, a missing one shows the honest «Не настроено» with
 * «Настроить», and the «Добавить норму» action opens the SHARED MethodEditor
 * in create mode (never a copied form). A null boundary stays null (never 0);
 * lower ≤ upper is enforced; one «Сохранить справочник» saves ONLY the dirty
 * rules sequentially with honest per-rule results and 409 resolution.
 */
import { useQuery } from "@tanstack/react-query";
import "./catalogs.css";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "../../shared/ui/Button";
import { StatusView } from "../../shared/ui/StatusView";
import { Dialog } from "../../shared/ui/Dialog";
import {
  deleteMethod,
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
import { DELETE_WARNING, MethodEditor } from "./MethodEditor";

const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/** The human-readable source label of a rule (§6.1 «источник»; never a UUID). */
export function sourceLabel(source: unknown): string | undefined {
  if (source === null || typeof source !== "object") return undefined;
  const name = (source as Record<string, unknown>)["name"];
  return typeof name === "string" && name.trim() !== "" ? name.trim() : undefined;
}

export interface MethodDraft {
  lower: string;
  upper: string;
  lowerInclusive: boolean;
  upperInclusive: boolean;
  /** Qualitative: the accepted values of the draft (Норма rows). */
  accepted: string[];
  /** Extra qualitative rows added from the registry. */
  extra: string[];
}

/** The update payload of one interval draft against the current rule (§12). */
export function intervalPayload(
  rule: MethodRuleTyped,
  draft: MethodDraft,
): Parameters<typeof updateMethod>[1] {
  return {
    laboratory_id: rule.laboratory_id,
    product_species_id: rule.product_species_id,
    indicator_id: rule.indicator_id,
    product_state_id: rule.product_state_id,
    result_schema: rule.result_schema as never,
    unit_id: rule.unit_id,
    version: rule.version,
    rule: {
      type: "interval" as const,
      ...(draft.lower !== "" ? { lower: draft.lower } : {}),
      ...(draft.upper !== "" ? { upper: draft.upper } : {}),
      lower_inclusive: draft.lowerInclusive,
      upper_inclusive: draft.upperInclusive,
    },
    source: rule.source as { name: string },
    ...(rule.effective_from != null ? { effective_from: rule.effective_from } : {}),
  };
}

/** The update payload of one qualitative draft against the current rule. */
export function qualitativePayload(
  rule: MethodRuleTyped,
  draft: MethodDraft,
): Parameters<typeof updateMethod>[1] {
  const accepted = [...draft.accepted, ...draft.extra.filter((value) => !draft.accepted.includes(value))];
  return {
    laboratory_id: rule.laboratory_id,
    product_species_id: rule.product_species_id,
    indicator_id: rule.indicator_id,
    product_state_id: rule.product_state_id,
    result_schema: rule.result_schema as never,
    unit_id: rule.unit_id,
    version: rule.version,
    rule: { type: "qualitative" as const, accepted_values: accepted },
    source: rule.source as { name: string },
    ...(rule.effective_from != null ? { effective_from: rule.effective_from } : {}),
  };
}

interface RowModel {
  key: string;
  /** The active rule of the indicator; null for an honest «Не настроено». */
  rule: MethodRuleTyped | null;
  /** The canonical registry definition (absent for an unknown rule row). */
  indicator: CatalogIndicator | null;
  name: string;
  meta: string | undefined;
  unit: string | undefined;
  kind: "interval" | "qualitative";
  /** Unknown to the shared registry: honest diagnostic, no invented name. */
  unknown: boolean;
}

/** Annotation of the conditionally mandatory F21 (spec §4, GUID list — never
 * a per-species policy invented here). */
const CONDITIONAL_NOTE = "Обязательно для указанных видов продукции";

/**
 * The registry-driven rows (§6.1): every expected indicator of the context is
 * listed in the canonical order — with its active rule or as «Не настроено» —
 * and an ACTIVE rule outside the registry keeps its honest diagnostic.
 */
export function buildMethodRows(
  indicators: readonly CatalogIndicator[],
  rules: MethodRuleTyped[],
): RowModel[] {
  const byIndicator = new Map<string, MethodRuleTyped>();
  for (const rule of rules) byIndicator.set(rule.indicator_id, rule);
  const rows: RowModel[] = [];
  const counter = new Map<string, number>();
  for (const indicator of indicators) {
    const rule = byIndicator.get(indicator.id) ?? null;
    counter.set(indicator.id, (counter.get(indicator.id) ?? 0) + 1);
    const ordinal = counter.get(indicator.id) ?? 1;
    const qualitative = rule?.rule.type === "qualitative";
    rows.push({
      key: rule?.id ?? `missing-${indicator.id}`,
      rule,
      indicator,
      name: indicator.name,
      meta: rule !== null && ordinal > 1 ? `Ещё одно правило по этому показателю (${ordinal})` : undefined,
      unit: rule?.unit_id === "" ? undefined : (rule?.unit_id ?? indicator.unit_id ?? undefined),
      kind: qualitative ? "qualitative" : "interval",
      unknown: false,
    });
  }
  for (const rule of rules) {
    if (indicators.some((item) => item.id === rule.indicator_id)) continue;
    rows.push({
      key: rule.id,
      rule,
      indicator: null,
      name: "",
      meta: undefined,
      unit: rule.unit_id === "" ? undefined : rule.unit_id,
      kind: rule.rule.type === "qualitative" ? "qualitative" : "interval",
      unknown: true,
    });
  }
  return rows;
}

export function MethodsEditorPage(): React.ReactElement {
  const context = useCatalogContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { laboratoryId, canEdit, allowedToSwitch } = context;

  // The working scope of the page: the human-readable area code in the URL
  // (never a GUID); species/state selections are restorable link params.
  const params = new URLSearchParams(location.search);
  const areaParam = params.get("area");
  const speciesParam = params.get("species");
  const stateParam = params.get("state");
  const pageReady = laboratoryId !== null && context.configError === null && !context.needsSelection;

  const methods = useQuery({
    queryKey: [laboratoryId, "methods-context", areaParam, speciesParam, stateParam],
    queryFn: ({ signal }) =>
      fetchMethodsContext(laboratoryId ?? "", areaParam ?? "meat", speciesParam, stateParam, signal),
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
  const [deleteTarget, setDeleteTarget] = useState<{ key: string; rule: MethodRuleTyped } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const scopedContext = methods.data !== undefined && !("code" in methods.data) ? methods.data : null;

  const rows = useMemo(
    () =>
      scopedContext === null ? [] : buildMethodRows(scopedContext.indicators, scopedContext.active_rules),
    [scopedContext],
  );

  const draftFor = (row: RowModel): MethodDraft => {
    const existing = drafts[row.key];
    if (existing !== undefined) return existing;
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
    return {
      lower: "",
      upper: "",
      lowerInclusive: true,
      upperInclusive: true,
      accepted: [...(row.rule?.rule.type === "qualitative" ? row.rule.rule.accepted_values : [])],
      extra: [],
    };
  };

  const dirty = useMemo(
    () =>
      rows.some((row) => {
        if (row.rule === null) return false;
        const draft = drafts[row.key];
        if (draft === undefined) return false;
        if (row.rule.rule.type === "interval") {
          return (
            draft.lower !== (row.rule.rule.lower ?? "") ||
            draft.upper !== (row.rule.rule.upper ?? "") ||
            draft.lowerInclusive !== (row.rule.rule.lower_inclusive ?? true) ||
            draft.upperInclusive !== (row.rule.rule.upper_inclusive ?? true)
          );
        }
        return (
          draft.accepted.join("\u0001") !== row.rule.rule.accepted_values.join("\u0001") ||
          draft.extra.length > 0
        );
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
      if (row.rule === null) continue;
      const draft = drafts[row.key];
      // A conflicted row waits for the explicit §12.6 choice; a second
      // «Сохранить» never re-submits the stale draft against the fresh
      // revision.
      if (conflicts[row.key] === true) continue;
      if (draft === undefined) continue;
      const rule = row.rule;
      const fail = (message: string): void => {
        const text = message === "" ? "Не удалось сохранить норму." : message;
        failures.push(text);
        setErrors((current) => ({ ...current, [row.key]: text }));
      };
      if (rule.rule.type === "interval") {
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
        const interval = rule.rule;
        const unchanged =
          draft.lower === (interval.lower ?? "") &&
          draft.upper === (interval.upper ?? "") &&
          draft.lowerInclusive === (interval.lower_inclusive ?? true) &&
          draft.upperInclusive === (interval.upper_inclusive ?? true);
        if (unchanged) continue;
        const result = await updateMethod(rule.id, intervalPayload(rule, draft), `"${rule.revision}"`);
        if ("code" in result) {
          if (result.code === "REVISION_CONFLICT") {
            conflicted = true;
            setConflicts((current) => ({ ...current, [row.key]: true }));
          }
          fail(result.detail);
          continue;
        }
      } else {
        // The accepted list of the draft plus the extra registry rows.
        const accepted = [
          ...draft.accepted,
          ...draft.extra.filter((value) => !draft.accepted.includes(value)),
        ];
        if (accepted.length === 0) {
          fail("Хотя бы один вариант должен быть отмечен как «Норма».");
          continue;
        }
        const qualitative = rule.rule;
        if (qualitative.type !== "qualitative") continue;
        if (accepted.join("\u0001") === qualitative.accepted_values.join("\u0001")) continue;
        const result = await updateMethod(rule.id, qualitativePayload(rule, draft), `"${rule.revision}"`);
        if ("code" in result) {
          if (result.code === "REVISION_CONFLICT") {
            conflicted = true;
            setConflicts((current) => ({ ...current, [row.key]: true }));
          }
          fail(result.detail);
          continue;
        }
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
    if (row.rule === null) return;
    const draft = drafts[row.key];
    if (draft === undefined) return;
    if (row.rule.rule.type === "interval") {
      if (draft.lower !== "" && draft.upper !== "" && Number(draft.lower) > Number(draft.upper)) return;
    } else {
      const accepted = [...draft.accepted, ...draft.extra.filter((value) => !draft.accepted.includes(value))];
      if (accepted.length === 0) return;
    }
    setSavePending(true);
    const payload =
      row.rule.rule.type === "interval"
        ? intervalPayload(row.rule, draft)
        : qualitativePayload(row.rule, draft);
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
    if (row.rule.rule.type === "interval") {
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.key];
        return next;
      });
    } else {
      setDrafts((current) => ({
        ...current,
        [row.key]: {
          lower: "",
          upper: "",
          lowerInclusive: true,
          upperInclusive: true,
          accepted: [...(row.rule?.rule.type === "qualitative" ? row.rule.rule.accepted_values : [])],
          extra: [],
        },
      }));
    }
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

  function pickScope(update: { area?: string; species?: string; state?: string }): void {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(update)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    navigate(`/catalogs?${next.toString()}`);
  }

  if (context.loading) {
    return (
      <CatalogEditorPage title="Нормы исследований" description="Загрузка контекста…">
        <StatusView state="loading" title="Загрузка контекста…" />
      </CatalogEditorPage>
    );
  }
  if (context.configError !== null) {
    return (
      <CatalogEditorPage
        title="Нормы исследований"
        description="Диапазоны используются для автоматической отметки нормы и отклонений в карточке ВСЭ."
      >
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

  // The honest scope screen (§5.1): a missing or unconfigured scope is never
  // mistaken for an empty catalog and never triggers a scoped list call with
  // the laboratory UUID.
  const scopedContextPairReady =
    scopedContext !== null && scopedContext.product_species != null && scopedContext.product_state != null;

  /** The human-readable area of this view (the code, never a GUID). */
  const activeArea =
    scopedContext === null
      ? null
      : (scopedContext.areas.find((item) => item.code === (areaParam ?? "meat")) ??
        scopedContext.areas[0] ??
        null);

  const intervalRows = rows.filter((row) => row.kind === "interval");
  const qualitativeRows = rows.filter((row) => row.kind === "qualitative");
  const unsetRows = rows.filter((row) => row.rule === null && !row.unknown);

  return (
    <CatalogEditorPage
      title="Нормы исследований"
      description="Диапазоны используются для автоматической отметки нормы и отклонений в карточке ВСЭ."
    >
      <CatalogContextSlot context={context} onPick={allowedToSwitch ? pickLaboratory : null} />
      {summary !== null ? (
        <SaveSummary state={summary.state} text={summary.text} details={summary.details} />
      ) : null}
      {!pageReady ? (
        <StatusView state="empty" title="Выберите лабораторию, чтобы открыть справочник." />
      ) : methods.isLoading ? (
        <section className="vse-catalog-section" aria-labelledby="methods-section-title">
          <CatalogSectionHeader
            icon="directory-norms"
            title="Диапазоны нормы"
            description="Укажите нижнюю и верхнюю границу для исследований с вводом показателей."
          />
          <StatusView state="loading" title="Загрузка норм…" />
        </section>
      ) : problem !== null && problem.code === "CONFIGURATION_MISSING" ? (
        <StatusView
          state="no-scope"
          title="Вид продукции и состояние продукции не настроены для этой лаборатории."
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
      ) : scopedContext !== null ? (
        <section className="vse-catalog-section" aria-labelledby="methods-section-title">
          <CatalogSectionHeader
            icon="directory-norms"
            title="Диапазоны нормы"
            description="Укажите нижнюю и верхнюю границу для исследований с вводом показателей."
            actions={
              canEdit && scopedContextPairReady ? (
                <Button type="button" variant="primary" onClick={() => openCreate()}>
                  Добавить норму
                </Button>
              ) : undefined
            }
          />
          <div className="vse-catalog-context" data-testid="methods-scope">
            <div className="app-field">
              <div className="app-field-heading">
                <label htmlFor="methods-area">Вид продукции</label>
              </div>
              <select
                id="methods-area"
                value={activeArea?.code ?? ""}
                disabled={scopedContext.areas.length <= 1}
                onChange={(event) => pickScope({ area: event.target.value, species: "", state: "" })}
              >
                {scopedContext.areas.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            {scopedContext.species_options.length > 1 ? (
              <div className="app-field">
                <div className="app-field-heading">
                  <label htmlFor="methods-species">Продукция</label>
                </div>
                <select
                  id="methods-species"
                  value={scopedContext.product_species?.id ?? ""}
                  onChange={(event) => pickScope({ species: event.target.value, state: "" })}
                >
                  {scopedContext.product_species === null ? (
                    <option value="">— выберите продукцию —</option>
                  ) : null}
                  {scopedContext.species_options.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : scopedContext.product_species != null ? (
              <p className="vse-catalog-note" data-testid="methods-species-name">
                Продукция: {scopedContext.product_species.label}
              </p>
            ) : null}
            {scopedContext.states.length > 1 ? (
              <div className="app-field">
                <div className="app-field-heading">
                  <label htmlFor="methods-state">Состояние продукции</label>
                </div>
                <select
                  id="methods-state"
                  value={scopedContext.product_state?.id ?? ""}
                  onChange={(event) => pickScope({ state: event.target.value })}
                >
                  {scopedContext.product_state === null ? (
                    <option value="">— выберите состояние —</option>
                  ) : null}
                  {scopedContext.states.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : scopedContext.product_state != null ? (
              <p className="vse-catalog-note" data-testid="methods-state-name">
                Состояние продукции: {scopedContext.product_state.label}
              </p>
            ) : null}
          </div>
          {!scopedContextPairReady ? (
            // Options exist but the pair is not resolved yet: the §5.2/§5.3
            // selectors above are the way forward — never a misleading
            // «not configured» screen (that one stays for genuinely zero
            // options and the invalid laboratory-UUID scope).
            <p className="vse-catalog-note" data-testid="methods-scope-hint">
              {scopedContext.product_species === null
                ? "Выберите вид продукции, чтобы открыть нормы."
                : "Выберите состояние продукции, чтобы открыть нормы."}
            </p>
          ) : null}
          {scopedContextPairReady ? (
            <>
              {unsetRows.length > 0 ? (
                <div className="vse-catalog-norm-list" data-testid="methods-unset">
                  {unsetRows.map((row) => (
                    <article className="vse-catalog-norm-row" key={row.key}>
                      <div className="vse-catalog-norm-info">
                        <div className="vse-catalog-norm-name">{row.name}</div>
                        <p className="vse-catalog-unset">Не настроено</p>
                        {row.indicator?.conditional === true ? (
                          <p className="vse-catalog-note">{CONDITIONAL_NOTE}</p>
                        ) : null}
                      </div>
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={savePending}
                          onClick={() => openCreate()}
                        >
                          Настроить
                        </Button>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
              <div className="vse-catalog-norm-list">
                {intervalRows.map((row) => {
                  if (row.rule === null || row.unknown) return null;
                  const draft = draftFor(row);
                  const rule = row.rule;
                  const interval = rule.rule;
                  const serverValue =
                    interval.type === "interval" && (interval.lower != null || interval.upper != null)
                      ? `от ${interval.lower ?? "—"} до ${interval.upper ?? "—"}${row.unit !== undefined ? ` ${row.unit}` : ""}`
                      : "Не настроено";
                  const draftValue = `от ${draft.lower || "—"} до ${draft.upper || "—"}${row.unit !== undefined ? ` ${row.unit}` : ""}`;
                  const metadata = (
                    <div className="vse-catalog-field">
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.lowerInclusive}
                          disabled={savePending || !canEdit}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [row.key]: { ...draftFor(row), lowerInclusive: event.target.checked },
                            }))
                          }
                        />{" "}
                        нижняя граница включена
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.upperInclusive}
                          disabled={savePending || !canEdit}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [row.key]: { ...draftFor(row), upperInclusive: event.target.checked },
                            }))
                          }
                        />{" "}
                        верхняя граница включена
                      </label>
                    </div>
                  );
                  return (
                    <NormRow
                      key={row.key}
                      name={row.name}
                      meta={row.meta ?? (row.indicator?.conditional === true ? CONDITIONAL_NOTE : undefined)}
                      source={sourceLabel(rule.source)}
                      lower={draft.lower}
                      upper={draft.upper}
                      unit={row.unit}
                      error={errors[row.key]}
                      busy={savePending}
                      readOnly={!canEdit}
                      details={metadata}
                      conflict={
                        conflicts[row.key] === true && drafts[row.key] !== undefined
                          ? { serverValue, draftValue }
                          : undefined
                      }
                      onKeepMine={conflicts[row.key] === true ? () => void keepMine(row) : undefined}
                      onTakeServer={conflicts[row.key] === true ? () => takeServer(row) : undefined}
                      secondary={
                        canEdit ? (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={savePending}
                            aria-label={`Удалить норму: ${row.name}`}
                            onClick={() => setDeleteTarget({ key: row.key, rule })}
                          >
                            Удалить норму
                          </Button>
                        ) : undefined
                      }
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
                  if (row.rule === null || row.unknown) return null;
                  const draft = draftFor(row);
                  const rule = row.rule;
                  const indicator = row.indicator;
                  const registryOptions = (indicator?.options ?? []).map((value) => ({
                    value,
                    label: value,
                  }));
                  const normSet = new Set(draft.accepted);
                  const rowsModel: QualitativeRow[] = [
                    // The full registry variant list is always shown (mockup);
                    // an option outside the accepted list is «Отклонение».
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
                    // Manually added rows beyond the registry (honest, marked).
                    ...draft.extra
                      .filter((value) => !registryOptions.some((option) => option.value === value))
                      .map((value) => ({
                        key: value,
                        value,
                        norm: normSet.has(value),
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
                          row.indicator?.conditional === true ? CONDITIONAL_NOTE : undefined,
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                      rows={rowsModel}
                      readOnly={!canEdit}
                      busy={savePending}
                      error={errors[row.key]}
                      // §6.1: the source of the methodology stays visible on
                      // the enum rows too («допустимые значения + какие норма»).
                      details={
                        sourceLabel(rule.source) !== undefined ? (
                          <p>Источник: {sourceLabel(rule.source)}</p>
                        ) : undefined
                      }
                      secondary={
                        canEdit ? (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={savePending}
                            aria-label={`Удалить норму: ${row.name}`}
                            onClick={() => setDeleteTarget({ key: row.key, rule })}
                          >
                            Удалить норму
                          </Button>
                        ) : undefined
                      }
                    />
                  );
                })}
                {rows
                  .filter((row) => row.unknown)
                  .map((row) => (
                    <article
                      className="vse-catalog-diag"
                      key={row.key}
                      data-testid={`method-diag-${row.key}`}
                    >
                      Норма показателя вне общего каталога. Идентификатор:{" "}
                      <code>{row.rule?.indicator_id}</code>. Наименование недоступно в read model — значение
                      не редактируется на этой странице.
                    </article>
                  ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
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

      {createOpen && scopedContext?.product_species != null && scopedContext?.product_state != null ? (
        <section className="vse-catalog-section" data-testid="method-create">
          <CatalogSectionHeader
            title="Новая норма"
            description="Выберите показатель и введите подтверждённые значения методики."
          />
          <MethodEditor
            mode="create"
            laboratoryId={scopedContext.laboratory.id}
            productSpeciesId={scopedContext.product_species.id}
            productStateId={scopedContext.product_state.id}
            indicators={scopedContext.indicators}
            busy={savePending}
            onSaved={() => {
              setCreateOpen(false);
              void methods.refetch();
            }}
            onClose={() => setCreateOpen(false)}
          />
        </section>
      ) : null}

      {deleteTarget !== null ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title="Удалить действующую норму?"
          description={DELETE_WARNING}
          confirmLabel="Удалить норму"
          danger
          busy={deleteBusy}
          onConfirm={() => void runDelete()}
        />
      ) : null}
    </CatalogEditorPage>
  );

  function openCreate(): void {
    setCreateOpen(true);
  }

  async function runSave(): Promise<void> {
    setSavePending(true);
    await save();
    setSavePending(false);
  }

  async function runDelete(): Promise<void> {
    if (deleteTarget === null) return;
    setDeleteBusy(true);
    const problem = await deleteMethod(
      deleteTarget.rule.id,
      `"${deleteTarget.rule.revision}"`,
      crypto.randomUUID(),
    );
    setDeleteBusy(false);
    if (problem !== null) {
      setDeleteTarget(null);
      return;
    }
    setDeleteTarget(null);
    await methods.refetch();
  }

  function pickLaboratory(id: string): void {
    const search = new URLSearchParams(location.search);
    search.set("laboratory_id", id);
    navigate(`/catalogs?${search.toString()}`);
  }
}

/**
 * «Нормы исследований» editor page (ТЗ-DR6 §11, ТЗ-DR28 §5/§6, mockup
 * directory-norms-edit.html).
 *
 * The page works ONLY on the honest scoped read model
 * GET /catalogs/methods/context (ТЗ-DR28 §7 variant B): the backend resolves
 * the real product species/state pair behind the chosen human-readable area,
 * so a laboratory UUID is never sent as a species (§5.1) and the legacy
 * «Нормы для этой области не заданы» of an unconfigured scope is replaced by
 * the blocking configuration screen. The full VSE-F18–F29 list is shown even
 * with no rules (§6.1); «Добавить норму» opens the EXISTING MethodEditor in
 * create mode (§6.2); a configuration-missing scope never fetches the catalog
 * and never creates a norm (R-DR28-1).
 *
 * Interval MethodRules render as [name/meta] [Норма от + unit] [Норма до +
 * unit]; qualitative rules render with the variants coming from the context
 * indicator catalog (ONE registry, §6.3). A null boundary stays null (never
 * 0); lower ≤ upper is enforced; one «Сохранить справочник» saves ONLY the
 * dirty rules sequentially with honest per-rule results and 409 resolution.
 */
import { useQuery } from "@tanstack/react-query";
import "./catalogs.css";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "../../shared/ui/Button";
import { StatusView } from "../../shared/ui/StatusView";
import { Dialog } from "../../shared/ui/Dialog";
import {
  fetchMethodsContext,
  deleteMethod,
  typedMethodRule,
  updateMethod,
  type CatalogIndicatorView,
  type MethodRuleTyped,
  type MethodsContextData,
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
  rule: MethodRuleTyped;
  indicatorId: string;
  name: string;
  meta: string | undefined;
  unit: string | undefined;
  kind: "interval" | "qualitative";
  /** Unknown to the shared registry: honest diagnostic, no invented name. */
  unknown: boolean;
}

/** The rows of one indicator: its active rules or, when none, «Не настроено».
 * Historical inactive versions are never duplicated (ТЗ-DR28 §6.1). */
interface IndicatorBlock {
  indicator: CatalogIndicatorView;
  rules: RowModel[];
  configured: boolean;
}

function rowFor(rule: MethodRuleTyped, indicators: readonly CatalogIndicatorView[]): RowModel {
  const definition = indicators.find((item) => item.id === rule.indicator_id);
  const qualitative = rule.rule.type === "qualitative";
  return {
    key: rule.id,
    rule,
    indicatorId: rule.indicator_id,
    name: definition?.name ?? "",
    meta: definition === undefined ? undefined : `${definition.code} · версия ${rule.version}`,
    unit: rule.unit_id === "" ? undefined : rule.unit_id,
    kind: qualitative ? "qualitative" : "interval",
    unknown: definition === undefined,
  };
}

/** The full VSE-F18–F29 blocks: configured rules first-class, everything
 * without an active rule honestly «Не настроено» (§6.1). */
export function buildIndicatorBlocks(context: MethodsContextData): {
  blocks: IndicatorBlock[];
  unknownRules: RowModel[];
} {
  const rules: MethodRuleTyped[] = context.active_rules.map((rule) => typedMethodRule(rule));
  const byIndicator = new Map<string, MethodRuleTyped[]>();
  for (const rule of rules) {
    const list = byIndicator.get(rule.indicator_id) ?? [];
    list.push(rule);
    byIndicator.set(rule.indicator_id, list);
  }
  const blocks = context.indicators.map((indicator) => {
    const indicatorRules = byIndicator.get(indicator.id) ?? [];
    return {
      indicator,
      rules: indicatorRules.map((rule) => rowFor(rule, context.indicators)),
      configured: indicatorRules.length > 0,
    };
  });
  const known = new Set(context.indicators.map((item) => item.id));
  const unknownRules = rules
    .filter((rule) => !known.has(rule.indicator_id))
    .map((rule) => rowFor(rule, context.indicators));
  return { blocks, unknownRules };
}

export function MethodsEditorPage(): React.ReactElement {
  const context = useCatalogContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { laboratoryId, canEdit, allowedToSwitch } = context;

  // The URL carries the stable safe area CODE, never a GUID (ТЗ-DR28 §5.2);
  // the species/state pair of the deep link is the server-resolved restore
  // link of §5.3.
  const params = new URLSearchParams(location.search);
  const areaCode = params.get("area") ?? "meat";
  const speciesParam = params.get("species");
  const stateParam = params.get("state");

  const scoped = laboratoryId !== null;
  const methodsContext = useQuery({
    queryKey: [laboratoryId, areaCode, speciesParam, stateParam, "/catalogs/methods/context"],
    queryFn: ({ signal }) =>
      fetchMethodsContext(laboratoryId ?? "", areaCode, speciesParam, stateParam, signal),
    enabled: scoped,
  });

  function updateParams(patch: Record<string, string | null>): void {
    const search = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) search.delete(key);
      else search.set(key, value);
    }
    navigate(`/catalogs?${search.toString()}`);
  }

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
  /** The open create dialog: null closed, otherwise the pre-picked indicator. */
  const [createTarget, setCreateTarget] = useState<string | null>(null);

  const model = useMemo(() => {
    const data =
      methodsContext.data !== undefined && !("code" in methodsContext.data) ? methodsContext.data : null;
    return data === null ? null : buildIndicatorBlocks(data);
  }, [methodsContext.data]);

  const rows = useMemo(
    () => (model === null ? [] : [...model.blocks.flatMap((block) => block.rules), ...model.unknownRules]),
    [model],
  );

  const draftFor = (row: RowModel): MethodDraft => {
    const existing = drafts[row.key];
    if (existing !== undefined) return existing;
    if (row.rule.rule.type === "interval") {
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
      accepted: [...row.rule.rule.accepted_values],
      extra: [],
    };
  };

  const dirty = useMemo(
    () =>
      rows.some((row) => {
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
      const draft = drafts[row.key];
      // A conflicted row waits for the explicit §12.6 choice; a second
      // «Сохранить» never re-submits the stale draft against the fresh
      // revision.
      if (conflicts[row.key] === true) continue;
      if (draft === undefined) continue;
      const fail = (message: string): void => {
        const text = message === "" ? "Не удалось сохранить норму." : message;
        failures.push(text);
        setErrors((current) => ({ ...current, [row.key]: text }));
      };
      const interval = row.rule.rule;
      if (interval.type === "interval") {
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
        const rule = interval;
        const unchanged =
          draft.lower === (rule.lower ?? "") &&
          draft.upper === (rule.upper ?? "") &&
          draft.lowerInclusive === (rule.lower_inclusive ?? true) &&
          draft.upperInclusive === (rule.upper_inclusive ?? true);
        if (unchanged) continue;
        const result = await updateMethod(
          row.rule.id,
          intervalPayload(row.rule, draft),
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
        // The accepted list of the draft plus the extra registry rows.
        const accepted = [
          ...draft.accepted,
          ...draft.extra.filter((value) => !draft.accepted.includes(value)),
        ];
        if (accepted.length === 0) {
          fail("Хотя бы один вариант должен быть отмечен как «Норма».");
          continue;
        }
        const qualitative = row.rule.rule;
        if (qualitative.type !== "qualitative") continue;
        if (accepted.join("\u0001") === qualitative.accepted_values.join("\u0001")) continue;
        const result = await updateMethod(
          row.rule.id,
          qualitativePayload(row.rule, draft),
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
      await methodsContext.refetch();
    }
  }

  /** §12.6 «Сохранить моё значение»: retry the draft against the FRESH
   * revision (If-Match of the current server state, never the stale one). */
  async function keepMine(row: RowModel): Promise<void> {
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
      await methodsContext.refetch();
      return;
    }
    clearConflict(row.key);
    await methodsContext.refetch();
  }

  /** §12.6 «Взять значение сервера»: the draft is reset to the server state,
   * no save runs. */
  function takeServer(row: RowModel): void {
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
          accepted: [...(row.rule.rule.type === "qualitative" ? row.rule.rule.accepted_values : [])],
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

  if (!scoped) {
    return (
      <CatalogEditorPage
        title="Нормы исследований"
        description="Диапазоны используются для автоматической отметки нормы и отклонений в карточке ВСЭ."
      >
        <StatusView state="empty" title="Выберите лабораторию, чтобы открыть справочник." />
        <div className="vse-catalog-actions">
          <Button type="button" variant="secondary" onClick={() => void navigate("/catalogs")}>
            Отменить
          </Button>
        </div>
      </CatalogEditorPage>
    );
  }

  if (methodsContext.isLoading) {
    return (
      <CatalogEditorPage title="Нормы исследований" description="Загрузка области продукции…">
        <StatusView state="loading" title="Загрузка области продукции…" />
      </CatalogEditorPage>
    );
  }

  const problem =
    methodsContext.data !== undefined && "code" in methodsContext.data
      ? (methodsContext.data as Problem)
      : null;
  if (problem !== null && problem.code === "CONFIGURATION_MISSING") {
    return (
      <CatalogEditorPage
        title="Нормы исследований"
        description="Диапазоны используются для автоматической отметки нормы и отклонений в карточке ВСЭ."
      >
        <StatusView
          state="no-scope"
          title={
            problem.detail !== ""
              ? problem.detail
              : "Вид продукции и состояние продукции не настроены для этой лаборатории."
          }
        />
        <p className="vse-catalog-lead">
          Назначение рабочего вида продукции выполняет ответственный администратор. Вводить идентификаторы
          вручную не требуется.
        </p>
        <div className="vse-catalog-actions">
          <Button type="button" variant="secondary" onClick={() => void navigate("/catalogs")}>
            Вернуться
          </Button>
          <Button type="button" variant="primary" onClick={() => void methodsContext.refetch()}>
            Проверить снова
          </Button>
        </div>
      </CatalogEditorPage>
    );
  }
  if (problem !== null) {
    return (
      <CatalogEditorPage
        title="Нормы исследований"
        description="Диапазоны используются для автоматической отметки нормы и отклонений в карточке ВСЭ."
      >
        <StatusView
          state={problem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
          title={problem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить справочник."}
          detail={problem.detail}
          onRetry={() => void methodsContext.refetch()}
        />
        <div className="vse-catalog-actions">
          <Button type="button" variant="secondary" onClick={() => void navigate("/catalogs")}>
            Отменить
          </Button>
        </div>
      </CatalogEditorPage>
    );
  }

  const data = methodsContext.data as MethodsContextData;
  const area = data.areas.find((item) => item.code === areaCode) ?? data.areas[0] ?? null;

  // R-DR28-1: without a configured area there is no catalog call and no
  // misleading «нормы не заданы» — only the honest configuration screen.
  if (area === null || !area.configured || data.species_options.length === 0) {
    return (
      <CatalogEditorPage
        title="Нормы исследований"
        description="Диапазоны используются для автоматической отметки нормы и отклонений в карточке ВСЭ."
      >
        <StatusView
          state="no-scope"
          title="Вид продукции и состояние продукции не настроены для этой лаборатории."
        />
        <p className="vse-catalog-lead">
          Назначение рабочего вида продукции выполняет ответственный администратор через защищённый
          классификационный справочник. Нормы не создаются, пока область не настроена.
        </p>
        <div className="vse-catalog-actions">
          <Button type="button" variant="secondary" onClick={() => void navigate("/catalogs")}>
            Вернуться
          </Button>
          <Button type="button" variant="primary" onClick={() => void methodsContext.refetch()}>
            Проверить снова
          </Button>
        </div>
      </CatalogEditorPage>
    );
  }

  const species = data.product_species ?? null;
  const state = data.product_state ?? null;

  // A species without a single observed product state cannot be configured
  // honestly: no state id is invented (ТЗ-DR28 §5.3/§11).
  if (species === null || (species !== null && data.states.length === 0)) {
    return (
      <CatalogEditorPage
        title="Нормы исследований"
        description="Диапазоны используются для автоматической отметки нормы и отклонений в карточке ВСЭ."
      >
        <ScopeSelectors
          areas={data.areas.map((item) => ({ code: item.code, name: item.name }))}
          areaCode={area.code}
          speciesOptions={data.species_options.map((item) => ({ id: item.id, label: item.label }))}
          species={species?.id ?? null}
          states={[]}
          state={null}
          onArea={(code) => updateParams({ area: code, species: null, state: null })}
          onSpecies={(id) => updateParams({ species: id, state: null })}
          onState={() => undefined}
        />
        <StatusView
          state="no-scope"
          title="Состояние продукции для выбранного вида ещё не определено."
          detail="Состояние заполняется из классификации реальных партий этой лаборатории. Обратитесь к администратору, если область назначена."
        />
        <div className="vse-catalog-actions">
          <Button type="button" variant="secondary" onClick={() => void navigate("/catalogs")}>
            Вернуться
          </Button>
          <Button type="button" variant="primary" onClick={() => void methodsContext.refetch()}>
            Проверить снова
          </Button>
        </div>
      </CatalogEditorPage>
    );
  }

  if (state === null) {
    return (
      <CatalogEditorPage
        title="Нормы исследований"
        description="Диапазоны используются для автоматической отметки нормы и отклонений в карточке ВСЭ."
      >
        <ScopeSelectors
          areas={data.areas.map((item) => ({ code: item.code, name: item.name }))}
          areaCode={area.code}
          speciesOptions={data.species_options.map((item) => ({ id: item.id, label: item.label }))}
          species={species?.id ?? null}
          states={data.states.map((item) => ({ id: item.id, label: item.label }))}
          state={null}
          onArea={(code) => updateParams({ area: code, species: null, state: null })}
          onSpecies={(id) => updateParams({ species: id, state: null })}
          onState={(id) => updateParams({ state: id })}
        />
        <StatusView state="empty" title="Выберите состояние продукции, чтобы открыть нормы." />
      </CatalogEditorPage>
    );
  }

  const blocks = model === null ? [] : model.blocks;
  const unknownRules = model === null ? [] : model.unknownRules;

  return (
    <CatalogEditorPage
      title="Нормы исследований"
      description="Диапазоны используются для автоматической отметки нормы и отклонений в карточке ВСЭ."
    >
      <CatalogContextSlot context={context} onPick={allowedToSwitch ? pickLaboratory : null} />
      <ScopeSelectors
        areas={data.areas.map((item) => ({ code: item.code, name: item.name }))}
        areaCode={area.code}
        speciesOptions={data.species_options.map((item) => ({ id: item.id, label: item.label }))}
        species={species.id}
        states={data.states.map((item) => ({ id: item.id, label: item.label }))}
        state={state.id}
        onArea={(code) => updateParams({ area: code, species: null, state: null })}
        onSpecies={(id) => updateParams({ species: id, state: null })}
        onState={(id) => updateParams({ state: id })}
      />
      {summary !== null ? (
        <SaveSummary state={summary.state} text={summary.text} details={summary.details} />
      ) : null}
      <section className="vse-catalog-section" aria-labelledby="methods-section-title">
        <CatalogSectionHeader
          icon="directory-norms"
          title="Диапазоны нормы"
          description="Укажите нижнюю и верхнюю границу для исследований с вводом показателей."
          actions={
            canEdit ? (
              <Button
                type="button"
                variant="primary"
                disabled={savePending}
                onClick={() => setCreateTarget(null)}
              >
                Добавить норму
              </Button>
            ) : undefined
          }
        />
        {methodsContext.isRefetching ? null : null}
        <div className="vse-catalog-norm-list">
          {blocks.map((block) => {
            if (!block.configured) {
              return (
                <article
                  className="vse-catalog-norm-row"
                  key={block.indicator.id}
                  data-testid="method-missing"
                >
                  <div className="vse-catalog-norm-info">
                    <div className="vse-catalog-norm-name">
                      {block.indicator.code} · {block.indicator.name}
                      {block.indicator.mandatory ? (
                        <span className="vse-catalog-req" aria-label="обязательный показатель">
                          {" "}
                          *
                        </span>
                      ) : null}
                    </div>
                    <div className="vse-catalog-norm-meta">
                      {block.indicator.unit_id !== null ? `Единица: ${block.indicator.unit_id}. ` : ""}
                      Не настроено
                    </div>
                  </div>
                  <div className="vse-catalog-field">
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={savePending}
                        onClick={() => setCreateTarget(block.indicator.id)}
                      >
                        Настроить
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            }
            return block.rules.map((row) => renderRuleRow(row));
          })}
          {unknownRules.map((row) => (
            <article className="vse-catalog-diag" key={row.key} data-testid={`method-diag-${row.key}`}>
              Норма показателя вне общего каталога. Идентификатор: <code>{row.indicatorId}</code>.
              Наименование недоступно в read model — значение не редактируется на этой странице.
            </article>
          ))}
        </div>
      </section>
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

      {createTarget !== null && state !== null && species !== null ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCreateTarget(null);
          }}
          title="Добавить норму"
          description={`Показатель и границы нормы для области «${area.name}».`}
          cancelLabel="Закрыть"
          confirmLabel="Готово"
        >
          <MethodEditor
            mode="create"
            laboratoryId={laboratoryId}
            productSpeciesId={species.id}
            productStateId={state.id}
            indicators={data.indicators}
            presetIndicatorId={createTarget === "" ? null : createTarget}
            busy={savePending}
            onSaved={(rule) => {
              setCreateTarget(null);
              setSummary({
                state: "success",
                text: "Норма добавлена.",
                details: [],
              });
              void methodsContext.refetch();
              return rule;
            }}
            onClose={() => setCreateTarget(null)}
          />
        </Dialog>
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

  /** One editable rule row of the configured indicator block; rendered by a
   * direct call (never an inline component type) so a re-render never
   * remounts the inputs mid-typing. */
  function renderRuleRow(row: RowModel): React.ReactElement {
    const draft = draftFor(row);
    const interval = row.rule.rule;
    const definition = data.indicators.find((item) => item.id === row.indicatorId);
    if (row.unknown) {
      return (
        <article className="vse-catalog-diag" key={row.key}>
          Норма показателя вне общего каталога. Идентификатор: <code>{row.indicatorId}</code>.
        </article>
      );
    }
    if (row.kind === "qualitative") {
      const options = definition?.options ?? [];
      const normSet = new Set(draft.accepted);
      const rowsModel: QualitativeRow[] = [
        ...options.map((option) => ({
          key: option,
          value: option,
          norm: normSet.has(option),
          onNormChange: (norm: boolean) =>
            setDrafts((current) => {
              const accepted = norm
                ? [...draft.accepted, option]
                : draft.accepted.filter((value) => value !== option);
              return { ...current, [row.key]: { ...draftFor(row), accepted } };
            }),
          onRemove: undefined,
        })),
        ...draft.extra
          .filter((value) => !options.some((option) => option === value))
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
          title={`${definition?.code ?? ""} · ${row.name}`}
          description="Укажите варианты результата и отметьте, считается ли вариант нормой."
          rows={rowsModel}
          readOnly={!canEdit}
          busy={savePending}
          error={errors[row.key]}
          secondary={
            canEdit ? (
              <Button
                type="button"
                variant="secondary"
                disabled={savePending}
                aria-label={`Удалить норму: ${row.name}`}
                onClick={() => setDeleteTarget({ key: row.key, rule: row.rule })}
              >
                Удалить норму
              </Button>
            ) : undefined
          }
        />
      );
    }
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
        name={`${definition?.code ?? ""} · ${row.name}`}
        meta={row.meta}
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
              onClick={() => setDeleteTarget({ key: row.key, rule: row.rule })}
            >
              Удалить норму
            </Button>
          ) : undefined
        }
        onLowerChange={(next) => {
          setDrafts((current) => ({ ...current, [row.key]: { ...draftFor(row), lower: next } }));
          setSummary(null);
        }}
        onUpperChange={(next) => {
          setDrafts((current) => ({ ...current, [row.key]: { ...draftFor(row), upper: next } }));
          setSummary(null);
        }}
      />
    );
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
    await methodsContext.refetch();
  }

  function pickLaboratory(id: string): void {
    const search = new URLSearchParams(location.search);
    search.set("laboratory_id", id);
    navigate(`/catalogs?${search.toString()}`);
  }
}

/* --- Human-readable scope selectors (ТЗ-DR28 §5.2/§5.3) ------------------- */

export interface ScopeSelectorsProps {
  areas: { code: string; name: string }[];
  areaCode: string;
  speciesOptions: { id: string; label: string }[];
  species: string | null;
  states: { id: string; label: string }[];
  state: string | null;
  onArea: (code: string) => void;
  onSpecies: (id: string) => void;
  onState: (id: string) => void;
}

/** The «Вид продукции» block with ordinary Russian names only; UUIDs are
 * never shown as labels (ТЗ-DR28 §5.2). */
export function ScopeSelectors({
  areas,
  areaCode,
  speciesOptions,
  species,
  states,
  state,
  onArea,
  onSpecies,
  onState,
}: ScopeSelectorsProps): React.ReactElement {
  return (
    <div className="vse-catalog-context" data-testid="catalog-scope">
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="scope-area">Вид продукции</label>
        </div>
        <select id="scope-area" value={areaCode} onChange={(event) => onArea(event.target.value)}>
          {areas.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      {speciesOptions.length > 1 ? (
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="scope-species">Вид</label>
          </div>
          <select
            id="scope-species"
            value={species ?? ""}
            onChange={(event) => onSpecies(event.target.value)}
          >
            {speciesOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {states.length > 1 ? (
        <div className="app-field">
          <div className="app-field-heading">
            <label htmlFor="scope-state">Состояние продукции</label>
          </div>
          <select id="scope-state" value={state ?? ""} onChange={(event) => onState(event.target.value)}>
            {states.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

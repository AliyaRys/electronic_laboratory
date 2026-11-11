/**
 * «Нормы исследований» editor page (ТЗ-DR6 §11, mockup
 * directory-norms-edit.html).
 *
 * Interval MethodRules render as [name/meta] [Норма от + unit] [Норма до +
 * unit]; qualitative rules render as the «Проба варки» composition with the
 * variants coming from the SHARED INDICATORS registry (no second copy of the
 * dictionary). A null boundary stays null (never 0); lower ≤ upper is
 * enforced; inclusivity stays in the folded business settings while
 * version/source/effective date remain hidden and are never lost on save. One
 * «Сохранить справочник» saves ONLY the dirty rules sequentially with honest
 * per-rule results and 409 revision resolution.
 */
import { useQuery } from "@tanstack/react-query";
import "./catalogs.css";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { INDICATORS } from "../examinations/indicators";
import { Button } from "../../shared/ui/Button";
import { StatusView } from "../../shared/ui/StatusView";
import { Dialog } from "../../shared/ui/Dialog";
import { deleteMethod, fetchMethods, updateMethod, type MethodRuleTyped, type Problem } from "./api";
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
import { DELETE_WARNING } from "./MethodEditor";

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

function indicatorName(indicatorId: string): string | null {
  return INDICATORS.find((indicator) => indicator.id === indicatorId)?.name ?? null;
}

export function buildMethodRows(rules: MethodRuleTyped[]): RowModel[] {
  const counter = new Map<string, number>();
  return rules.map((rule) => {
    const name = indicatorName(rule.indicator_id);
    counter.set(rule.indicator_id, (counter.get(rule.indicator_id) ?? 0) + 1);
    const ordinal = counter.get(rule.indicator_id) ?? 1;
    const qualitative = rule.rule.type === "qualitative";
    return {
      key: rule.id,
      rule,
      indicatorId: rule.indicator_id,
      name: name ?? "",
      meta: ordinal > 1 ? `Ещё одно правило по этому показателю (${ordinal})` : undefined,
      unit: rule.unit_id === "" ? undefined : rule.unit_id,
      kind: qualitative ? "qualitative" : "interval",
      unknown: name === null,
    };
  });
}

export function MethodsEditorPage(): React.ReactElement {
  const context = useCatalogContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { laboratoryId, productSpeciesId, canEdit, allowedToSwitch } = context;
  const scoped = laboratoryId !== null && productSpeciesId !== null;

  const methods = useQuery({
    queryKey: [laboratoryId, productSpeciesId, null, "/catalogs/methods", "methods"],
    queryFn: ({ signal }) => fetchMethods(laboratoryId ?? "", productSpeciesId ?? "", 1, signal),
    enabled: scoped,
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

  const rows = useMemo(() => {
    const list = methods.data !== undefined && !("code" in methods.data) ? methods.data.items : [];
    return buildMethodRows(list);
  }, [methods.data]);

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
    if (laboratoryId === null || productSpeciesId === null) return;
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
      await methods.refetch();
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
      await methods.refetch();
      return;
    }
    clearConflict(row.key);
    await methods.refetch();
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

  const problem = methods.data !== undefined && "code" in methods.data ? (methods.data as Problem) : null;

  const intervalRows = rows.filter((row) => row.kind === "interval");
  const qualitativeRows = rows.filter((row) => row.kind === "qualitative");

  return (
    <CatalogEditorPage
      title="Нормы исследований"
      description="Диапазоны используются для автоматической отметки нормы и отклонений в карточке ВСЭ."
    >
      <CatalogContextSlot context={context} onPick={allowedToSwitch ? pickLaboratory : null} />
      {summary !== null ? (
        <SaveSummary state={summary.state} text={summary.text} details={summary.details} />
      ) : null}
      {scoped ? (
        <section className="vse-catalog-section" aria-labelledby="methods-section-title">
          <CatalogSectionHeader
            icon="directory-norms"
            title="Диапазоны нормы"
            description="Укажите нижнюю и верхнюю границу для исследований с вводом показателей."
          />
          {methods.isLoading ? (
            <StatusView state="loading" title="Загрузка норм…" />
          ) : problem !== null ? (
            <StatusView
              state={problem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
              title={problem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить нормы."}
              detail={problem.detail}
              onRetry={() => void methods.refetch()}
            />
          ) : rows.length === 0 ? (
            <StatusView state="empty" title="Нормы для этой области не заданы." />
          ) : (
            <div className="vse-catalog-norm-list">
              {intervalRows.map((row) => {
                const draft = draftFor(row);
                const interval = row.rule.rule;
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
                if (row.unknown) {
                  return (
                    <article
                      className="vse-catalog-diag"
                      key={row.key}
                      data-testid={`method-diag-${row.key}`}
                    >
                      Норма показателя вне общего каталога. Идентификатор: <code>{row.indicatorId}</code>.
                      Наименование недоступно в read model — значение не редактируется на этой странице.
                    </article>
                  );
                }
                return (
                  <NormRow
                    key={row.key}
                    name={row.name}
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
              })}
              {qualitativeRows.map((row) => {
                const draft = draftFor(row);
                const indicator = INDICATORS.find((item) => item.id === row.indicatorId);
                const registryOptions = indicator?.options ?? [];
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
                    title={row.unknown ? "Показатель вне общего каталога" : row.name}
                    description={
                      indicator?.kind === "ENUM"
                        ? "Укажите варианты результата и отметьте, считается ли вариант нормой."
                        : undefined
                    }
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
                          aria-label={`Удалить норму: ${row.unknown ? "вне каталога" : row.name}`}
                          onClick={() => setDeleteTarget({ key: row.key, rule: row.rule })}
                        >
                          Удалить норму
                        </Button>
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </section>
      ) : null}
      {!scoped ? <StatusView state="empty" title="Выберите лабораторию, чтобы открыть справочник." /> : null}
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

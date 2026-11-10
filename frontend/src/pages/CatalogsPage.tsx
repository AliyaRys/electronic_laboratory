/**
 * Catalogs page (Task C02, FT-CAL-05/06/07, ui-mapping: catalogs → /catalogs).
 *
 * The scope (laboratory + product species) lives in the URL; the tabs map to
 * the three editors; readiness reports the missing real configuration inputs;
 * the bulk price command is offered to ADMIN/ANALYST only (permissions.md:
 * catalog:bulk-price/retry). Every state — forbidden, empty, network error —
 * is honest.
 */
import "../features/catalogs/catalogs.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { fetchContexts } from "../features/identity/api";
import { useMe } from "../shared/api/me";
import { Button } from "../shared/ui/Button";
import { Dialog } from "../shared/ui/Dialog";
import { Icon, type IconName } from "../shared/ui/Icon";
import { StatusView } from "../shared/ui/StatusView";
import {
  fetchCheckServices,
  fetchMethods,
  fetchReadiness,
  fetchTariffs,
  type CheckServiceRuleView,
  type Problem,
  type TariffView,
} from "../features/catalogs/api";
import { MethodEditor } from "../features/catalogs/MethodEditor";
import { TariffEditor } from "../features/catalogs/TariffEditor";
import { CheckServiceEditor } from "../features/catalogs/CheckServiceEditor";
import { BulkPriceDialog } from "../features/catalogs/BulkPriceDialog";
import { shortId } from "../features/catalogs/common";
import type { MethodRuleTyped } from "../features/catalogs/api";

const TABS = [
  { id: "methods", label: "Нормы исследований" },
  { id: "tariffs", label: "Стоимость исследований" },
  { id: "check-services", label: "Услуги сверки" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Overview cards (directories.html composition, spec DR4 §7.2): the mockup
 * order «Стоимость исследований ВСЭ» → «Платные услуги» → «Нормы исследований».
 * Descriptions are static UI text from the approved mockup; every value and
 * status keeps coming from the real model. No fake delete actions: only the
 * existing editors are offered.
 */
const OVERVIEW: readonly {
  tab: TabId;
  name: string;
  description: string;
  icon?: IconName;
  glyph?: string;
}[] = [
  {
    tab: "tariffs",
    name: "Стоимость исследований ВСЭ",
    description: "Используется для автоматического расчёта стоимости услуг",
    glyph: "₽",
  },
  {
    tab: "check-services",
    name: "Платные услуги",
    description: "Стоимость услуг сверки данных для мясной и молочной продукции",
    icon: "directory-paid-services",
  },
  {
    tab: "methods",
    name: "Нормы исследований",
    description: "Используется для автоматической отметки «норма» и отклонений в результатах ВСЭ",
    glyph: "≋",
  },
];

/**
 * The tab comes from the deep link path (/catalogs/methods, /catalogs/tariffs)
 * first, then from ?tab=; a missing or unknown tab is the safe overview state
 * — never a fetch with empty or foreign identifiers (spec DR4 §7.2).
 */
function tabFromRoute(pathname: string, value: string | null): TabId | null {
  if (pathname.endsWith("/methods")) return "methods";
  if (pathname.endsWith("/tariffs")) return "tariffs";
  return TABS.some((tab) => tab.id === value) ? (value as TabId) : null;
}

export function CatalogsPage(): React.ReactElement {
  return (
    <RequireSession>
      <CatalogsContent />
    </RequireSession>
  );
}

interface EditorState {
  kind: "method" | "tariff" | "check" | "bulk";
  mode: "create" | "edit";
  method?: MethodRuleTyped | null;
  tariff?: TariffView | null;
  check?: CheckServiceRuleView | null;
}

function CatalogsContent(): React.ReactElement {
  const { user: me } = useMe();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const laboratoryId = params.get("laboratory_id") ?? "";
  const speciesId = params.get("product_species_id") ?? "";
  const tab = tabFromRoute(location.pathname, params.get("tab"));
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [done, setDone] = useState("");

  const canEdit = me !== null && ["HEAD", "ADMIN", "ANALYST"].includes(me.role);
  const canBulk = me !== null && ["ADMIN", "ANALYST"].includes(me.role);

  const contexts = useQuery({
    queryKey: [null, null, null, "/contexts", null],
    queryFn: ({ signal }) => fetchContexts(signal),
  });

  const scoped = laboratoryId !== "" && speciesId !== "";
  const contextScopes =
    contexts.data !== undefined && contexts.data !== null && !("code" in contexts.data) ? contexts.data : [];
  const methods = useQuery({
    queryKey: [laboratoryId, speciesId, null, "/catalogs/methods", tab],
    queryFn: ({ signal }) => fetchMethods(laboratoryId, speciesId, 1, signal),
    enabled: scoped && tab === "methods",
  });
  const tariffs = useQuery({
    queryKey: [laboratoryId, speciesId, null, "/catalogs/tariffs", tab],
    queryFn: ({ signal }) => fetchTariffs(laboratoryId, speciesId, 1, signal),
    enabled: scoped && tab === "tariffs",
  });
  const checks = useQuery({
    queryKey: [laboratoryId, speciesId, null, "/catalogs/check-services", tab],
    queryFn: ({ signal }) => fetchCheckServices(1, signal),
    enabled: tab === "check-services",
  });
  const readiness = useQuery({
    queryKey: [laboratoryId, speciesId, null, "/catalogs/readiness", null],
    queryFn: ({ signal }) => fetchReadiness(laboratoryId, speciesId, signal),
    enabled: scoped && tab === "methods",
  });

  const setScope = (next: { laboratory_id?: string; product_species_id?: string }): void => {
    const search = new URLSearchParams(params);
    if (next.laboratory_id !== undefined) search.set("laboratory_id", next.laboratory_id);
    if (next.product_species_id !== undefined) search.set("product_species_id", next.product_species_id);
    setParams(search);
  };

  /** The editor transition keeps laboratory_id/product_species_id in the query. */
  const openTab = (id: TabId): void => {
    const search = new URLSearchParams(params);
    search.set("tab", id);
    setParams(search);
  };

  const refresh = async (): Promise<void> => {
    // The list/readiness keys are [lab, species, null, "/catalogs/…", tab];
    // the scope prefix matches them all (and not the contexts query).
    await queryClient.invalidateQueries({ queryKey: [laboratoryId, speciesId, null] });
  };

  const labOptions = Array.from(
    new Set(
      contextScopes
        .filter((scope) => scope.laboratory_id != null)
        .map((scope) => scope.laboratory_id as string),
    ),
  ).map((id) => ({ id, name: `Лаборатория ${shortId(id)}` }));

  const isProblem = (data: unknown): data is Problem =>
    typeof data === "object" && data !== null && "code" in data;

  const methodsPage = methods.data !== undefined && !("code" in methods.data) ? methods.data : null;
  const tariffsPage = tariffs.data !== undefined && !("code" in tariffs.data) ? tariffs.data : null;
  const checksPage = checks.data !== undefined && !("code" in checks.data) ? checks.data : null;
  const readinessData = readiness.data !== undefined && !("code" in readiness.data) ? readiness.data : null;
  const methodsProblem = isProblem(methods.data) ? (methods.data as Problem) : null;
  const tariffsProblem = isProblem(tariffs.data) ? (tariffs.data as Problem) : null;
  const checksProblem = isProblem(checks.data) ? (checks.data as Problem) : null;

  const bulkLabOptions =
    me !== null && me.role === "ADMIN"
      ? // ADMIN's administrative coverage comes from the delegation contexts.
        labOptions
      : labOptions;

  return (
    <div className="vse-app vse-page vse-catalog-page">
      <div className="vse-catalog-header">
        <p className="vse-catalog-eyebrow">Справочники</p>
        <h1>{tab === null ? "Управление справочниками" : "Справочники"}</h1>
      </div>

      {me !== null && !canEdit ? (
        <StatusView state="forbidden" detail="Раздел доступен заведующему, администратору и аналитику." />
      ) : tab === null ? (
        <section
          className="vse-catalog-section"
          aria-labelledby="catalog-overview-title"
          data-testid="catalog-overview"
        >
          <div className="vse-catalog-section-head">
            <div className="vse-catalog-section-title">
              <span className="vse-catalog-section-icon" aria-hidden="true">
                <Icon name="directories-classic" />
              </span>
              <div>
                <h2 id="catalog-overview-title">Список справочников</h2>
                <p>Настройки, которые используются при заполнении электронного журнала.</p>
              </div>
            </div>
          </div>
          <div className="vse-catalog-list">
            {OVERVIEW.map((card) => (
              <article className="vse-catalog-item" key={card.tab} data-testid={`catalog-card-${card.tab}`}>
                <div className="vse-catalog-item-main">
                  <span className="vse-catalog-item-icon" aria-hidden="true">
                    {card.icon !== undefined ? <Icon name={card.icon} /> : card.glyph}
                  </span>
                  <div>
                    <div className="vse-catalog-item-name">{card.name}</div>
                    <div className="vse-catalog-item-meta">{card.description}</div>
                  </div>
                </div>
                <div className="vse-catalog-item-actions">
                  <Button type="button" variant="secondary" onClick={() => openTab(card.tab)}>
                    Редактировать
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <>
          <div className="vse-catalog-tabs" role="list" aria-label="Разделы справочников">
            {TABS.map((item) => (
              <a
                key={item.id}
                href={`/catalogs?tab=${item.id}`}
                className={item.id === tab ? "active" : ""}
                aria-current={item.id === tab ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  openTab(item.id);
                }}
              >
                {item.label}
              </a>
            ))}
          </div>
          {tab !== "check-services" ? (
            <form className="vse-catalog-toolbar" onSubmit={(event) => event.preventDefault()}>
              <div className="app-field">
                <div className="app-field-heading">
                  <label htmlFor="catalog-lab">Лаборатория</label>
                </div>
                <select
                  id="catalog-lab"
                  value={laboratoryId}
                  onChange={(event) => setScope({ laboratory_id: event.target.value })}
                >
                  <option value="">— выберите лабораторию —</option>
                  {labOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="app-field">
                <div className="app-field-heading">
                  <label htmlFor="catalog-species">Вид продукции (UUID)</label>
                </div>
                <input
                  id="catalog-species"
                  type="text"
                  value={speciesId}
                  onChange={(event) => setScope({ product_species_id: event.target.value })}
                />
              </div>
            </form>
          ) : null}
          {done !== "" ? (
            <div className="auth-success" role="status">
              {done}
            </div>
          ) : null}
          {readinessData !== null && readinessData.missing.length > 0 ? (
            <div className="vse-catalog-missing" data-testid="catalog-readiness">
              <strong>Раздел не готов к расчёту:</strong>
              <ul>
                {readinessData.missing.map((item) => (
                  <li key={item.input_id}>{item.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {tab === "methods" && scoped ? (
            <>
              <div className="vse-admin-controls" style={{ marginBottom: 12 }}>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setEditor({ kind: "method", mode: "create" })}
                  disabled={!canEdit}
                >
                  Добавить норму
                </Button>
                {canBulk ? (
                  <Button type="button" onClick={() => setEditor({ kind: "bulk", mode: "create" })}>
                    Массовая цена
                  </Button>
                ) : null}
              </div>
              {methods.isLoading ? (
                <StatusView state="loading" title="Загрузка норм…" />
              ) : methodsProblem !== null ? (
                <StatusView
                  state={methodsProblem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
                  title={methodsProblem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить нормы."}
                  detail={methodsProblem.detail}
                  onRetry={() => void methods.refetch()}
                />
              ) : (methodsPage?.items.length ?? 0) === 0 ? (
                <StatusView state="empty" title="Нормы для этой области не заданы." />
              ) : (
                <table className="vse-table">
                  <thead>
                    <tr>
                      <th>Показатель</th>
                      <th>Тип результата</th>
                      <th>Единица</th>
                      <th>Версия</th>
                      <th>Активна</th>
                      <th aria-label="Действия" />
                    </tr>
                  </thead>
                  <tbody>
                    {(methodsPage?.items ?? []).map((rule) => (
                      <tr key={rule.id}>
                        <td>{shortId(rule.indicator_id)}</td>
                        <td>{rule.result_schema}</td>
                        <td>{rule.unit_id}</td>
                        <td>{rule.version}</td>
                        <td>{rule.active ? "да" : "нет"}</td>
                        <td>
                          <Button
                            type="button"
                            onClick={() => setEditor({ kind: "method", mode: "edit", method: rule })}
                            disabled={!canEdit}
                          >
                            Изменить
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : null}
          {tab === "tariffs" && scoped ? (
            <>
              <div className="vse-admin-controls" style={{ marginBottom: 12 }}>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setEditor({ kind: "tariff", mode: "create" })}
                  disabled={!canEdit}
                >
                  Добавить тариф
                </Button>
                {canBulk ? (
                  <Button type="button" onClick={() => setEditor({ kind: "bulk", mode: "create" })}>
                    Массовая цена
                  </Button>
                ) : null}
              </div>
              {tariffs.isLoading ? (
                <StatusView state="loading" title="Загрузка тарифов…" />
              ) : tariffsProblem !== null ? (
                <StatusView
                  state={tariffsProblem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
                  title={tariffsProblem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить тарифы."}
                  detail={tariffsProblem.detail}
                  onRetry={() => void tariffs.refetch()}
                />
              ) : (tariffsPage?.items.length ?? 0) === 0 ? (
                <StatusView state="empty" title="Тарифы для этой области не заданы." />
              ) : (
                <table className="vse-table">
                  <thead>
                    <tr>
                      <th>Код услуги</th>
                      <th>Единица</th>
                      <th>Цена, ₽</th>
                      <th>Версия</th>
                      <th aria-label="Действия" />
                    </tr>
                  </thead>
                  <tbody>
                    {(tariffsPage?.items ?? []).map((tariff) => (
                      <tr key={tariff.id}>
                        <td>{tariff.service_code}</td>
                        <td>{tariff.unit_id}</td>
                        <td>{tariff.price}</td>
                        <td>{tariff.version}</td>
                        <td>
                          <Button
                            type="button"
                            onClick={() => setEditor({ kind: "tariff", mode: "edit", tariff })}
                            disabled={!canEdit}
                          >
                            Изменить
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : null}
          {tab === "check-services" ? (
            <>
              <div className="vse-admin-controls" style={{ marginBottom: 12 }}>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setEditor({ kind: "check", mode: "create" })}
                  disabled={!canEdit}
                >
                  Добавить правило
                </Button>
              </div>
              {checks.isLoading ? (
                <StatusView state="loading" title="Загрузка правил услуг сверки…" />
              ) : checksProblem !== null ? (
                <StatusView
                  state={checksProblem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
                  title={checksProblem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить правила."}
                  detail={checksProblem.detail}
                  onRetry={() => void checks.refetch()}
                />
              ) : (checksPage?.items.length ?? 0) === 0 ? (
                <StatusView state="empty" title="Правила услуг сверки не заданы." />
              ) : (
                <table className="vse-table">
                  <thead>
                    <tr>
                      <th>Услуга</th>
                      <th>База начисления</th>
                      <th>Решения</th>
                      <th>Единица</th>
                      <th>Версия</th>
                      <th aria-label="Действия" />
                    </tr>
                  </thead>
                  <tbody>
                    {(checksPage?.items ?? []).map((rule) => (
                      <tr key={rule.id}>
                        <td>{rule.service_code}</td>
                        <td>{rule.multiplier_basis}</td>
                        <td>{rule.applicable_decisions.join(", ")}</td>
                        <td>{rule.unit_id}</td>
                        <td>{rule.version}</td>
                        <td>
                          <Button
                            type="button"
                            onClick={() => setEditor({ kind: "check", mode: "edit", check: rule })}
                            disabled={!canEdit}
                          >
                            Изменить
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : null}
          {!scoped && tab !== null && tab !== "check-services" ? (
            <StatusView state="empty" title="Выберите лабораторию и вид продукции." />
          ) : null}{" "}
        </>
      )}

      {editor?.kind === "method" ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          title={editor.mode === "create" ? "Новая норма исследования" : "Изменение нормы исследования"}
          description={
            editor.mode === "edit"
              ? "Правка фиксируется по ревизии записи (If-Match)."
              : "Норма принадлежит выбранной области: лаборатория, вид и состояние продукции."
          }
          cancelLabel="Закрыть"
          confirmLabel="Готово"
        >
          <MethodEditor
            mode={editor.mode}
            laboratoryId={laboratoryId}
            productSpeciesId={speciesId}
            rule={editor.method ?? null}
            onSaved={() => {
              setDone("Норма сохранена.");
              void refresh();
            }}
            onDeleted={() => {
              setDone("Норма удалена. Старый снимок цен остался прежним.");
              void refresh();
            }}
            onClose={() => setEditor(null)}
          />
        </Dialog>
      ) : null}

      {editor?.kind === "tariff" ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          title={editor.mode === "create" ? "Новый тариф" : "Изменение тарифа"}
          description="Цена принадлежит области: лаборатория, вид продукции, код услуги и единица."
          cancelLabel="Закрыть"
          confirmLabel="Готово"
        >
          <TariffEditor
            mode={editor.mode}
            laboratoryId={laboratoryId}
            productSpeciesId={speciesId}
            tariff={editor.tariff ?? null}
            onSaved={() => {
              setDone("Тариф сохранён.");
              void refresh();
            }}
            onDeleted={() => {
              setDone("Тариф удалён.");
              void refresh();
            }}
            onClose={() => setEditor(null)}
          />
        </Dialog>
      ) : null}

      {editor?.kind === "check" ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          title={editor.mode === "create" ? "Новое правило услуги сверки" : "Изменение правила услуги сверки"}
          description="Глобальное правило двух услуг сверки; с расчётом ВСЭ оно не смешивается."
          cancelLabel="Закрыть"
          confirmLabel="Готово"
        >
          <CheckServiceEditor
            mode={editor.mode}
            rule={editor.check ?? null}
            onSaved={() => {
              setDone("Правило сохранено.");
              void refresh();
            }}
            onClose={() => setEditor(null)}
          />
        </Dialog>
      ) : null}

      {editor?.kind === "bulk" ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          title="Массовая цена"
          description="Одна команда на весь охват: охват проверяется до записи, каждая лаборатория применяется в своей транзакции."
          cancelLabel="Закрыть"
          confirmLabel="Готово"
        >
          <BulkPriceDialog
            laboratories={bulkLabOptions}
            productSpeciesId={speciesId}
            onClose={() => {
              setEditor(null);
              void refresh();
            }}
            onApplied={() => void refresh()}
          />
        </Dialog>
      ) : null}
    </div>
  );
}

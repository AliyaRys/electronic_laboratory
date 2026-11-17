/**
 * «Стоимость исследований ВСЭ» editor page (ТЗ-DR6 §9, ТЗ DR42 §2/§3 Вариант A,
 * mockup directory-price-edit.html).
 *
 * The context is the same DR31 laboratory + meat-area scope as the norm
 * catalog: the tariffs stay scoped by the concrete Mercury species, the user
 * selects it by its human name (the GUID is an internal API field) and the
 * POST/PUT scope is exactly the scope PricingRequest uses for the card. The
 * legacy rows whose product_species_id holds a laboratory UUID are shown as
 * the «требует миграции» diagnostics — never edited, copied or deleted
 * silently, and never treated as a valid scope by pricing.
 *
 * Cards are built from the SHARED INDICATORS registry (VSE-F18–29) joined
 * with the real tariffs of the chosen species scope; the CHECK service codes
 * are filtered out by exact service_code and shown on the «Платные услуги»
 * page instead. A missing price stays an empty field with «Не настроено»; an
 * explicit 0,00 stays a valid price; DecimalString never passes through a
 * float. One «Сохранить справочник» saves ONLY the dirty cards sequentially.
 * A partial failure keeps the failed cards dirty with a per-card message and
 * retry re-sends only those.
 */
import { useQuery } from "@tanstack/react-query";
import "./catalogs.css";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { INDICATORS } from "../examinations/indicators";
import { Button } from "../../shared/ui/Button";
import { StatusView } from "../../shared/ui/StatusView";
import { Dialog } from "../../shared/ui/Dialog";
import { SelectDropdown } from "../../shared/ui/SelectDropdown";
import {
  createTariff,
  deleteTariff,
  fetchTariffs,
  fetchTariffsContext,
  updateTariff,
  type Problem,
  type TariffView,
} from "./api";
import { BulkPriceDialog } from "./BulkPriceDialog";
import { CatalogEditorPage, CatalogSectionHeader, PriceCard, SaveSummary } from "./editor-parts";
import { CatalogContextSlot } from "./catalog-context-slot";
import { useCatalogContext } from "./use-catalog-context";
import { useDirtyGuard } from "../context/SwitchContext";
import { MONEY } from "./common";

const MANUAL_CATALOG_SOURCE = { name: "Ручная настройка справочника" } as const;
const TARIFF_CURRENCY = "RUB";

/** The two CHECK service codes: owned by the «Платные услуги» page (§10.3). */
export const CHECK_SERVICE_CODES: ReadonlySet<string> = new Set([
  "PRODUCT_IDENTIFICATION",
  "TRANSPORT_INSPECTION",
]);

/** Accept the user's comma/dot input, return the DecimalString wire form. */
export function normalizeMoneyInput(value: string): string {
  return value.trim().replace(/,/g, ".");
}

export const MONEY_MESSAGE =
  "Цена — конечное число с точкой или запятой, не более 2 знаков, не отрицательная.";

interface CardMeta {
  /** The tariff record behind the card, or null when not yet configured. */
  tariff: TariffView | null;
  serviceCode: string;
  name: string;
  unit: string;
  mandatory: boolean;
  /** Unknown to the shared registry: honest diagnostic, no invented name. */
  unknown: boolean;
}

export function buildTariffCards(tariffs: TariffView[]): CardMeta[] {
  const list: CardMeta[] = INDICATORS.map((indicator) => ({
    tariff: tariffs.find((tariff) => tariff.service_code === indicator.id) ?? null,
    serviceCode: indicator.id,
    name: indicator.name,
    unit: indicator.unit ?? "",
    mandatory: indicator.mandatory,
    unknown: false,
  }));
  // Honest diagnostics: tariffs outside the shared registry. The CHECK codes
  // of these scopes are intentionally NOT here: the «Платные услуги» page
  // owns them (exact service codes, §10.3).
  const known = new Set(INDICATORS.map((indicator) => indicator.id));
  for (const tariff of tariffs) {
    if (known.has(tariff.service_code) || CHECK_SERVICE_CODES.has(tariff.service_code)) continue;
    list.push({
      tariff,
      serviceCode: tariff.service_code,
      name: "",
      unit: tariff.unit_id,
      mandatory: false,
      unknown: true,
    });
  }
  return list;
}

export type SaveSummaryState = { state: "success" | "partial" | "error"; text: string; details: string[] };

export function TariffsEditorPage(): React.ReactElement {
  const context = useCatalogContext();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const { laboratoryId, canEdit, canBulk, allowedToSwitch } = context;
  const scoped = laboratoryId !== null;

  // ТЗ DR42 §3: the tariff editor context carries the species options by
  // human name and the legacy mis-scoped rows; the page context has no
  // species selector of its own any more (the DR31 laboratory scope).
  const tariffsContext = useQuery({
    queryKey: [laboratoryId, null, null, "/catalogs/tariffs/context", "tariffs-context"],
    queryFn: ({ signal }) => fetchTariffsContext(laboratoryId ?? "", signal),
    enabled: scoped,
  });
  const tariffContextData =
    tariffsContext.data !== undefined && !("code" in tariffsContext.data) ? tariffsContext.data : null;

  // The species scope: the URL value first, then the laboratory's assigned
  // product scope (only when it is a real species, never the legacy
  // laboratory-id fallback). Nothing is invented.
  const assignedSpecies =
    context.productSpeciesValid && context.productSpeciesId !== null ? context.productSpeciesId : null;
  const speciesId = params.get("product_species_id") ?? assignedSpecies;
  const speciesOptions = tariffContextData?.species_options ?? [];
  const speciesKnown = speciesId !== null && speciesOptions.some((option) => option.id === speciesId);

  const tariffs = useQuery({
    queryKey: [laboratoryId, speciesId, null, "/catalogs/tariffs", "tariffs"],
    queryFn: ({ signal }) => fetchTariffs(laboratoryId ?? "", speciesId, 1, signal),
    enabled: scoped && speciesId !== null && speciesKnown,
  });

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Active 409 states (§12.6): the fresh revision is loaded, the draft stays. */
  const [conflicts, setConflicts] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState<SaveSummaryState | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    card: CardMeta;
    key: string;
    tariff: TariffView;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [savePending, setSavePending] = useState(false);

  const cards = useMemo(() => {
    const list = tariffs.data !== undefined && !("code" in tariffs.data) ? tariffs.data.items : [];
    return buildTariffCards(list);
  }, [tariffs.data]);

  const dirty = useMemo(
    () =>
      cards.some((card, index) => {
        const key = card.tariff?.id ?? `new-${index}`;
        return drafts[key] !== undefined && normalizeMoneyInput(drafts[key]) !== (card.tariff?.price ?? "");
      }),
    [cards, drafts],
  );
  useDirtyGuard(dirty, "Справочник стоимости");

  const save = async (): Promise<void> => {
    if (savePending || laboratoryId === null || speciesId === null) return;
    const failures: { key: string; message: string }[] = [];
    let saved = 0;
    let conflicted = false;
    // Sequential per-card sends (§12): the actual answer of each changed
    // record is awaited; successes never mask failures.
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      const key = card.tariff?.id ?? `new-${index}`;
      // A conflicted card waits for the explicit §12.6 choice; a second
      // «Сохранить» never re-submits the stale draft against the fresh
      // revision.
      if (conflicts[key] === true) continue;
      const draft = drafts[key];
      if (draft === undefined || normalizeMoneyInput(draft) === (card.tariff?.price ?? "")) continue;
      const price = normalizeMoneyInput(draft);
      const fail = (message: string): void => {
        const text = message === "" ? "Не удалось сохранить тариф." : message;
        failures.push({ key, message: text });
        setErrors((current) => ({ ...current, [key]: text }));
      };
      if (price !== "" && !MONEY.test(price)) {
        fail(MONEY_MESSAGE);
        continue;
      }
      if (card.tariff === null) {
        if (price === "") {
          fail("Пустое поле не создаёт запись: заполните цену, чтобы настроить тариф.");
          continue;
        }
        const result = await createTariff(
          {
            laboratory_id: laboratoryId,
            product_species_id: speciesId,
            service_code: card.serviceCode,
            unit_id: TARIFF_CURRENCY,
            price,
            version: 1,
            source: MANUAL_CATALOG_SOURCE,
          },
          crypto.randomUUID(),
        );
        if ("code" in result) {
          if (result.code === "REVISION_CONFLICT") {
            conflicted = true;
            setConflicts((current) => ({ ...current, [key]: true }));
          }
          fail(result.detail);
          continue;
        }
      } else {
        if (price === "") {
          fail("Пустая цена сохраняется удалением записи вторичным действием карточки.");
          continue;
        }
        const tariff = card.tariff;
        const result = await updateTariff(
          tariff.id,
          {
            laboratory_id: tariff.laboratory_id,
            product_species_id: tariff.product_species_id,
            service_code: tariff.service_code,
            unit_id: tariff.unit_id,
            price,
            version: tariff.version,
            source: tariff.source as { name: string },
          },
          `"${tariff.revision}"`,
        );
        if ("code" in result) {
          if (result.code === "REVISION_CONFLICT") {
            conflicted = true;
            setConflicts((current) => ({ ...current, [key]: true }));
          }
          fail(result.detail);
          continue;
        }
      }
      saved += 1;
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
    if (failures.length === 0) {
      setSummary(saved === 0 ? null : { state: "success", text: "Справочник сохранён.", details: [] });
    } else {
      setSummary({
        state: "partial",
        text: `Сохранено: ${saved}. Не удалось: ${failures.length}. Повторите сохранение для неуспешных карточек.`,
        details: failures.map((item) => item.message),
      });
    }
    if (saved > 0 || conflicted) {
      // The fresh revision of the conflicted cards is loaded BEFORE the
      // §12.6 choice is shown: the comparison is always against the real
      // current server value.
      await tariffs.refetch();
    }
  };

  if (context.loading) {
    return (
      <CatalogEditorPage title="Стоимость исследований ВСЭ" description="Загрузка контекста…">
        <StatusView state="loading" title="Загрузка контекста…" />
      </CatalogEditorPage>
    );
  }
  if (context.configError !== null) {
    return (
      <CatalogEditorPage
        title="Стоимость исследований ВСЭ"
        description="Значения используются для автоматического расчёта стоимости услуг в журнале."
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

  const tariffsProblem =
    tariffs.data !== undefined && "code" in tariffs.data ? (tariffs.data as Problem) : null;
  const contextProblem =
    tariffsContext.data !== undefined && "code" in tariffsContext.data
      ? (tariffsContext.data as Problem)
      : null;
  const legacyTariffs = tariffContextData?.legacy_tariffs ?? [];

  return (
    <CatalogEditorPage
      title="Стоимость исследований ВСЭ"
      description="Значения используются для автоматического расчёта стоимости услуг в журнале."
    >
      <CatalogContextSlot context={context} onPick={allowedToSwitch ? pickLaboratory : null} />
      {summary !== null ? (
        <SaveSummary state={summary.state} text={summary.text} details={summary.details} />
      ) : null}
      {!scoped ? (
        <StatusView state="empty" title="Выберите лабораторию, чтобы открыть справочник." />
      ) : contextProblem !== null ? (
        <StatusView
          state={contextProblem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
          title={
            contextProblem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить контекст справочника."
          }
          detail={contextProblem.detail}
          onRetry={() => void tariffsContext.refetch()}
        />
      ) : (
        <>
          {/* ТЗ DR42 §3 (Вариант A): the species scope picked by its human
              name; the GUID travels only in the URL as an internal field. */}
          <section className="vse-catalog-section" aria-label="Область справочника">
            <div className="vse-catalog-field">
              <SelectDropdown
                id="tariffs-species"
                label="Вид продукции"
                value={speciesId ?? ""}
                options={[
                  { value: "", label: "Выберите вид продукции" },
                  ...speciesOptions.map((option) => ({ value: option.id, label: option.name })),
                ]}
                placeholder="Выберите вид продукции"
                disabled={savePending}
                onChange={(next) => {
                  const search = new URLSearchParams(location.search);
                  if (next === "") search.delete("product_species_id");
                  else search.set("product_species_id", next);
                  navigate(`/catalogs?${search.toString()}`);
                }}
              />
              <p className="vse-catalog-context-note">
                Категория продукции: {tariffContextData?.product_area_name ?? "Мясо и мясопродукты"} · тарифы
                настраиваются отдельно для каждого вида продукции.
              </p>
            </div>
            {/* The legacy mis-scoped rows are shown as the migration
                diagnostics only: no silent deletion, no copying between
                laboratories, no price substitution. */}
            {legacyTariffs.length > 0 ? (
              <article className="vse-catalog-diag" data-testid="tariffs-legacy-diag">
                Обнаружено устаревших строк тарифов, требующих миграции: {legacyTariffs.length}. В них видом
                продукции ошибочно записан идентификатор лаборатории; расчёт их не использует. Обратитесь к
                ответственному за прейскурант для переноса цен на реальные виды продукции.
              </article>
            ) : null}
          </section>
          {speciesId === null || !speciesKnown ? (
            <StatusView state="empty" title="Выберите вид продукции, чтобы открыть тарифы." />
          ) : speciesId !== null && speciesId !== undefined ? (
            <section className="vse-catalog-section" aria-labelledby="tariffs-section-title">
              <CatalogSectionHeader
                icon="directory-price"
                title="Исследования ВСЭ"
                description="Укажите стоимость каждого исследования."
              />
              {tariffs.isLoading ? (
                <StatusView state="loading" title="Загрузка тарифов…" />
              ) : tariffsProblem !== null ? (
                <StatusView
                  state={tariffsProblem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
                  title={tariffsProblem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить тарифы."}
                  detail={tariffsProblem.detail}
                  onRetry={() => void tariffs.refetch()}
                />
              ) : (
                <div className="vse-catalog-cards">
                  {cards.map((card, index) => {
                    const key = card.tariff?.id ?? `new-${index}`;
                    if (card.unknown) {
                      return (
                        <article className="vse-catalog-diag" key={key} data-testid={`tariff-diag-${key}`}>
                          Тариф вне общего каталога показателей. Код услуги: <code>{card.serviceCode}</code>.
                          Наименование недоступно в read model — значение не редактируется на этой странице.
                        </article>
                      );
                    }
                    const draft = drafts[key];
                    const conflict =
                      conflicts[key] === true && draft !== undefined
                        ? { serverValue: card.tariff?.price ?? "", draftValue: draft }
                        : undefined;
                    return (
                      <PriceCard
                        key={key}
                        name={card.name}
                        mandatory={card.mandatory}
                        value={draft ?? card.tariff?.price ?? ""}
                        unset={card.tariff === null && draft === undefined}
                        error={errors[key]}
                        busy={savePending}
                        readOnly={!canEdit}
                        conflict={conflict}
                        onKeepMine={conflict !== undefined ? () => void keepMine(card, key) : undefined}
                        onTakeServer={conflict !== undefined ? () => takeServer(key) : undefined}
                        onChange={(next) => {
                          setDrafts((current) => ({ ...current, [key]: next }));
                          setSummary(null);
                        }}
                        secondary={
                          card.tariff !== null && canEdit ? (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={savePending}
                              aria-label={`Удалить тариф: ${card.name}`}
                              onClick={() => {
                                setDeleteError("");
                                setDeleteTarget({ card, key, tariff: card.tariff as TariffView });
                              }}
                            >
                              Удалить
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
        </>
      )}
      <div className="vse-catalog-actions">
        <Button type="button" variant="secondary" onClick={() => void navigate("/catalogs")}>
          Отменить
        </Button>
        {canBulk && scoped && speciesId !== null ? (
          <Button type="button" variant="secondary" onClick={() => setBulkOpen(true)}>
            Применить стоимость к лабораториям
          </Button>
        ) : null}
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
          title="Удалить тариф?"
          description="Тариф перестанет покрывать расчёты этого показателя: готовность раздела станет неполной. Сохранённые расчёты не пересчитываются."
          confirmLabel="Удалить тариф"
          danger
          busy={deleteBusy}
          error={deleteError !== "" ? deleteError : undefined}
          onConfirm={() => void runDelete()}
        />
      ) : null}

      {bulkOpen ? (
        <Dialog
          open
          onOpenChange={setBulkOpen}
          title="Массовая цена"
          description="Одна команда на весь охват: охват проверяется до записи, каждая лаборатория применяется в своей транзакции."
          cancelLabel="Закрыть"
          confirmLabel="Готово"
        >
          <BulkPriceDialog
            laboratories={context.laboratories}
            productSpeciesId={speciesId ?? ""}
            onClose={() => {
              setBulkOpen(false);
              void tariffs.refetch();
            }}
          />
        </Dialog>
      ) : null}
    </CatalogEditorPage>
  );

  async function runSave(): Promise<void> {
    setSavePending(true);
    await save();
    setSavePending(false);
  }

  /** §12.6 «Сохранить моё значение»: retry the draft against the FRESH
   * revision (If-Match of the current server state, never the stale one). */
  async function keepMine(card: CardMeta, key: string): Promise<void> {
    if (card.tariff === null) return;
    const draft = drafts[key];
    if (draft === undefined) return;
    const price = normalizeMoneyInput(draft);
    if (price === "" || !MONEY.test(price)) return;
    setSavePending(true);
    const result = await updateTariff(
      card.tariff.id,
      {
        laboratory_id: card.tariff.laboratory_id,
        product_species_id: card.tariff.product_species_id,
        service_code: card.tariff.service_code,
        unit_id: card.tariff.unit_id,
        price,
        version: card.tariff.version,
        source: card.tariff.source as { name: string },
      },
      `"${card.tariff.revision}"`,
    );
    setSavePending(false);
    if ("code" in result) {
      setConflicts((current) => ({ ...current, [key]: true }));
      setErrors((current) => ({
        ...current,
        [key]: result.detail !== "" ? result.detail : "Запись снова изменена другим пользователем.",
      }));
      await tariffs.refetch();
      return;
    }
    clearConflict(key);
    await tariffs.refetch();
  }

  /** §12.6 «Взять значение сервера»: the draft is dropped, no save runs. */
  function takeServer(key: string): void {
    clearConflict(key);
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
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function runDelete(): Promise<void> {
    if (deleteTarget === null) return;
    setDeleteBusy(true);
    const problem = await deleteTariff(
      deleteTarget.tariff.id,
      `"${deleteTarget.tariff.revision}"`,
      crypto.randomUUID(),
    );
    setDeleteBusy(false);
    if (problem !== null) {
      setDeleteError(problem.detail !== "" ? problem.detail : "Не удалось удалить тариф.");
      return;
    }
    setDeleteTarget(null);
    await tariffs.refetch();
  }

  function pickLaboratory(id: string): void {
    const search = new URLSearchParams(location.search);
    search.set("laboratory_id", id);
    // The species scope belongs to the chosen laboratory: switching the lab
    // never carries the previous species selection.
    search.delete("product_species_id");
    navigate(`/catalogs?${search.toString()}`);
  }
}

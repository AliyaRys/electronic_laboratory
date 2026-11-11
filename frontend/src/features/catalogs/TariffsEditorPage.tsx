/**
 * «Стоимость исследований ВСЭ» editor page (ТЗ-DR6 §9, mockup
 * directory-price-edit.html).
 *
 * Cards are built from the SHARED INDICATORS registry (VSE-F18–29) joined
 * with the real tariffs of the laboratory/product scope; the CHECK service
 * codes are filtered out by exact service_code and shown on the «Платные
 * услуги» page instead (never by a Russian substring). A missing price stays
 * an empty field with «Не настроено»; an explicit 0,00 stays a valid price;
 * DecimalString never passes through a float. One «Сохранить справочник»
 * saves ONLY the dirty cards sequentially; a partial failure keeps the
 * failed cards dirty with a per-card message and retry re-sends only those.
 */
import { useQuery } from "@tanstack/react-query";
import "./catalogs.css";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { INDICATORS } from "../examinations/indicators";
import { Button } from "../../shared/ui/Button";
import { StatusView } from "../../shared/ui/StatusView";
import { Dialog } from "../../shared/ui/Dialog";
import {
  createTariff,
  deleteTariff,
  fetchMethods,
  fetchReadiness,
  fetchTariffs,
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
  const { laboratoryId, productSpeciesId, canEdit, canBulk, allowedToSwitch } = context;
  const scoped = laboratoryId !== null && productSpeciesId !== null;

  const tariffs = useQuery({
    queryKey: [laboratoryId, productSpeciesId, null, "/catalogs/tariffs", "tariffs"],
    queryFn: ({ signal }) => fetchTariffs(laboratoryId ?? "", productSpeciesId ?? "", 1, signal),
    enabled: scoped,
  });
  const readiness = useQuery({
    queryKey: [laboratoryId, productSpeciesId, null, "/catalogs/readiness", "tariffs"],
    queryFn: ({ signal }) => fetchReadiness(laboratoryId ?? "", productSpeciesId ?? "", signal),
    enabled: scoped,
  });
  const methods = useQuery({
    queryKey: [laboratoryId, productSpeciesId, null, "/catalogs/methods", "tariff-units"],
    queryFn: ({ signal }) => fetchMethods(laboratoryId ?? "", productSpeciesId ?? "", 1, signal),
    enabled: scoped,
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
    if (savePending || laboratoryId === null || productSpeciesId === null) return;
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
        const methodItems = methods.data !== undefined && !("code" in methods.data) ? methods.data.items : [];
        const units = [
          ...new Set(
            methodItems
              .filter((rule) => rule.indicator_id === card.serviceCode && rule.active)
              .map((rule) => rule.unit_id.trim())
              .filter((unit) => unit !== ""),
          ),
        ];
        if (units.length !== 1) {
          fail(
            units.length === 0
              ? "Для исследования не настроена единица начисления. Сначала настройте действующую норму."
              : "У исследования несколько единиц начисления. Исправьте нормы перед созданием цены.",
          );
          continue;
        }
        const result = await createTariff(
          {
            laboratory_id: laboratoryId,
            product_species_id: productSpeciesId,
            service_code: card.serviceCode,
            unit_id: units[0] as string,
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

  const problem = tariffs.data !== undefined && "code" in tariffs.data ? (tariffs.data as Problem) : null;
  const readinessData = readiness.data !== undefined && !("code" in readiness.data) ? readiness.data : null;

  return (
    <CatalogEditorPage
      title="Стоимость исследований ВСЭ"
      description="Значения используются для автоматического расчёта стоимости услуг в журнале."
    >
      <CatalogContextSlot context={context} onPick={allowedToSwitch ? pickLaboratory : null} />
      {scoped && readinessData !== null && readinessData.missing.length > 0 ? (
        <div className="vse-catalog-missing" data-testid="catalog-readiness">
          <strong>Раздел не готов к расчёту:</strong>
          <ul>
            {readinessData.missing.map((item) => (
              <li key={item.input_id}>{item.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {summary !== null ? (
        <SaveSummary state={summary.state} text={summary.text} details={summary.details} />
      ) : null}
      {scoped ? (
        <section className="vse-catalog-section" aria-labelledby="tariffs-section-title">
          <CatalogSectionHeader
            icon="directory-price"
            title="Исследования ВСЭ"
            description="Укажите стоимость каждого исследования."
          />
          {tariffs.isLoading ? (
            <StatusView state="loading" title="Загрузка тарифов…" />
          ) : problem !== null ? (
            <StatusView
              state={problem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
              title={problem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить тарифы."}
              detail={problem.detail}
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
      {!scoped ? <StatusView state="empty" title="Выберите лабораторию, чтобы открыть справочник." /> : null}
      <div className="vse-catalog-actions">
        <Button type="button" variant="secondary" onClick={() => void navigate("/catalogs")}>
          Отменить
        </Button>
        {canBulk && scoped ? (
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
            productSpeciesId={productSpeciesId ?? ""}
            unitsByServiceCode={Object.fromEntries(
              methods.data !== undefined && !("code" in methods.data)
                ? methods.data.items
                    .filter((rule) => rule.active && rule.unit_id.trim() !== "")
                    .map((rule) => [rule.indicator_id, rule.unit_id])
                : [],
            )}
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
    navigate(`/catalogs?${search.toString()}`);
  }
}

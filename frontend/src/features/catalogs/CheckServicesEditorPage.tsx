/**
 * «Платные услуги» editor page (ТЗ-DR6 §10, mockup
 * directory-paid-services-edit.html).
 *
 * The page edits the prices of EXACTLY TWO check services of the current
 * laboratory/product scope through the existing tariff API:
 *   PRODUCT_IDENTIFICATION  — «Идентификация продукции по наименованию и
 *                              визуальным осмотром»;
 *   TRANSPORT_INSPECTION    — «Ветеринарно-санитарная оценка и идентификация
 *                              транспорта».
 * The global CheckServiceRule table is not needed to save a monetary price;
 * its multiplier basis and applicable decisions are never edited or sent by
 * this page. A price save touches only Tariff records. There is no bulk
 * command here (§10.2).
 */
import { useQuery } from "@tanstack/react-query";
import "./catalogs.css";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "../../shared/ui/Button";
import { StatusView } from "../../shared/ui/StatusView";
import { Dialog } from "../../shared/ui/Dialog";
import { createTariff, deleteTariff, fetchTariffs, updateTariff, type Problem, type TariffView } from "./api";
import { CatalogEditorPage, CatalogSectionHeader, PriceCard, SaveSummary } from "./editor-parts";
import { CatalogContextSlot } from "./catalog-context-slot";
import { useCatalogContext } from "./use-catalog-context";
import { useDirtyGuard } from "../context/SwitchContext";
import { MONEY } from "./common";
import { MONEY_MESSAGE, normalizeMoneyInput, type SaveSummaryState } from "./TariffsEditorPage";

const MANUAL_CATALOG_SOURCE = { name: "Ручная настройка справочника" } as const;
const TARIFF_CURRENCY = "RUB";

export interface CheckServiceCard {
  serviceCode: "PRODUCT_IDENTIFICATION" | "TRANSPORT_INSPECTION";
  name: string;
  /** The price-carrying Tariff of the scope, or null when not configured. */
  tariff: TariffView | null;
}

/** Exact service codes only: the VSE/CHECK separation is never a substring. */
export function buildCheckServiceCards(tariffs: TariffView[]): CheckServiceCard[] {
  const names: Record<string, string> = {
    PRODUCT_IDENTIFICATION: "Идентификация продукции по наименованию и визуальным осмотром",
    TRANSPORT_INSPECTION: "Ветеринарно-санитарная оценка и идентификация транспорта",
  };
  return (["PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION"] as const).map((serviceCode) => ({
    serviceCode,
    name: names[serviceCode],
    tariff: tariffs.find((tariff) => tariff.service_code === serviceCode) ?? null,
  }));
}

export function CheckServicesEditorPage(): React.ReactElement {
  const context = useCatalogContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { laboratoryId, productSpeciesId, canEdit, allowedToSwitch } = context;
  const scoped = laboratoryId !== null && productSpeciesId !== null;

  const tariffs = useQuery({
    queryKey: [laboratoryId, productSpeciesId, null, "/catalogs/tariffs", "check-services"],
    queryFn: ({ signal }) => fetchTariffs(laboratoryId ?? "", productSpeciesId ?? "", 1, signal),
    enabled: scoped,
  });

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Active 409 states (§12.6): the fresh revision is loaded, the draft stays. */
  const [conflicts, setConflicts] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState<SaveSummaryState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ card: CheckServiceCard; tariff: TariffView } | null>(
    null,
  );
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [savePending, setSavePending] = useState(false);

  const cards = useMemo(() => {
    const list = tariffs.data !== undefined && !("code" in tariffs.data) ? tariffs.data.items : [];
    return buildCheckServiceCards(list);
  }, [tariffs.data]);

  const dirty = useMemo(
    () =>
      cards.some((card) => {
        const draft = drafts[card.serviceCode];
        return draft !== undefined && normalizeMoneyInput(draft) !== (card.tariff?.price ?? "");
      }),
    [cards, drafts],
  );
  useDirtyGuard(dirty, "Справочник платных услуг");

  async function save(): Promise<void> {
    if (laboratoryId === null || productSpeciesId === null) return;
    const failures: string[] = [];
    let saved = 0;
    let conflicted = false;
    for (const card of cards) {
      const draft = drafts[card.serviceCode];
      // A conflicted card waits for the explicit §12.6 choice; a second
      // «Сохранить» never re-submits the stale draft.
      if (conflicts[card.serviceCode] === true) continue;
      if (draft === undefined || normalizeMoneyInput(draft) === (card.tariff?.price ?? "")) continue;
      const price = normalizeMoneyInput(draft);
      const fail = (message: string): void => {
        const text = message === "" ? "Не удалось сохранить стоимость услуги." : message;
        failures.push(`${card.name}: ${text}`);
        setErrors((current) => ({ ...current, [card.serviceCode]: text }));
      };
      if (price !== "" && !MONEY.test(price)) {
        fail(MONEY_MESSAGE);
        continue;
      }
      if (card.tariff === null) {
        if (price === "") {
          fail("Пустое поле не создаёт запись: заполните стоимость, чтобы настроить услугу.");
          continue;
        }
        const result = await createTariff(
          {
            laboratory_id: laboratoryId,
            product_species_id: productSpeciesId,
            service_code: card.serviceCode,
            unit_id: TARIFF_CURRENCY,
            price,
            version: 1,
            source: MANUAL_CATALOG_SOURCE,
          },
          crypto.randomUUID(),
        );
        if ("code" in result) {
          fail(result.detail);
          continue;
        }
      } else {
        if (price === "") {
          fail("Пустая стоимость сохраняется удалением записи вторичным действием карточки.");
          continue;
        }
        const tariff = card.tariff;
        // Only the Tariff price changes; the CheckServiceRule is NOT touched.
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
            setConflicts((current) => ({ ...current, [card.serviceCode]: true }));
          }
          fail(result.detail);
          continue;
        }
      }
      saved += 1;
      setErrors((current) => {
        const next = { ...current };
        delete next[card.serviceCode];
        return next;
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[card.serviceCode];
        return next;
      });
    }
    if (failures.length === 0) {
      setSummary(saved === 0 ? null : { state: "success", text: "Справочник сохранён.", details: [] });
    } else {
      setSummary({
        state: "partial",
        text: `Сохранено: ${saved}. Не удалось: ${failures.length}. Повторите сохранение для неуспешных карточек.`,
        details: failures,
      });
    }
    if (saved > 0 || conflicted) {
      // The fresh revision of the conflicted cards is loaded BEFORE the
      // §12.6 choice is shown.
      await tariffs.refetch();
    }
  }

  if (context.loading) {
    return (
      <CatalogEditorPage title="Платные услуги" description="Загрузка контекста…">
        <StatusView state="loading" title="Загрузка контекста…" />
      </CatalogEditorPage>
    );
  }
  if (context.configError !== null) {
    return (
      <CatalogEditorPage
        title="Платные услуги"
        description="Стоимость услуг сверки данных для выбранной продукции."
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

  return (
    <CatalogEditorPage
      title="Платные услуги"
      description={`Стоимость услуг сверки данных для ${context.productLabel.toLowerCase()}. Значения используются при расчёте стоимости услуг в журнале.`}
    >
      <CatalogContextSlot context={context} onPick={allowedToSwitch ? pickLaboratory : null} />
      {summary !== null ? (
        <SaveSummary state={summary.state} text={summary.text} details={summary.details} />
      ) : null}
      {scoped ? (
        <section className="vse-catalog-section" aria-labelledby="check-section-title">
          <CatalogSectionHeader
            icon="directory-paid-services"
            title="Услуги сверки данных"
            description={`Укажите стоимость каждой услуги для ${context.productLabel.toLowerCase()}.`}
          />
          {tariffs.isLoading ? (
            <StatusView state="loading" title="Загрузка тарифов услуг сверки…" />
          ) : problem !== null ? (
            <StatusView
              state={problem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
              title={
                problem.code === "ACCESS_DENIED" ? undefined : "Не удалось загрузить тарифы услуг сверки."
              }
              detail={problem.detail}
              onRetry={() => void tariffs.refetch()}
            />
          ) : (
            <div className="vse-catalog-cards">
              {cards.map((card) => {
                const draft = drafts[card.serviceCode];
                const conflict =
                  conflicts[card.serviceCode] === true && draft !== undefined
                    ? { serverValue: card.tariff?.price ?? "", draftValue: draft }
                    : undefined;
                return (
                  <PriceCard
                    key={card.serviceCode}
                    name={card.name}
                    mandatory
                    value={draft ?? card.tariff?.price ?? ""}
                    unset={card.tariff === null && draft === undefined}
                    error={errors[card.serviceCode]}
                    busy={savePending}
                    readOnly={!canEdit}
                    conflict={conflict}
                    onKeepMine={conflict !== undefined ? () => void keepMine(card) : undefined}
                    onTakeServer={conflict !== undefined ? () => takeServer(card.serviceCode) : undefined}
                    onChange={(next) => {
                      setDrafts((current) => ({ ...current, [card.serviceCode]: next }));
                      setSummary(null);
                    }}
                    secondary={
                      card.tariff !== null && canEdit ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={savePending}
                          aria-label={`Удалить стоимость услуги: ${card.name}`}
                          onClick={() => {
                            setDeleteError("");
                            setDeleteTarget({ card, tariff: card.tariff as TariffView });
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
          title="Удалить стоимость услуги?"
          description="Новые платные операции этого вида будут заблокированы без настроенной цены. Сохранённые исторические снимки не изменяются."
          confirmLabel="Удалить стоимость"
          danger
          busy={deleteBusy}
          error={deleteError !== "" ? deleteError : undefined}
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

  /** §12.6 «Сохранить моё значение»: retry the draft against the FRESH
   * revision (If-Match of the current server state). */
  async function keepMine(card: CheckServiceCard): Promise<void> {
    if (card.tariff === null) return;
    const draft = drafts[card.serviceCode];
    if (draft === undefined) return;
    const price = normalizeMoneyInput(draft);
    if (price === "" || !MONEY.test(price)) return;
    const tariff = card.tariff;
    setSavePending(true);
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
    setSavePending(false);
    if ("code" in result) {
      setConflicts((current) => ({ ...current, [card.serviceCode]: true }));
      setErrors((current) => ({
        ...current,
        [card.serviceCode]:
          result.detail !== "" ? result.detail : "Запись снова изменена другим пользователем.",
      }));
      await tariffs.refetch();
      return;
    }
    clearConflict(card.serviceCode);
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
      setDeleteError(problem.detail !== "" ? problem.detail : "Не удалось удалить стоимость услуги.");
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

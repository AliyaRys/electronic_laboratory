/**
 * DR3 arrivals stories (spec 15): component-level states AND full-page
 * examples. Every story renders the SAME components the working route uses
 * (ArrivalsScreen / StageTabs / ArrivalsFilters / the three stage tables) —
 * no copied mockup markup and no mockup demo data.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ArrivalsScreen } from "./ArrivalsScreen";
import { StageTabs } from "./StageTabs";
import { ArrivalsFilters, ColumnsChooser } from "./ArrivalsFilters";
import { ReconciliationDateFilter } from "./ReconciliationDateFilter";
import { CompletedArrivalsTable, ExpectedArrivalsTable, WorkArrivalsTable } from "./ArrivalTables";
import { ArrivalsPagination } from "./ArrivalsPagination";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import type { ArrivalQueue, IncomingView } from "./api";
import { SORT_LABELS_BY_QUEUE } from "./api";

const meta: Meta = {
  title: "A01/Очереди поступлений",
  parameters: { layout: "padded" },
};
export default meta;

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const party = (over: Partial<IncomingView>): IncomingView => ({
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: "9c1b2d3e-1111-4222-8333-444444444444",
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "COMPLETED",
    fields: {
      documentUuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac",
      issuedOn: "2026-08-12T08:12:00",
      transportNumber: "А123ВС 116",
      consignor: "ООО «Мясопром» (Республика Татарстан, г. Казань, ул. Аграрная, 7)",
      consignee: "Лаборатория ВСЭ",
    },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: null,
    productItem: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002", name: "Говядина в тушах охлажденная" },
    unit: { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "кг" },
  },
  documentary: { mass_kg: "486.5", quantity: "3", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  confirmation: null,
  queue: "EXPECTED",
  examination_id: null,
  revision: 1,
  source_presence: "CURRENT_CONFIRMED",
  ...over,
});

const expectedRows: IncomingView[] = [
  party({}),
  party({
    party_id: "0c1b2d3e-1111-4222-8333-444444444444",
    external: {
      ...party({}).external,
      fields: {
        ...party({}).external.fields,
        documentUuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac",
        issuedOn: "2026-08-12T10:15:00",
        consignor:
          "Общество с ограниченной ответственностью «Агрофирма Свободный Труд имени двадцатилетия Автономной Республики» — длинное значение хозяйствующего субъекта",
        transportNumber: "Н831ОР 116",
      },
    },
    classification: {
      ...party({}).classification,
      product: { id: "b", name: "свинина" },
    },
    documentary: { mass_kg: "312.8", quantity: "12", unit_id: "u" },
  }),
];

const summary = (
  completedAt: string,
  total: string,
  author: string,
): NonNullable<IncomingView["reconciliation"]> => ({
  completed_at: completedAt,
  author_name: author,
  pricing: { lines: [], fair: false, total, currency: "RUB" },
});

const workRows: IncomingView[] = [
  party({
    queue: "WORK",
    confirmation: {
      id: "55555555-1111-4222-8333-444444444444",
      accepted_mass_kg: "486.500000",
      accepted_quantity: "3.000000",
      accepted_unit_id: "u",
      returned_mass_kg: "0.000000",
      returned_quantity: "0.000000",
      confirmed_at: "2026-08-12T11:40:00Z",
    },
    // ТЗ DR39: the frozen server summary — cost/date/author are REAL fields.
    reconciliation: summary("2026-11-05T07:10:00Z", "230.00", "Иванова Анна Петровна"),
  }),
  party({
    party_id: "0c1b2d3e-1111-4222-8333-444444444444",
    queue: "WORK",
    confirmation: {
      id: "66666666-1111-4222-8333-444444444444",
      accepted_mass_kg: "312.800000",
      accepted_quantity: "12.000000",
      accepted_unit_id: "u",
      returned_mass_kg: "0.000000",
      returned_quantity: "0.000000",
      confirmed_at: "2026-08-12T15:25:00Z",
    },
    examination_id: "77777777-1111-4222-8333-444444444444",
    reconciliation: summary("2026-11-06T08:35:00Z", "0.00", "Смирнов Пётр Васильевич"),
  }),
];

const acceptedRows: IncomingView[] = [
  party({
    queue: "ACCEPTED",
    confirmation: {
      id: "55555555-1111-4222-8333-444444444444",
      accepted_mass_kg: "486.500000",
      accepted_quantity: "3.000000",
      accepted_unit_id: "u",
      returned_mass_kg: "0.000000",
      returned_quantity: "0.000000",
      confirmed_at: "2026-08-12T13:10:00Z",
    },
    examination_id: "77777777-1111-4222-8333-444444444444",
    reconciliation: summary("2026-11-05T07:10:00Z", "230.00", "Иванова Анна Петровна"),
  }),
  party({
    party_id: "0c1b2d3e-1111-4222-8333-444444444444",
    queue: "ACCEPTED",
    confirmation: {
      id: "66666666-1111-4222-8333-444444444444",
      accepted_mass_kg: "312.800000",
      accepted_quantity: "12.000000",
      accepted_unit_id: "u",
      returned_mass_kg: "0.000000",
      returned_quantity: "0.000000",
      confirmed_at: "2026-08-12T16:40:00Z",
    },
    examination_id: null,
    reconciliation: summary("2026-11-06T08:35:00Z", "230.00", "Смирнов Пётр Васильевич"),
  }),
];

/** ТЗ DR39 §5: the honest legacy state — a WORK row without any summary. */
const legacyWorkRows: IncomingView[] = [
  party({
    queue: "WORK",
    confirmation: {
      id: "55555555-1111-4222-8333-444444444444",
      accepted_mass_kg: "486.500000",
      accepted_quantity: "3.000000",
      accepted_unit_id: "u",
      returned_mass_kg: "0.000000",
      returned_quantity: "0.000000",
      confirmed_at: "2026-08-12T11:40:00Z",
    },
    reconciliation: null,
  }),
];

const longAuthorRows: IncomingView[] = [
  party({
    queue: "WORK",
    confirmation: workRows[0]!.confirmation,
    reconciliation: summary(
      "2026-11-05T07:10:00Z",
      "230.00",
      "Иванова Анна Петровна Константиновна Очень-Очень-Длинное Полное Имя Сотрудника Лаборатории",
    ),
  }),
];

const counts = { EXPECTED: 12, WORK: 8, ACCEPTED: 5 };
const screenProps = {
  labId: LAB,
  q: "",
  onSearch: () => {},
  result: "",
  onResultChange: () => {},
  // DR15 §5.1: the storybook full pages show the EXPECTED sort control too.
  sort: "desc" as const,
  onSortChange: () => {},
  // ТЗ DR39 §7: the stories show the real (empty) applied date; the date
  // filter story uses its own applied value.
  reconciled: { on: "", from: "", to: "" } as const,
  onReconciledApply: () => {},
  hiddenColumns: new Set<string>(),
  onToggleColumn: () => {},
  loading: false,
  problem: null,
  onRetry: () => {},
  page: 1,
  pageCount: 1,
  onPage: () => {},
  onQueueChange: () => {},
};

// --- 15.1 components ---------------------------------------------------------------

export const ВкладкиЭтапов: StoryObj = {
  name: "Вкладки этапов / счётчики",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <StageTabs current="EXPECTED" counts={counts} onQueueChange={() => {}} />
    </div>
  ),
};

export const ВкладкиЗагрузкаСчётчиков: StoryObj = {
  name: "Вкладки / счётчики загружаются и ошибка",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <StageTabs
        current="WORK"
        counts={{ EXPECTED: "loading", WORK: "failed", ACCEPTED: 5 }}
        onQueueChange={() => {}}
      />
    </div>
  ),
};

export const ФильтрыОжидаемые: StoryObj = {
  name: "Панель фильтров / ожидаемые",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <ArrivalsFilters q="" onSearch={() => {}} />
    </div>
  ),
};

/** ТЗ DR39 §7: the queue-aware WORK sort labels of the ONE select. */
export const ФильтрыВРаботе: StoryObj = {
  name: "Панель фильтров / в работе (сортировка сверки)",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <ArrivalsFilters q="" onSearch={() => {}} sort="desc" onSortChange={() => {}} sortLabels={SORT_LABELS_BY_QUEUE.WORK} />
    </div>
  ),
};

// --- ТЗ DR39 §7: the reconciliation date filter states ----------------------------

const dateFilterGrid = (applied: { on: string; from: string; to: string }, initialOpen = false): React.ReactElement => (
  <div style={{ padding: 16, background: "#f5f9f8", display: "flex", gap: 16, flexWrap: "wrap" }}>
    <ReconciliationDateFilter applied={applied} onApply={() => {}} initialOpen={initialOpen} />
  </div>
);

export const ДатаФильтрЗакрыт: StoryObj = {
  name: "Фильтр даты сверки / закрыт",
  render: () => dateFilterGrid({ on: "", from: "", to: "" }),
};

export const ДатаФильтрОдинДень: StoryObj = {
  name: "Фильтр даты сверки / выбран один день",
  render: () => dateFilterGrid({ on: "2026-11-06", from: "", to: "" }),
};

export const ДатаФильтрДиапазон: StoryObj = {
  name: "Фильтр даты сверки / применён диапазон",
  render: () => dateFilterGrid({ on: "", from: "2026-11-05T10:00", to: "2026-11-06T18:30" }),
};

export const ДатаФильтрНеверныйДиапазон: StoryObj = {
  name: "Фильтр даты сверки / неверный диапазон",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <RangeErrorStory />
    </div>
  ),
};

function RangeErrorStory(): React.ReactElement {
  const [applied, setApplied] = useState({ on: "", from: "", to: "" });
  return (
    <div style={{ display: "flex", gap: 16 }}>
      <ReconciliationDateFilter applied={applied} onApply={setApplied} initialOpen />
    </div>
  );
}

export const ДатаФильтрДлиннаяСводка: StoryObj = {
  name: "Фильтр даты сверки / длинная подпись",
  render: () =>
    dateFilterGrid({ on: "", from: "2026-11-05T10:00", to: "2026-12-31T23:59" }),
};

export const ДатаФильтрУзкийЭкран: StoryObj = {
  name: "Фильтр даты сверки / 390 px",
  parameters: { viewport: { width: 390, height: 844 } },
  render: () => dateFilterGrid({ on: "2026-11-06", from: "", to: "" }, true),
};

export const ФильтрыЗавершенные: StoryObj = {
  name: "Панель фильтров / завершенные с выбором столбцов",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <ArrivalsFilters
        q=""
        onSearch={() => {}}
        result="WAITING"
        onResultChange={() => {}}
        columns={
          <ColumnsChooser
            initialOpen
            options={[
              { id: "checkAuthor", label: "Автор сверки данных" },
              { id: "vseAuthor", label: "Автор ВСЭ" },
              { id: "vseNumber", label: "Номер ВСЭ" },
            ]}
            hidden={new Set(["vseNumber"])}
            onToggle={() => {}}
          />
        }
      />
    </div>
  ),
};

export const ТаблицаОжидаемых: StoryObj = {
  name: "Таблица ожидаемых",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <ExpectedArrivalsTable labId={LAB} items={expectedRows} onHide={() => {}} />
    </div>
  ),
};

export const ТаблицаВРаботе: StoryObj = {
  name: "Таблица в работе с черновиком",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <WorkArrivalsTable
        labId={LAB}
        items={workRows}
        draftPartyIds={new Set(["0c1b2d3e-1111-4222-8333-444444444444"])}
      />
    </div>
  ),
};

export const ТаблицаЗавершенных: StoryObj = {
  name: "Таблица завершенных",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <CompletedArrivalsTable labId={LAB} items={acceptedRows} hiddenColumns={new Set()} />
    </div>
  ),
};

/** ТЗ DR39 §5: the honest legacy state — no summary, only «—». */
export const ТаблицаВРаботеБезСводки: StoryObj = {
  name: "Таблица в работе / без сводки сверки (legacy)",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <WorkArrivalsTable labId={LAB} items={legacyWorkRows} />
    </div>
  ),
};

/** ТЗ DR39 §5: a long author name is truncated visually only — the full value
 * stays available through the native title of the table cell. */
export const ТаблицаВРаботеДлинныйАвтор: StoryObj = {
  name: "Таблица в работе / длинный автор сверки",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <WorkArrivalsTable labId={LAB} items={longAuthorRows} />
    </div>
  ),
};

export const ИконныеДействия: StoryObj = {
  name: "Иконные действия / состояния",

  render: () => (
    <div
      style={{
        padding: 16,
        background: "#f5f9f8",
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}
    >
      <button type="button" className="arrivals-icon-action" aria-label="Продолжить создание ВСЭ">
        Продолжить
      </button>
      <button
        type="button"
        className="arrivals-icon-action danger"
        aria-label="Скрыть поступление из очереди"
      >
        Скрыть
      </button>
      <a className="arrivals-icon-action primary" href="#" aria-label="Создать ВСЭ">
        Создать
      </a>
      <a className="arrivals-icon-action compact" href="#" aria-label="Открыть карточку ВСЭ">
        Карточка
      </a>
      <button type="button" className="arrivals-icon-action" disabled aria-label="Недоступно">
        Недоступно
      </button>
    </div>
  ),
};

/** DR29 §5.1/§7: the row actions group with keyboard focus on the hide button —
    the highlight belongs only to the danger button, the group and the sibling
    «Сверить» link stay untouched. Hover is demonstrated by pointer. */
export const ДействияСтрокиФокус: StoryObj = {
  name: "Действия строки / focus на скрытии (не на группе)",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <div className="app-table-row-actions">
        <a
          className="app-table-icon-action"
          href="#"
          aria-label="Перейти к сверке данных"
          title="Перейти к сверке данных"
        >
          Сверить
        </a>
        <button
          type="button"
          className="arrivals-icon-action danger"
          aria-label="Скрыть поступление из очереди"
          title="Скрыть поступление из очереди"
          autoFocus
        >
          Скрыть
        </button>
      </div>
    </div>
  ),
};

/** DR29 §6.2/§7: the open danger delete Dialog over the arrivals table. */
export const ДиалогСкрытия: StoryObj = {
  name: "Диалог скрытия / открыт над таблицей",
  render: () => (
    <div className="vse-app">
      <ArrivalsScreen {...screenProps} queue="EXPECTED" counts={counts} items={expectedRows} />
      <Dialog
        open
        onOpenChange={() => {}}
        danger
        title="Скрыть поступление из очереди?"
        description="Документ e13bda81-7cf6-4b2b-b1aa-3c99e25adaac перестанет отображаться в очереди «Ожидаемые». Сам эВСД не аннулируется: документ останется в системе и при изменении внешнего содержания появится снова."
        confirmLabel="Скрыть"
      />
    </div>
  ),
};

export const ПагинацияПервая: StoryObj = {
  name: "Пагинация / первая страница",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <ArrivalsPagination page={1} pageCount={6} onPage={() => {}} />
    </div>
  ),
};

export const ПагинацияСредняя: StoryObj = {
  name: "Пагинация / середина",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <ArrivalsPagination page={3} pageCount={6} onPage={() => {}} />
    </div>
  ),
};

export const ПагинацияПоследняя: StoryObj = {
  name: "Пагинация / последняя страница",
  render: () => (
    <div style={{ padding: 16, background: "#f5f9f8" }}>
      <ArrivalsPagination page={6} pageCount={6} onPage={() => {}} />
    </div>
  ),
};

// --- 15.2 full pages ---------------------------------------------------------------

function FullScreen(
  queue: ArrivalQueue,
  items: readonly IncomingView[],
  options: {
    syncStatus?: string;
    busy?: boolean;
  } = {},
): StoryObj {
  return {
    render: () => (
      <div className="vse-app">
        <ArrivalsScreen
          {...screenProps}
          queue={queue}
          counts={counts}
          items={items}
          onHide={queue === "EXPECTED" ? () => {} : undefined}
          sync={
            <Button
              label="Обновить поступления из ВетИС"
              busy={options.busy}
              busyLabel={options.busy ? "Повторяем обновление…" : "Обновление…"}
            >
              Обновить
            </Button>
          }
          syncStatus={options.syncStatus ?? "Автообновление из ВетИС каждые 15 минут"}
        />
      </div>
    ),
  };
}

export const СтраницаОжидаемые: StoryObj = {
  name: "Страница / Ожидаемые",
  ...FullScreen("EXPECTED", expectedRows),
};
export const СтраницаВРаботе: StoryObj = {
  name: "Страница / В работе",
  ...FullScreen("WORK", workRows),
};
export const СтраницаЗавершенные: StoryObj = {
  name: "Страница / Завершенные",
  ...FullScreen("ACCEPTED", acceptedRows),
};

/** DR29 §7: retry/busy state with a long honest status inside the button width. */
export const СтраницаОжидаемыеОбновление: StoryObj = {
  name: "Страница / Ожидаемые — обновление (retry, длинный статус)",
  ...FullScreen("EXPECTED", expectedRows, {
    busy: true,
    syncStatus:
      "Обновление не выполнено: сервис ВетИС временно недоступен. Повторите обновление позже. Длинный статус переносится внутри ширины кнопки, не расширяя страницу.",
  }),
};

export const СтраницаУзкийЭкран: StoryObj = {
  name: "Страница / Ожидаемые 390 px",
  parameters: { viewport: { width: 390, height: 844 } },
  ...FullScreen("EXPECTED", expectedRows),
};

/** ТЗ DR39 §5: the WORK queue on a narrow screen keeps real metadata. */
export const СтраницаВРаботеУзкийЭкран: StoryObj = {
  name: "Страница / В работе 390 px",
  parameters: { viewport: { width: 390, height: 844 } },
  ...FullScreen("WORK", workRows),
};

export const СтраницаЗагрузка: StoryObj = {
  name: "Страница / загрузка",
  render: () => (
    <div className="vse-app">
      <ArrivalsScreen
        {...screenProps}
        queue="EXPECTED"
        counts={{ EXPECTED: "loading", WORK: "loading", ACCEPTED: "loading" }}
        items={[]}
        loading
      />
    </div>
  ),
};

export const СтраницаПустая: StoryObj = {
  name: "Страница / пустая очередь",
  render: () => (
    <div className="vse-app">
      <ArrivalsScreen
        {...screenProps}
        queue="EXPECTED"
        counts={{ EXPECTED: 0, WORK: 0, ACCEPTED: 0 }}
        items={[]}
      />
    </div>
  ),
};

export const СтраницаБезСовпадений: StoryObj = {
  name: "Страница / фильтр без совпадений",
  render: () => (
    <div className="vse-app">
      <ArrivalsScreen {...screenProps} queue="WORK" q="несуществующий номер" counts={counts} items={[]} />
    </div>
  ),
};

export const СтраницаОшибкаСети: StoryObj = {
  name: "Страница / ошибка сети",
  render: () => (
    <div className="vse-app">
      <ArrivalsScreen
        {...screenProps}
        queue="EXPECTED"
        counts={{ EXPECTED: "failed", WORK: "failed", ACCEPTED: "failed" }}
        items={[]}
        problem={{
          code: "NETWORK",
          type: "about:blank",
          title: "Сеть недоступна",
          status: 0,
          detail: "Сеть недоступна.",
          trace_id: "trace-1",
        }}
      />
    </div>
  ),
};

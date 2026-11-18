/**
 * R03 component stories (DR51): significant states of the reporting pieces —
 * the full section III matrix (ordinary, long data, narrow), the permanent
 * date parameters with the stale warning, and the compact report header.
 * The preview payload here is a frozen fixture, exactly what the screen
 * shows for a saved snapshot.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { ReportMatrix } from "./ReportMatrix";
import { ReportHeader } from "./ReportHeader";
import { ReportParameters } from "./ReportParameters";
import { ReportHubItem } from "./ReportHubItem";
import { StatusView } from "../../shared/ui/StatusView";
import "./reports.css";

const meta: Meta = {
  title: "R03/Отчёты",
};
export default meta;

const COLUMNS = [
  "CATTLE",
  "PIG",
  "SHEEP_GOAT",
  "RABBIT_NUTRIA",
  "CHICKEN",
  "OTHER_BIRDS",
  "FISH",
  "OTHER_ANIMALS",
];

const rows = [
  { code: "166", name: "1. Осмотрено (проведено ветеринарно-санитарных экспертиз), всего, единиц", mode: "AUTO" },
  { code: "167", name: "в том числе: микроскопических", mode: "AUTO" },
  { code: "168", name: "трихинеллоскопий", mode: "AUTO" },
  { code: "169", name: "физико-химических", mode: "AUTO" },
  { code: "170", name: "радиометрических", mode: "AUTO" },
  { code: "171", name: "других лабораторных исследований", mode: "AUTO" },
  { code: "172", name: "2. Проведено специальных лабораторных исследований всего, единиц", mode: "AUTO" },
  { code: "210", name: "Незаразные болезни", mode: "AUTO" },
  { code: "240", name: "7. Направлено на уничтожение, тонн", mode: "AUTO" },
  { code: "241", name: "из них: мяса", mode: "AUTO" },
  { code: "242", name: "субпродуктов", mode: "AUTO" },
  { code: "173", name: "3. Выявлено случаев болезни при ВСЭ, единиц", mode: "BLANK" },
  { code: "174", name: "Ящур", mode: "BLANK" },
  { code: "175", name: "Сибирская язва", mode: "BLANK" },
  { code: "176", name: "Туберкулез", mode: "BLANK" },
  { code: "209", name: "Другие инвазионные болезни", mode: "BLANK" },
];

const payload = {
  version: 2,
  form_version: "2",
  classification_version: "2026-v1",
  columns: COLUMNS,
  rows,
  matrix: [
    ["12", "34", "2", "0", "5", "7", "0", "1"],
    ["8", "20", "1", "0", "3", "4", "0", "0"],
    ["1", "6", "0", "0", "0", "0", "0", "0"],
    ["0", "9", "1", "0", "0", "0", "0", "0"],
    ["2", "4", "0", "0", "0", "1", "0", "0"],
    ["3", "11", "0", "0", "1", "2", "0", "0"],
    ["0", "2", "0", "0", "0", "0", "0", "0"],
    ["0", "0", "0", "0", "0", "0", "0", "0"],
    ["0.3", "0.25", "0.05", "0", "0", "0", "0", "0"],
    ["0.3", "0.25", "0.05", "0", "0", "0", "0", "0"],
    ["0", "0", "0", "0", "0", "0", "0", "0"],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
  ],
  source_count: 34,
  official: false,
};

const longPayload = {
  ...payload,
  matrix: payload["matrix"].map((row, index) => (index === 0 ? ["0.1234567890123456789", ...row.slice(1)] : row)),
};

export const МатрицаСохранённогоОтчёта: StoryObj<typeof ReportMatrix> = {
  render: (args) => <ReportMatrix {...args} />,
  args: { payload, official: false },
};

export const МатрицаСДлиннымиДанными: StoryObj<typeof ReportMatrix> = {
  render: (args) => <ReportMatrix {...args} />,
  args: { payload: longPayload, official: false },
};

export const МатрицаNarrowView: StoryObj<typeof ReportMatrix> = {
  render: (args) => (
    <div style={{ width: 390 }}>
      <ReportMatrix {...args} />
    </div>
  ),
  args: { payload, official: false },
};

export const ШапкаОтчёта: StoryObj<typeof ReportHeader> = {
  render: (args) => <ReportHeader {...args} />,
  args: {
    createdLabel: "Дата создания",
    createdAt: "2026-11-18T15:51:00+03:00",
    dateFrom: "2026-01-01",
    dateTo: "2026-06-30",
    laboratory: "Агропромышленный парк",
  },
};

export const ПараметрыСПредупреждением: StoryObj<typeof ReportParameters> = {
  render: (args) => <ReportParameters {...args} />,
  args: {
    applied: { from: "2026-01-01", to: "2026-06-30" },
    busy: false,
    disabled: false,
    stale: true,
    error: "",
    onChange: () => undefined,
    onApply: () => undefined,
  },
};

export const ПараметрыNarrowView: StoryObj<typeof ReportParameters> = {
  render: (args) => (
    <div style={{ width: 390 }}>
      <ReportParameters {...args} />
    </div>
  ),
  args: {
    applied: { from: "2026-01-01", to: "" },
    busy: false,
    disabled: false,
    stale: false,
    error: "",
    onChange: () => undefined,
    onApply: () => undefined,
  },
};

/* The hub rows use exactly the same ReportHubItem component as the page
   (DR37 §Task 4); the meta here is REAL data semantics — a saved period and
   a real count, an honest empty/loading/error state, never a static mock. */

function HubCard({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <section className="vse-reports-card" aria-label="Направления отчётов">
      <div className="vse-reports-hub-list">{children}</div>
    </section>
  );
}

const LAB_ROUTE = "/labs/11111111-2222-4333-8444-555555555555/reports";

export const ХабАналитика: StoryObj = {
  render: () => (
    <HubCard>
      <ReportHubItem
        name="Форма 5-вет (раздел III)"
        meta="Сохранённых отчётов: 2. Список — ниже на этой странице."
      />
      <ReportHubItem
        name="Операционные показатели"
        meta="Показатели работы лаборатории за выбранный период."
        to={`${LAB_ROUTE}/operational`}
        actionLabel="Открыть: Операционные показатели"
      />
      <ReportHubItem
        name="Учёт проб"
        meta="Остатки проб и история утилизации."
        to={`${LAB_ROUTE}/samples`}
        actionLabel="Открыть: Учёт проб"
      />
    </HubCard>
  ),
};

/** VET with sample:read: the hub shows only «Учёт проб» (O-05). */
export const ХабВетврачаУчётПроб: StoryObj = {
  render: () => (
    <HubCard>
      <ReportHubItem
        name="Учёт проб"
        meta="Остатки проб и история утилизации."
        to={`${LAB_ROUTE}/samples`}
        actionLabel="Открыть: Учёт проб"
      />
    </HubCard>
  ),
};

/** No saved 5-вет yet: the calm empty state; the other directions stay. */
export const ХабБезСохранённых: StoryObj = {
  render: () => (
    <HubCard>
      <ReportHubItem name="Форма 5-вет (раздел III)" meta="Сохранённых отчётов пока нет." />
      <ReportHubItem
        name="Операционные показатели"
        meta="Показатели работы лаборатории за выбранный период."
        to={`${LAB_ROUTE}/operational`}
        actionLabel="Открыть: Операционные показатели"
      />
      <ReportHubItem
        name="Учёт проб"
        meta="Остатки проб и история утилизации."
        to={`${LAB_ROUTE}/samples`}
        actionLabel="Открыть: Учёт проб"
      />
    </HubCard>
  ),
};

/** Loading: no false «нет отчётов» text. */
export const ХабЗагрузка: StoryObj = {
  render: () => (
    <HubCard>
      <ReportHubItem name="Форма 5-вет (раздел III)" meta="Загрузка списка сохранённых отчётов…" />
    </HubCard>
  ),
};

/** Network error of the saved list: retry, the directions stay available. */
export const ХабСетеваяОшибка: StoryObj = {
  render: () => (
    <StatusView
      state="network-error"
      title="Не удалось загрузить список отчётов."
      detail="Сервис отчётов недоступен."
      onRetry={() => undefined}
    />
  ),
};

/** Long laboratory metadata must wrap, never break the grid. */
export const ХабДлинныеДанные: StoryObj = {
  render: () => (
    <HubCard>
      <ReportHubItem
        name="Форма 5-вет (раздел III)"
        meta="Сохранённых отчётов: 12 · ГБУ «Центральное управление государственной ветеринарной службы Республики Татарстан», лаборатория №14 города Казани"
      />
      <ReportHubItem
        name="Операционные показатели"
        meta="Показатели работы лаборатории за выбранный период."
        to={`${LAB_ROUTE}/operational`}
        actionLabel="Открыть: Операционные показатели"
      />
      <ReportHubItem
        name="Учёт проб"
        meta="Остатки проб и история утилизации."
        to={`${LAB_ROUTE}/samples`}
        actionLabel="Открыть: Учёт проб"
      />
    </HubCard>
  ),
};

/** 390px: the rows stack vertically without page-wide horizontal scroll. */
export const ХабNarrowView: StoryObj = {
  render: () => (
    <div style={{ width: 390 }}>
      <HubCard>
        <ReportHubItem
          name="Форма 5-вет (раздел III)"
          meta="Сохранённых отчётов: 2. Список — ниже на этой странице."
        />
        <ReportHubItem
          name="Операционные показатели"
          meta="Показатели работы лаборатории за выбранный период."
          to={`${LAB_ROUTE}/operational`}
          actionLabel="Открыть: Операционные показатели"
        />
        <ReportHubItem
          name="Учёт проб"
          meta="Остатки проб и история утилизации."
          to={`${LAB_ROUTE}/samples`}
          actionLabel="Открыть: Учёт проб"
        />
      </HubCard>
    </div>
  ),
};

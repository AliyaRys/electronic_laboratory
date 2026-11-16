/**
 * R03 component stories: significant states of the reporting pieces — the
 * saved matrix (ordinary, long data, narrow), the parameters with the stale
 * warning, and the codes with validation errors. The preview payload here is
 * a frozen fixture, exactly what the screen shows for a saved snapshot.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { ReportMatrix } from "./ReportMatrix";
import { ReportParameters } from "./ReportParameters";
import { ReportCodes } from "./ReportCodes";
import { ReportHubItem } from "./ReportHubItem";
import { StatusView } from "../../shared/ui/StatusView";
import "./reports.css";

const meta: Meta = {
  title: "R03/Отчёты",
};
export default meta;

const payload = {
  version: 1,
  classification_version: "2026-v1",
  columns: [
    "CATTLE",
    "PIG",
    "SHEEP_GOAT",
    "RABBIT_NUTRIA",
    "CHICKEN",
    "OTHER_BIRDS",
    "FISH",
    "OTHER_ANIMALS",
  ],
  matrix: [
    ["12", "34", "2", "0", "5", "7", "0", "1"],
    ["8", "20", "1", "0", "3", "4", "0", "0"],
    ["1", "6", "0", "0", "0", "0", "0", "0"],
    ["0", "9", "1", "0", "0", "0", "0", "0"],
    ["2", "4", "0", "0", "0", "1", "0", "0"],
    ["3", "11", "0", "0", "1", "2", "0", "0"],
    ["0", "2", "0", "0", "0", "0", "0", "0"],
    ["0.3", "0.25", "0.05", "0", "0", "0", "0", "0"],
    ["0.3", "0.25", "0.05", "0", "0", "0", "0", "0"],
    ["0", "0", "0", "0", "0", "0", "0", "0"],
  ],
  source_count: 34,
  official: false,
};

const longPayload = {
  ...payload,
  columns: ["OTHER_ANIMALS"],
  matrix: [
    ["0.1234567890123456789"],
    ["0"],
    ["0"],
    ["0"],
    ["0"],
    ["0"],
    ["0"],
    ["0.000000001"],
    ["0"],
    ["0"],
  ],
};

export const МатрицаСохранённогоОтчёта: StoryObj<typeof ReportMatrix> = {
  render: (args) => <ReportMatrix {...args} />,
  args: { payload, sourceCount: 34, official: false, caption: "Матрица сохранённого отчёта" },
};

export const МатрицаСДлиннымиДанными: StoryObj<typeof ReportMatrix> = {
  render: (args) => <ReportMatrix {...args} />,
  args: { payload: longPayload, sourceCount: 3, official: false, caption: "Матрица сохранённого отчёта" },
};

export const МатрицаNarrowView: StoryObj<typeof ReportMatrix> = {
  render: (args) => (
    <div style={{ width: 390 }}>
      <ReportMatrix {...args} />
    </div>
  ),
  args: { payload, sourceCount: 34, official: false, caption: "Матрица сохранённого отчёта" },
};

export const ПараметрыСПредупреждением: StoryObj<typeof ReportParameters> = {
  render: (args) => <ReportParameters {...args} />,
  args: {
    year: 2026,
    half: 1,
    busy: false,
    disabled: false,
    stale: true,
    onYear: () => undefined,
    onHalf: () => undefined,
    onPreview: () => undefined,
  },
};

export const КодыСОшибками: StoryObj<typeof ReportCodes> = {
  render: (args) => <ReportCodes {...args} />,
  args: {
    values: { okud: "001", okpo: "", okved: "", oktmo: "", okogu: "", okopf: "", okfs: "" },
    errors: {
      okpo: "Код обязателен и не может быть пустым.",
      okved: "Код обязателен и не может быть пустым.",
    },
    disabled: false,
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
      <ReportHubItem name="Форма 5-вет (раздел III)" meta="Сохранённых отчётов: 2. Список — ниже на этой странице." />
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
        <ReportHubItem name="Форма 5-вет (раздел III)" meta="Сохранённых отчётов: 2. Список — ниже на этой странице." />
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

import type { Meta, StoryObj } from "@storybook/react";
import { DataTable, type DataTableRow } from "./DataTable";

const columns = [
  { id: "party", header: "Партия" },
  { id: "owner", header: "Хозяйство" },
  { id: "mass", header: "Масса, кг" },
];

const rows: DataTableRow[] = [
  {
    id: "row-1",
    href: "/labs/11111111-2222-4333-8444-555555555555/arrivals/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/reconciliation",
    rowAction: {
      href: "/labs/11111111-2222-4333-8444-555555555555/arrivals/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/reconciliation",
      label: "Сверить",
      accessibleName: "Перейти к сверке данных",
    },
    cells: [
      { columnId: "party", value: "эВСД 41-201" },
      { columnId: "owner", value: "ООО «Агрофирма Прогресс»" },
      { columnId: "mass", value: "1 240,5" },
    ],
    menu: [
      { id: "examination", label: "Создать ВСЭ" },
      { id: "hide", label: "Скрыть партию" },
    ],
  },
  {
    id: "row-2",
    href: "/labs/11111111-2222-4333-8444-555555555555/arrivals/bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee/reconciliation",
    rowAction: {
      href: "/labs/11111111-2222-4333-8444-555555555555/arrivals/bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee/reconciliation",
      label: "Сверить",
      accessibleName: "Перейти к сверке данных",
    },
    cells: [
      { columnId: "party", value: "эВСД 41-202" },
      { columnId: "owner", value: "КФХ Садыкова" },
      { columnId: "mass", value: "320" },
    ],
  },
];

const longRows: DataTableRow[] = [
  {
    id: "row-long",
    href: "/arrivals/1",
    rowAction: {
      href: "/arrivals/1",
      label: "Сверить",
      accessibleName: "Перейти к сверке данных",
    },
    cells: [
      { columnId: "party", value: "эВСД 41-203" },
      {
        columnId: "owner",
        value:
          "Общество с ограниченной ответственностью «Агрофирма Свободный Труд имени двадцатилетия Татарской Автономной Советской Социалистической Республики»",
      },
      { columnId: "mass", value: "8 640,375" },
    ],
    menu: [{ id: "examination", label: "Создать ВСЭ" }],
  },
];

const meta: Meta<typeof DataTable> = {
  title: "F02/DataTable",
  component: DataTable,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof DataTable>;

export const Basic: Story = { args: { caption: "Ожидаемые", columns, rows } };
/** Named for the acceptance test: the row menu never navigates. */
export const RowMenu: Story = {
  args: {
    caption: "В работе",
    columns,
    rows,
    onMenuAction: () => undefined,
  },
};
/** Named for the acceptance test: the full value is reachable without hover. */
export const LongValues: Story = {
  args: { caption: "Ожидаемые", columns, rows: longRows, onMenuAction: () => undefined },
};
export const Loading: Story = {
  args: { caption: "Ожидаемые", columns, rows: [], loading: true },
};
export const Empty: Story = {
  args: { caption: "Ожидаемые", columns, rows: [], emptyMessage: "Партий нет." },
};
export const Narrow: Story = {
  args: { caption: "Ожидаемые", columns, rows: longRows, onMenuAction: () => undefined },
  decorators: [
    (Story) => (
      <div style={{ width: 390 }}>
        <Story />
      </div>
    ),
  ],
};

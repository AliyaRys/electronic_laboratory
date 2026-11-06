/**
 * F02 table acceptance (UI-03): the row action menu never navigates even when
 * the row carries a link, and long values stay fully accessible without hover
 * (no truncation into a title attribute; horizontal scroll stays inside the
 * table, never the page).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "./DataTable";

const LONG_VALUE =
  "Название хозяйствующего субъекта: Общество с ограниченной ответственностью «Агрофирма Свободный Труд имени двадцатилетия Татарской Автономной Советской Социалистической Республики»";

const columns = [
  { id: "party", header: "Партия" },
  { id: "owner", header: "Хозяйство" },
];

function baseRows() {
  return [
    {
      id: "row-1",
      href: "/labs/00000000-0000-0000-0000-000000000001/arrivals/00000000-0000-0000-0000-000000000002/reconciliation",
      cells: [
        { columnId: "party", value: "эВСД 41-201" },
        { columnId: "owner", value: "ООО «Агрофирма»" },
      ],
      menu: [
        { id: "examination", label: "Создать ВСЭ" },
        { id: "hide", label: "Скрыть" },
      ],
    },
  ];
}

function longRows() {
  return [
    {
      id: "row-long",
      href: "/arrivals/1",
      cells: [
        { columnId: "party", value: "эВСД 41-201" },
        { columnId: "owner", value: LONG_VALUE },
      ],
    },
  ];
}

describe("DataTable", () => {
  it("test_row_menu_does_not_navigate", async () => {
    const onMenuAction = vi.fn();
    const user = userEvent.setup();
    render(<DataTable caption="Ожидаемые" columns={columns} rows={baseRows()} onMenuAction={onMenuAction} />);

    // The row keeps its link…
    const rowLink = screen.getByRole("link", { name: /эВСД 41-201/ });
    expect(rowLink).toHaveAttribute("href");

    // …but opening the row menu and choosing an action never navigates.
    await user.click(screen.getByRole("button", { name: "Действия со строкой" }));
    expect(screen.queryByRole("link", { name: "Создать ВСЭ" })).toBeNull();

    await user.click(screen.getByRole("menuitem", { name: "Создать ВСЭ" }));
    expect(onMenuAction).toHaveBeenCalledWith(expect.anything(), "row-1", "examination");
    expect(screen.queryByRole("menu", { name: "Действия со строкой" })).toBeNull();
  });

  it("menu is keyboard accessible and closes on Escape", async () => {
    const user = userEvent.setup();
    render(<DataTable caption="Ожидаемые" columns={columns} rows={baseRows()} />);
    await user.click(screen.getByRole("button", { name: "Действия со строкой" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Действия со строкой" })).toBeNull();
    expect(screen.getByRole("button", { name: "Действия со строкой" })).toHaveFocus();
  });

  it("test_long_values_keyboard", () => {
    render(<DataTable caption="Ожидаемые" columns={columns} rows={longRows()} />);
    // The full value is a real text node — reachable by a screen reader and by
    // keyboard users without hover; no title-tooltip-only truncation.
    expect(screen.getByText(LONG_VALUE)).toBeInTheDocument();
    const cell = screen.getByText(LONG_VALUE).closest("td");
    expect(cell?.getAttribute("title")).toBeNull();
    expect(screen.getByRole("table", { name: "Ожидаемые" })).toBeInTheDocument();
  });

  it("renders the shared empty and loading states instead of an empty table", () => {
    const { rerender } = render(
      <DataTable caption="Ожидаемые" columns={columns} rows={[]} emptyMessage="Партий нет" />,
    );
    expect(screen.getByText("Партий нет")).toBeInTheDocument();

    rerender(
      <DataTable caption="Ожидаемые" columns={columns} rows={[]} loading loadingMessage="Загрузка…" />,
    );
    expect(screen.getByText("Загрузка…")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

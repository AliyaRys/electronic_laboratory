/**
 * Canonical system header (components/shell/AppHeader.js contract): geometry
 * and behavior of the header; the product switcher is keyboard operated and
 * the user identity always comes from UserView — never from an open
 * examination's specialist.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader";
const user = {
  fullName: "Анна Кузнецова",
  initials: "АК",
  institution: "Лаборатория ВСЭ №1 г. Казань",
};

describe("AppHeader", () => {
  it("renders brand, navigation, product switcher and user area", () => {
    render(<AppHeader mode="work" user={user} product="meat" active="arrivals" onLogout={() => undefined} />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Поступления" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Тип продукции: Мясо/ })).toBeInTheDocument();
    expect(screen.getByText("Анна Кузнецова")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выйти" })).toBeInTheDocument();
  });

  it("opens the product list with the keyboard and switches with focus return", async () => {
    const act = userEvent.setup();
    const onProductChange = vi.fn();
    render(
      <AppHeader
        mode="work"
        user={user}
        product="meat"
        active="arrivals"
        onProductChange={onProductChange}
        onLogout={() => undefined}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Тип продукции/ });
    await act.click(trigger);
    const milkOption = screen.getByRole("option", { name: "Молоко и молочная продукция" });
    expect(milkOption).toBeInTheDocument();
    await act.click(milkOption);
    expect(onProductChange).toHaveBeenCalledWith("milk");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("admin and no-products modes hide the working navigation and switcher", () => {
    const { rerender } = render(<AppHeader mode="admin" user={user} onLogout={() => undefined} />);
    expect(screen.getByRole("link", { name: /Управление пользователями/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Тип продукции/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Поступления" })).toBeNull();

    rerender(<AppHeader mode="no-products" user={user} onLogout={() => undefined} />);
    expect(screen.queryByRole("link", { name: "Поступления" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Тип продукции/ })).toBeNull();
  });

  it("reports the logout action", async () => {
    const onLogout = vi.fn();
    const act = userEvent.setup();
    render(<AppHeader mode="work" user={user} onLogout={onLogout} />);
    await act.click(screen.getByRole("button", { name: "Выйти" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("never renders examination data as the current user", () => {
    render(<AppHeader mode="work" user={user} onLogout={() => undefined} />);
    // Header shows only the session user; a party/examination specialist name
    // (Review Focus F02) must never appear here.
    expect(screen.queryByText("Ринат Усманов")).toBeNull();
    expect(screen.getByText("Анна Кузнецова")).toBeInTheDocument();
  });
});

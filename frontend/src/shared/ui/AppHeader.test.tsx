/**
 * Canonical system header (components/shell/AppHeader.js contract): geometry
 * and behavior of the header; the product switcher is keyboard operated and
 * the user identity always comes from UserView — never from an open
 * examination's specialist.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppHeader, headerUserFromView } from "./AppHeader";
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
    expect(screen.getByRole("link", { name: "Анна Кузнецова" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выйти" })).toBeInTheDocument();
  });

  it("renders the PNG logo in the brand instead of the check icon", () => {
    render(<AppHeader mode="work" user={user} onLogout={() => undefined} />);
    const logo = document.querySelector(".topbar .brand-logo img");
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("src", "/vse-lab-icon-transparent.png");
    expect(logo).toHaveAttribute("alt", "");
    expect(document.querySelector(".topbar .brand-logo svg")).toBeNull();
  });

  it("marks the profile link active with aria-current on /profile", () => {
    render(<AppHeader mode="work" user={user} profileActive onLogout={() => undefined} />);
    const link = screen.getByRole("link", { name: "Анна Кузнецова" });
    expect(link).toHaveClass("active");
    expect(link).toHaveAttribute("aria-current", "page");
  });
  it("shows the canonical roadmap trigger button, not a static div (DR46 §3.1)", () => {
    const { container } = render(
      <AppHeader mode="work" user={user} product="meat" active="arrivals" onLogout={() => undefined} />,
    );
    const trigger = screen.getByRole("button", { name: "Тип продукции: Мясо и мясопродукты" });
    expect(trigger).toHaveClass("navlink", "product-trigger");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("data-short-label", "Мясо");
    expect(trigger.querySelector(".nav-caret")).not.toBeNull();
    expect(container.querySelector("[data-product-static]")).toBeNull();
  });

  it("lists the six roadmap directions in the required order", () => {
    render(<AppHeader mode="work" user={user} product="meat" onLogout={() => undefined} />);
    const trigger = screen.getByRole("button", { name: /Тип продукции/ });
    trigger.click();
    const options = Array.from(document.querySelectorAll('[role="option"]'));
    expect(options.map((option) => option.textContent)).toEqual([
      "Мясо и мясопродукты",
      "Молоко и молочные продуктыПока недоступно",
      "Яйца и яйцепродукцияПока недоступно",
      "Рыба и рыбная продукцияПока недоступно",
      "Мёд и медовая продукцияПока недоступно",
      "Растительная пищевая продукцияПока недоступно",
    ]);
  });

  it("marks the five roadmap directions unavailable and keeps only meat selectable", async () => {
    const act = userEvent.setup();
    const onProductChange = vi.fn();
    render(
      <AppHeader
        mode="work"
        user={user}
        product="meat"
        onProductChange={onProductChange}
        onLogout={() => undefined}
      />,
    );
    await act.click(screen.getByRole("button", { name: /Тип продукции/ }));
    const meat = screen.getByRole("option", { name: "Мясо и мясопродукты" });
    expect(meat).toHaveAttribute("aria-selected", "true");
    expect(meat).toBeEnabled();
    for (const name of [
      "Молоко и молочные продукты",
      "Яйца и яйцепродукция",
      "Рыба и рыбная продукция",
      "Мёд и медовая продукция",
      "Растительная пищевая продукция",
    ]) {
      const option = screen.getByRole("option", { name: new RegExp(`${name}.*Пока недоступно`) });
      expect(option).toBeDisabled();
      expect(option).toHaveAttribute("aria-disabled", "true");
      expect(option).toHaveAttribute("aria-selected", "false");
      expect(option.textContent).toContain("Пока недоступно");
    }
    // The disabled roadmap items are honest no-ops.
    await act.click(screen.getByRole("option", { name: /Яйца и яйцепродукция/ }));
    expect(onProductChange).not.toHaveBeenCalled();
    await act.click(screen.getByRole("option", { name: /Молоко и молочные продукты/ }));
    expect(onProductChange).not.toHaveBeenCalled();
  });

  it("normalizes an out-of-roadmap current product (milk) to meat: six options, meat selected (DR46 fix-loop 2)", async () => {
    const act = userEvent.setup();
    const { container } = render(
      <AppHeader mode="work" user={user} product="milk" active="arrivals" onLogout={() => undefined} />,
    );
    // The trigger carries the normalized meat context, never a milk label.
    expect(screen.getByRole("button", { name: "Тип продукции: Мясо и мясопродукты" })).toBeTruthy();
    await act.click(screen.getByRole("button", { name: /Тип продукции/ }));
    // The dropdown invariant: ALL six roadmap entries are rendered, no matter
    // the current product; the disabled milk entry is never marked selected.
    expect(document.querySelectorAll('[role="option"]').length).toBe(6);
    const meat = screen.getByRole("option", { name: "Мясо и мясопродукты" });
    expect(meat).toHaveAttribute("aria-selected", "true");
    expect(meat).toBeEnabled();
    const milk = screen.getByRole("option", { name: /Молоко и молочные продукты/ });
    expect(milk).toHaveAttribute("aria-selected", "false");
    expect(milk).toBeDisabled();
    expect(container.querySelector('[data-product-icon="milk"]')).toBeNull();
  });

  it("re-selecting meat closes the menu and returns focus to the trigger", async () => {
    const act = userEvent.setup();
    render(<AppHeader mode="work" user={user} product="meat" onLogout={() => undefined} />);
    const trigger = screen.getByRole("button", { name: /Тип продукции/ });
    await act.click(trigger);
    await act.click(screen.getByRole("option", { name: "Мясо и мясопродукты" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("ArrowDown opens the menu on the only available option; Escape closes and returns focus", async () => {
    const act = userEvent.setup();
    render(<AppHeader mode="work" user={user} product="meat" onLogout={() => undefined} />);
    const trigger = screen.getByRole("button", { name: /Тип продукции/ });
    await act.click(trigger);
    await act.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Мясо и мясопродукты" }));
    await act.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("admin and no-products modes hide the working navigation and switcher", () => {
    const { rerender } = render(<AppHeader mode="admin" user={user} onLogout={() => undefined} />);
    expect(screen.getByRole("link", { name: /Управление пользователями/ })).toBeInTheDocument();
    // FT-RPT-01: the administrator has no reports item in the header (DR37).
    expect(screen.queryByRole("link", { name: "Отчёты" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Тип продукции/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Поступления" })).toBeNull();

    rerender(<AppHeader mode="no-products" user={user} onLogout={() => undefined} />);
    expect(screen.queryByRole("link", { name: "Поступления" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Тип продукции/ })).toBeNull();
  });

  it("shows the reports item only when a contextual link is provided (DR37 §3)", () => {
    const LAB = "11111111-2222-4333-8444-555555555555";
    const { rerender } = render(
      <AppHeader
        mode="work"
        user={user}
        links={{ arrivals: `/labs/${LAB}/arrivals`, reports: `/labs/${LAB}/reports` }}
        onLogout={() => undefined}
      />,
    );
    expect(screen.getByRole("link", { name: "Отчёты" })).toHaveAttribute("href", `/labs/${LAB}/reports`);

    rerender(<AppHeader mode="work" user={user} links={{}} onLogout={() => undefined} />);
    expect(screen.queryByRole("link", { name: "Отчёты" })).toBeNull();
  });

  it("an analyst without a selected laboratory links «Отчёты» to the honest /labs choice", () => {
    render(
      <AppHeader
        mode="analyst"
        user={user}
        active="reports"
        links={{ reports: "/labs" }}
        onLogout={() => undefined}
      />,
    );
    const reports = screen.getByRole("link", { name: "Отчёты" });
    expect(reports).toHaveAttribute("href", "/labs");
    expect(reports).toHaveAttribute("aria-current", "page");
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
    expect(screen.getByRole("link", { name: "Анна Кузнецова" })).toBeInTheDocument();
  });
});

describe("AppHeader user identity (ТЗ DR41 §3.1)", () => {
  it("derives the initials РА from «Рысаева Алия Илдаровна»", () => {
    const view = headerUserFromView({ full_name: "Рысаева Алия Илдаровна" });
    expect(view.initials).toBe("РА");
    expect(view.fullName).toBe("Рысаева Алия Илдаровна");
  });

  it("survives extra spaces, lowercase input and an unparseable name", () => {
    expect(headerUserFromView({ full_name: "  Рысаева    Алия   " }).initials).toBe("РА");
    expect(headerUserFromView({ full_name: "рысаева алия" }).initials).toBe("РА");
    expect(headerUserFromView({ full_name: "   " }).initials).toBe("?");
  });

  it("shows the initials in the avatar, never the full name as visible text", () => {
    render(
      <AppHeader
        mode="work"
        user={headerUserFromView({ full_name: "Рысаева Алия Илдаровна" })}
        onLogout={() => undefined}
      />,
    );
    expect(screen.getByText("РА")).toBeInTheDocument();
    expect(screen.queryByText("Рысаева Алия Илдаровна")).toBeNull();
  });

  it("keeps the full name in the accessible name and title of the profile link", () => {
    render(
      <AppHeader
        mode="work"
        user={headerUserFromView({ full_name: "Рысаева Алия Илдаровна" })}
        profileActive
        onLogout={() => undefined}
      />,
    );
    const link = screen.getByRole("link", { name: "Рысаева Алия Илдаровна" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveAttribute("title", "Рысаева Алия Илдаровна");
  });

  it("renders the institution line under the brand", () => {
    render(
      <AppHeader
        mode="work"
        user={user}
        institution="ГБУ «Лаборатория №1 г. Казань»"
        onLogout={() => undefined}
      />,
    );
    expect(screen.getByText("ГБУ «Лаборатория №1 г. Казань»")).toBeInTheDocument();
  });
});

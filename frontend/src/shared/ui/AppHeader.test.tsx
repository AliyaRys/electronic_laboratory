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

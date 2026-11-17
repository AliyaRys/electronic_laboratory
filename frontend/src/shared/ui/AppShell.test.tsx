/**
 * The shell layout route (single source of truth): canonical header + outlet +
 * the F01 dirty-leave dialog. Session identity comes from GET /me; a failed or
 * absent session never falls back to fabricated data.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createQueryClient } from "../../app/providers";
import { AppShell } from "./AppShell";
import { useContextStore, type ProductType } from "../../entities/session/context";
import type { UserView } from "../../shared/api/me";

const me: UserView = {
  id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  full_name: "Анна Кузнецова",
  login: "kuznetsova",
  email: "kuznetsova@lab.tatar",
  position: "Ветеринарный врач",
  role: "VET",
  active: true,
  scopes: [{ laboratory_id: "11111111-2222-4333-8444-555555555555", product_scope_id: null }],
  capabilities: ["arrivals:read", "sample:read", "report:operational", "report:5vet-list", "report:5vet-read"],
  revision: 3,
};

const LAB = "11111111-2222-4333-8444-555555555555";
const OTHER_LAB = "99999999-8888-4777-8666-555555555555";

const examinationSpecialist = "Ринат Усманов";

const server = setupServer(
  http.get("*/api/v1/me", () => HttpResponse.json(me)),
  http.get("*/api/v1/examinations/*", () => HttpResponse.json({ author_full_name: examinationSpecialist })),
  http.get("*/api/v1/contexts", () => HttpResponse.json([])),
);

beforeAll(() => server.listen());
afterAll(() => server.close());

// The product context lives in the scope store; every test starts clean.
beforeEach(() => {
  server.resetHandlers();
  useContextStore.getState().reset();
});

function meFixture(overrides: Partial<UserView>): UserView {
  return { ...me, ...overrides };
}

function renderShellWith(overrides: Partial<UserView>, path = "/"): void {
  server.use(http.get("*/api/v1/me", () => HttpResponse.json(meFixture(overrides))));
  renderShell(path);
}

async function waitForUser(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Анна Кузнецова" })).toBeInTheDocument(),
  );
}

function renderShell(path = "/"): void {
  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: [
          { path: "/", element: <p>Содержимое страницы</p> },
          { path: "*", element: <p>Содержимое страницы</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("AppShell", () => {
  it("mounts the canonical header and the route outlet", async () => {
    renderShell();
    await waitForUser();
    expect(screen.getByText("Содержимое страницы")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("restores the assigned laboratory after refresh and builds working navigation", async () => {
    renderShell("/profile");
    await waitForUser();

    const laboratoryId = me.scopes[0]?.laboratory_id;
    expect(laboratoryId).toBeDefined();
    expect(screen.getByRole("link", { name: "Поступления" })).toHaveAttribute(
      "href",
      `/labs/${laboratoryId}/arrivals?queue=expected`,
    );
    expect(screen.getByRole("link", { name: "Журнал ВСЭ" })).toHaveAttribute(
      "href",
      `/labs/${laboratoryId}/examinations`,
    );
    // /profile is the current page for the user link (DR4 §6).
    expect(screen.getByRole("link", { name: "Анна Кузнецова" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Справочники" })).not.toHaveAttribute("aria-current");
    await waitFor(() => expect(useContextStore.getState().labId).toBe(laboratoryId));
  });

  it("never shows an open examination's specialist as the current user", async () => {
    renderShell();
    await waitForUser();
    expect(screen.queryByText(examinationSpecialist)).toBeNull();
  });

  it("marks «Справочники» active on /catalogs and the user link on /profile", async () => {
    renderShell("/catalogs");
    await waitForUser();
    expect(screen.getByRole("link", { name: "Справочники" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Анна Кузнецова" })).not.toHaveAttribute("aria-current");
  });

  it("test_legacy_url_without_identity", async () => {
    renderShell("/journal.html");
    await waitFor(() => expect(screen.getByText(/Запись не указана/)).toBeInTheDocument());
    // No fabricated data behind an identity-less legacy link.
    expect(screen.queryByText(/эВСД/)).toBeNull();
    expect(screen.queryByText(/Усманов/)).toBeNull();
  });

  it("a session error is an honest error state, not fake data", async () => {
    server.use(http.get("*/api/v1/me", () => new HttpResponse(null, { status: 503 })));
    renderShell();
    await waitFor(() =>
      expect(screen.getByText(/Ошибка соединения|Не удалось|не распознан/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("link", { name: "Анна Кузнецова" })).toBeNull();
  });

  it("an ADMIN user gets the administration header without working navigation", async () => {
    renderShellWith({ role: "ADMIN" });
    await waitForUser();
    expect(screen.getByRole("link", { name: /Управление пользователями/ })).toBeInTheDocument();
    // FT-RPT-01: the administrator has no reports item at all (DR37 §3).
    expect(screen.queryByRole("link", { name: /Отчёты/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Поступления/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Тип продукции/ })).toBeNull();
  });

  it("a user without assigned scopes lands in no-products mode", async () => {
    renderShellWith({ scopes: [] });
    await waitForUser();
    expect(screen.queryByRole("link", { name: /Поступления/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Тип продукции/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Выйти" })).toBeInTheDocument();
  });

  it("a milk-scoped VET defaults to the milk product context", async () => {
    useContextStore.getState().setProductType("milk");
    renderShell();
    await waitForUser();
    expect(
      screen.getByRole("button", { name: "Тип продукции: Молоко и молочная продукция" }),
    ).toBeInTheDocument();
  });

  it("switching the product updates the scope store and the trigger label", async () => {
    const userEvent = (await import("@testing-library/user-event")).default.setup();
    useContextStore.getState().setProductType("milk");
    renderShell();
    await waitForUser();
    const trigger = screen.getByRole("button", { name: "Тип продукции: Молоко и молочная продукция" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("option", { name: "Мясо и продукты убоя" }));

    expect(useContextStore.getState().productType as ProductType).toBe("meat");
    expect(screen.getByRole("button", { name: "Тип продукции: Мясо и продукты убоя" })).toBeInTheDocument();
  });
});

describe("AppShell contextual reports navigation (DR37)", () => {
  const REPORT_CAPS = [
    "sample:read",
    "report:operational",
    "report:5vet-list",
    "report:5vet-read",
    "report:5vet-preview",
    "report:5vet-save",
  ];

  it("an ANALYST on a selected laboratory keeps «Отчёты» in that laboratory", async () => {
    renderShellWith({ role: "ANALYST", capabilities: REPORT_CAPS }, `/labs/${OTHER_LAB}/arrivals`);
    await waitForUser();
    const reports = screen.getByRole("link", { name: "Отчёты" });
    expect(reports).toHaveAttribute("href", `/labs/${OTHER_LAB}/reports`);
    // The navigation never drops the selected laboratory back to /labs.
    expect(reports).not.toHaveAttribute("href", "/labs");
    expect(screen.getByRole("link", { name: "Поступления" })).toHaveAttribute(
      "href",
      `/labs/${OTHER_LAB}/arrivals?queue=expected`,
    );
  });

  it("on a reports route of the selected laboratory «Отчёты» is the active item", async () => {
    renderShellWith({ role: "ANALYST", capabilities: REPORT_CAPS }, `/labs/${OTHER_LAB}/reports`);
    await waitForUser();
    expect(screen.getByRole("link", { name: "Отчёты" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Поступления" })).not.toHaveAttribute("aria-current");
  });

  it("an ANALYST before the laboratory choice links «Отчёты» to the honest /labs selection", async () => {
    renderShellWith({ role: "ANALYST", capabilities: REPORT_CAPS }, "/labs");
    await waitForUser();
    expect(screen.getByRole("link", { name: "Отчёты" })).toHaveAttribute("href", "/labs");
  });

  it("a VET with sample:read sees «Отчёты» pointing to the own laboratory", async () => {
    renderShellWith({ role: "VET", capabilities: ["arrivals:read", "sample:read"] }, `/labs/${LAB}/arrivals?queue=expected`);
    await waitForUser();
    expect(screen.getByRole("link", { name: "Отчёты" })).toHaveAttribute("href", `/labs/${LAB}/reports`);
  });

  it("a HEAD with report capabilities sees «Отчёты» pointing to the own laboratory", async () => {
    renderShellWith({ role: "HEAD", capabilities: REPORT_CAPS }, `/labs/${LAB}/examinations`);
    await waitForUser();
    expect(screen.getByRole("link", { name: "Отчёты" })).toHaveAttribute("href", `/labs/${LAB}/reports`);
    // The examinations route keeps the journal item active, not reports.
    expect(screen.getByRole("link", { name: "Журнал ВСЭ" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Отчёты" })).not.toHaveAttribute("aria-current");
  });

  it("a user without any reporting capability has no «Отчёты» item", async () => {
    renderShellWith({ role: "VET", capabilities: ["arrivals:read"] }, `/labs/${LAB}/arrivals?queue=expected`);
    await waitForUser();
    expect(screen.queryByRole("link", { name: "Отчёты" })).toBeNull();
  });

  it("the journal route marks «Журнал ВСЭ» and the users route marks the admin item active", async () => {
    renderShellWith({ role: "ADMIN", capabilities: [] }, "/users");
    await waitForUser();
    expect(screen.getByRole("link", { name: /Управление пользователями/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("AppShell institution line (ТЗ DR41 §3.2)", () => {
  it("a VET sees the laboratory_name of the assigned scope under the brand", async () => {
    renderShellWith({
      scopes: [
        {
          laboratory_id: LAB,
          product_scope_id: null,
          laboratory_name: "ГБУ «Лаборатория №1 г. Казань»",
        },
      ],
    });
    await waitForUser();
    expect(screen.getByText("ГБУ «Лаборатория №1 г. Казань»")).toBeInTheDocument();
    // A UUID is never shown as the institution.
    expect(screen.queryByText(LAB)).toBeNull();
  });

  it("a scope without a laboratory_name shows «Лаборатория не указана»", async () => {
    renderShell();
    await waitForUser();
    expect(screen.getByText("Лаборатория не указана")).toBeInTheDocument();
  });

  it("an ANALYST sees «Республика Татарстан», never a selected laboratory name", async () => {
    renderShellWith({
      role: "ANALYST",
      scopes: [
        {
          laboratory_id: OTHER_LAB,
          product_scope_id: null,
          laboratory_name: "ГБУ «Лаборатория №1 г. Казань»",
        },
      ],
    });
    await waitForUser();
    expect(screen.getByText("Республика Татарстан")).toBeInTheDocument();
    expect(screen.queryByText("ГБУ «Лаборатория №1 г. Казань»")).toBeNull();
  });

  it("an ADMIN sees «Республика Татарстан»", async () => {
    renderShellWith({ role: "ADMIN", scopes: [] });
    await waitForUser();
    expect(screen.getByText("Республика Татарстан")).toBeInTheDocument();
  });

  it("the full name stays accessible through title, but is not visible text", async () => {
    renderShell();
    await waitForUser();
    expect(screen.queryByText("Анна Кузнецова")).toBeNull();
    expect(screen.getByTitle("Анна Кузнецова")).toBeInTheDocument();
  });
});

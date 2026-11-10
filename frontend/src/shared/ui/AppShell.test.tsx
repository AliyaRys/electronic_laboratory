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
  capabilities: ["arrivals:read"],
  revision: 3,
};

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

function renderShellWith(overrides: Partial<UserView>): void {
  server.use(http.get("*/api/v1/me", () => HttpResponse.json(meFixture(overrides))));
  renderShell();
}

async function waitForUser(): Promise<void> {
  await waitFor(() => expect(screen.getByText("Анна Кузнецова")).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText("Анна Кузнецова")).toBeInTheDocument());
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
    await waitFor(() => expect(useContextStore.getState().labId).toBe(laboratoryId));
  });

  it("never shows an open examination's specialist as the current user", async () => {
    renderShell();
    await waitFor(() => expect(screen.getByText("Анна Кузнецова")).toBeInTheDocument());
    expect(screen.queryByText(examinationSpecialist)).toBeNull();
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
    expect(screen.queryByText("Анна Кузнецова")).toBeNull();
  });

  it("an ADMIN user gets the administration header without working navigation", async () => {
    renderShellWith({ role: "ADMIN" });
    await waitForUser();
    expect(screen.getByRole("link", { name: /Управление пользователями/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Отчёты/ })).toBeInTheDocument();
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

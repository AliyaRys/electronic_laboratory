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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createQueryClient } from "../../app/providers";
import { AppShell } from "./AppShell";
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
});

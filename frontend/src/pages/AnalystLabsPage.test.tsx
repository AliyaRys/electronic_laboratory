import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../app/providers";
import type { UserView } from "../shared/api/me";
import { AnalystLabsPage } from "./AnalystLabsPage";

const LAB = "11111111-2222-4333-8444-555555555555";
const user: UserView = {
  id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  full_name: "Рысаева Алия Илдаровна",
  login: "arysaeva",
  email: "rysaeva.aliya@tatar.ru",
  position: "Заведующая лабораторией",
  role: "HEAD",
  active: true,
  scopes: [{ laboratory_id: LAB, product_scope_id: LAB }],
  capabilities: ["arrivals:read"],
  revision: 1,
};

const contextsSpy = vi.fn();
const server = setupServer(
  http.get("*/api/v1/me", () => HttpResponse.json(user)),
  http.get("*/api/v1/contexts", () => {
    contextsSpy();
    return HttpResponse.json([]);
  }),
);

beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  contextsSpy.mockClear();
  server.resetHandlers();
});

describe("AnalystLabsPage", () => {
  it("redirects a HEAD from the analyst route to assigned arrivals", async () => {
    const router = createMemoryRouter(
      [
        { path: "/labs", element: <AnalystLabsPage /> },
        { path: "/labs/:labId/arrivals", element: <p>Рабочие поступления</p> },
      ],
      { initialEntries: ["/labs"] },
    );

    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Рабочие поступления")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/labs/${LAB}/arrivals`);
    expect(router.state.location.search).toBe("?queue=expected");
    expect(contextsSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("Выберите лабораторию и тип продукции.")).toBeNull();
  });
});

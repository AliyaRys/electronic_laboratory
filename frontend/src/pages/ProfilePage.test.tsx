/**
 * Profile composition (DR4 §8): profile.html layout over the real UserView —
 * InfoFields, capability tags, the security block, and NO raw UUIDs rendered
 * as names/institutions. The photo choice is visual only (no API, no URL).
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createQueryClient } from "../app/providers";
import { ProfilePage } from "./ProfilePage";

const LAB_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SPECIES_ID = "22222222-2222-4222-8222-222222222222";

const me = {
  id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  full_name: "Иван Длиннофамильный Козлобородов-Третьяков",
  login: "vet.longname",
  email: "vet.longname@lab.tatar",
  position: "Ветеринарный врач",
  role: "VET",
  active: true,
  scopes: [{ laboratory_id: LAB_ID, product_scope_id: SPECIES_ID, territory_id: null }],
  capabilities: ["arrivals:read", "examination:create"],
  revision: 3,
};

const server = setupServer(http.get("*/api/v1/me", () => HttpResponse.json(me)));

beforeAll(() => server.listen());
afterAll(() => server.close());

function renderProfile(): void {
  const router = createMemoryRouter(
    [
      { path: "/profile", element: <ProfilePage /> },
      { path: "/login", element: <p>Вход</p> },
    ],
    { initialEntries: ["/profile"] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("ProfilePage", () => {
  it("renders the real user data in the two-card composition", async () => {
    renderProfile();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Профиль пользователя" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Данные пользователя")).toBeInTheDocument();
    expect(screen.getByText("Смена пароля")).toBeInTheDocument();
    // InfoField renders a label/value pair; assert the pair text.
    expect(screen.getByText("Фамилия и имя").nextElementSibling).toHaveTextContent("Иван");
    expect(screen.getByText("Роль").nextElementSibling).toHaveTextContent("Ветврач");
    expect(screen.getByText("Должность").nextElementSibling).toHaveTextContent("Ветеринарный врач");
    expect(screen.getByText("arrivals:read")).toBeInTheDocument();
    expect(screen.getByText("examination:create")).toBeInTheDocument();
    expect(screen.getByLabelText("Текущий пароль")).toBeInTheDocument();
  });

  it("never renders raw scope UUIDs as names", async () => {
    renderProfile();
    await waitFor(() => expect(screen.getByText("Смена пароля")).toBeInTheDocument());
    expect(screen.queryByText(new RegExp(LAB_ID))).toBeNull();
    expect(screen.queryByText(new RegExp(SPECIES_ID))).toBeNull();
    // The honest count summary instead of fabricated or raw identifiers.
    expect(screen.getByText("Области доступа").nextElementSibling).toHaveTextContent(
      "Лаборатории: 1 · Виды продукции: 1",
    );
  });

  it("the photo choice is a visual-only control", async () => {
    renderProfile();
    await waitFor(() => expect(screen.getByText("Смена пароля")).toBeInTheDocument());
    const input = screen.getByTestId("profile-photo-input");
    expect(input).toHaveAttribute("type", "file");
    // No upload/save endpoint: the control never navigates or posts anywhere.
    expect(input.closest("form")).toBeNull();
  });
});

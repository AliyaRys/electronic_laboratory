/**
 * Profile composition (DR4 §8) + DR33 (ТЗ §12.2/§12.3): capability tags
 * render Russian labels from the shared registry — no raw English codes for
 * known rights, the unknown code keeps the Russian fallback, the empty list
 * keeps «Прав не назначено.», and the translation changes no routes/actions.
 * InfoFields, security block and NO raw UUIDs rendered as names stay intact.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  // Real PERMISSION_MATRIX codes (ТЗ §12.2); examination:create is not an
  // actual action and was replaced by examination:create-complete.
  capabilities: ["arrivals:read", "arrivals:list", "examination:create-complete", "receipt:submit"],
  revision: 3,
};

const emptyMe = { ...me, capabilities: [] };

const unknownMe = { ...me, capabilities: ["arrivals:read", "future:right"] };

// HEAD-style long set from PERMISSION_MATRIX (ТЗ §12.3).
const headMe = {
  ...me,
  capabilities: [
    "profile:read",
    "password:change",
    "context:list",
    "operation:read",
    "arrivals:list",
    "arrivals:read",
    "arrivals:search",
    "arrivals:count",
    "arrivals:hide",
    "reconciliation:save",
    "vetis:sync",
    "receipt:submit",
    "receipt:reconcile",
    "examination:list",
    "examination:read",
    "examination:search",
    "examination:count",
    "examination:create-wait",
    "examination:create-complete",
    "examination:update",
    "examination:complete-waiting",
    "examination:delete",
    "conclusion:preview",
    "conclusion:pdf",
    "conclusion:print",
    "sample:read",
    "sample:collect",
    "sample:reuse",
    "sample:edit",
    "sample:dispose",
    "catalog:read",
    "catalog:create",
    "catalog:update",
    "catalog:delete",
    "catalog:bulk-price",
    "catalog:retry",
    "report:operational",
  ],
};

let response: object = me;
const server = setupServer(http.get("*/api/v1/me", () => HttpResponse.json(response)));

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
    expect(screen.getByLabelText("Текущий пароль")).toBeInTheDocument();
  });

  it("renders Russian labels from the registry for real matrix codes", async () => {
    renderProfile();
    await waitFor(() => expect(screen.getByText("Просмотр поступления")).toBeInTheDocument());
    expect(screen.getByText("Просмотр списка поступлений")).toBeInTheDocument();
    expect(screen.getByText("Создание и завершение ВСЭ")).toBeInTheDocument();
    expect(screen.getByText("Гашение и возврат входящего эВСД")).toBeInTheDocument();
    // Known rights are never visible as raw technical codes.
    expect(screen.queryByText("arrivals:read")).toBeNull();
    expect(screen.queryByText("examination:create-complete")).toBeNull();
    // Full names stay in the DOM/accessible name; the tooltip repeats them.
    for (const label of [
      "Просмотр поступления",
      "Просмотр списка поступлений",
      "Создание и завершение ВСЭ",
      "Гашение и возврат входящего эВСД",
    ]) {
      const tag = screen.getByText(label);
      expect(tag).toHaveAttribute("title", label);
    }
  });

  it("keeps «Прав не назначено.» for an empty capability list", async () => {
    response = emptyMe;
    renderProfile();
    await waitFor(() => expect(screen.getByText("Прав не назначено.")).toBeInTheDocument());
    response = me;
  });

  it("renders an unknown code as the Russian fallback with diagnostics", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    response = unknownMe;
    renderProfile();
    await waitFor(() => expect(screen.getByText("Неизвестное право доступа")).toBeInTheDocument());
    // The raw code is kept for diagnostics only, not as the visible name.
    const tag = screen.getByText("Неизвестное право доступа");
    expect(tag).toHaveAttribute("data-capability-code", "future:right");
    expect(tag).toHaveAttribute("title", "Неизвестное право доступа: future:right");
    expect(screen.getByText("Просмотр поступления")).toBeInTheDocument();
    response = me;
    warn.mockRestore();
  });

  it("renders a HEAD-sized set without losing any right", async () => {
    response = headMe;
    renderProfile();
    await waitFor(() => expect(screen.getByText("Просмотр списка ВСЭ")).toBeInTheDocument());
    // 37 distinct labels = 37 tags; the container keeps wrapping and the
    // truncation is visual-only via the CSS rule (jsdom does not apply real
    // stylesheets, so assert the rule source; computed styles are checked
    // live in the browser at 1440/1024/768/390).
    const container = screen.getByText("Просмотр списка ВСЭ").closest(".vse-profile-rights");
    expect(container?.children.length).toBe(headMe.capabilities.length);
    const css = readFileSync(resolve(__dirname, "../features/identity/identity.css"), "utf8");
    const rule = css.match(/\.vse-profile-right-tag \{[^}]*\}/);
    expect(rule?.[0]).toContain("white-space: nowrap");
    expect(rule?.[0]).toContain("text-overflow: ellipsis");
    expect(rule?.[0]).toContain("max-width");
    response = me;
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

  it("the translation changes no routes or available actions", async () => {
    renderProfile();
    await waitFor(() => expect(screen.getByText("Смена пароля")).toBeInTheDocument());
    // Only presentation changed: the profile still renders on /profile with
    // the same password form and no new navigation targets.
    expect(screen.getByRole("heading", { name: "Профиль пользователя" })).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("DR50: the login is displayed exactly once", () => {
  it("renders the login only inside the field labelled «Логин»", async () => {
    renderProfile();
    await waitFor(() => expect(screen.getByLabelText("Логин")).toHaveTextContent("vet.longname"));
    const occurrences = (document.body.textContent ?? "").split("vet.longname").length - 1;
    expect(occurrences).toBe(1);
  });
});

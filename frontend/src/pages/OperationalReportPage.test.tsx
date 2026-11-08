/**
 * OperationalReportPage tests (R03, SC-076–079): the period is chosen by the
 * user and drives only the indicators; the sample balances are the CURRENT
 * remainders and never react to the period filter (R01 semantics); VET gets
 * the forbidden state (AT-20).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { OperationalReportPage } from "./OperationalReportPage";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function me(role = "HEAD"): Record<string, unknown> {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    full_name: "Тестовый пользователь",
    login: "tester",
    email: "tester@example.test",
    position: null,
    role,
    active: true,
    scopes: [{ laboratory_id: LAB, product_scope_id: null }],
    capabilities: [],
    revision: 1,
  };
}

const operational = {
  processed_parties: 7,
  product_identifications: 12,
  transport_inspections: 3,
  current_sample_balances: [{ product_species_id: "говядина", mass_kg: "12.6", revision: 2 }],
  period: { date_from: "2026-10-01T00:00:00Z", date_to: "2026-11-01T00:00:00Z" },
};

function renderPage(initial = `/labs/${LAB}/reports/operational`): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/labs/:labId/reports/operational" element={<OperationalReportPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OperationalReportPage", () => {
  it("shows the three indicators and the CURRENT balances of a period", async () => {
    const gets: URL[] = [];
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me())),
      http.get("*/api/v1/reports/operational", ({ request }) => {
        gets.push(new URL(request.url));
        return HttpResponse.json(operational);
      }),
    );
    renderPage();
    expect(await screen.findByText("12")).toBeVisible();
    expect(screen.getByText("7")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("говядина")).toBeVisible();
    expect(screen.getByText("12.6")).toBeVisible();
    // The balances GET carries the same query but the semantics are current-only.
    expect(gets[0]?.searchParams.get("laboratory_id")).toBe(LAB);
  });

  it("applying a new period re-queries only the operational view", async () => {
    const user = userEvent.setup();
    const gets: URL[] = [];
    server.use(
      http.get("*/api/v1/me", () => HttpResponse.json(me())),
      http.get("*/api/v1/reports/operational", ({ request }) => {
        gets.push(new URL(request.url));
        return HttpResponse.json(operational);
      }),
    );
    renderPage();
    await screen.findByText("12");
    fireEvent.change(screen.getByLabelText("С даты"), { target: { value: "2026-01-01" } });
    await user.click(screen.getByRole("button", { name: "Применить период" }));
    expect(gets).toHaveLength(2);
    expect(gets[1]?.searchParams.get("date_from")).toBe("2026-01-01");
  });

  it("VET gets the forbidden state (AT-20: врач видит только пробы)", async () => {
    server.use(http.get("*/api/v1/me", () => HttpResponse.json(me("VET"))));
    renderPage();
    expect(await screen.findByText("Раздел доступен только заведующему и аналитику.")).toBeVisible();
  });
});

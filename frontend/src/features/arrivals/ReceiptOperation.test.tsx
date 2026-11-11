import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ReceiptOperation } from "./ReceiptOperation";
import type { IncomingView, ReconciliationView } from "./api";

const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";
const LAB = "11111111-2222-4333-8444-555555555555";

const party = {
  party_id: PARTY,
  laboratory_id: LAB,
  external: { fields: { documentUuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac" } },
  confirmation: null,
} as unknown as IncomingView;

const reconciliation = {
  revision: 3,
  state: "OPEN",
  decision: "ACCEPT_ALL",
  complete: true,
  route: "EXAMINATION",
  delivered: { mass_kg: "120", quantity: "4", unit_id: "u" },
  accepted: { mass_kg: "120", quantity: "4", unit_id: "u" },
  returned: { mass_kg: "0", quantity: "0", unit_id: "u" },
} as ReconciliationView;

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderOperation(view: ReconciliationView = reconciliation): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReceiptOperation party={party} reconciliation={view} />
    </QueryClientProvider>,
  );
}

describe("ReceiptOperation", () => {
  it("explains the disabled installation and never offers submit", async () => {
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}/receipt-context`, () =>
        HttpResponse.json({
          write_enabled: false,
          source_revision: 7,
          reconciliation_revision: 3,
          operation_id: null,
          operation_state: null,
        }),
      ),
    );
    renderOperation();
    expect(await screen.findByText("Гашение не включено оператором")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Подготовить гашение" })).toBeNull();
  });

  it("previews first and submits exactly once after explicit confirmation", async () => {
    let submits = 0;
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}/receipt-context`, () =>
        HttpResponse.json({
          write_enabled: true,
          source_revision: 7,
          reconciliation_revision: 3,
          operation_id: null,
          operation_state: null,
        }),
      ),
      http.post(`*/api/v1/arrivals/${PARTY}/receipt-preview`, () =>
        HttpResponse.json({
          intent: { decision: "ACCEPT_ALL", vet_inspection: "CORRESPONDS" },
          application_xml: "<application />",
          fingerprint: "a".repeat(64),
        }),
      ),
      http.post(`*/api/v1/arrivals/${PARTY}/receipt`, () => {
        submits += 1;
        return HttpResponse.json(
          {
            operation_id: "aaaaaaaa-0000-4000-8000-000000000001",
            state: "QUEUED",
            status_url: "/api/v1/operations/x",
          },
          { status: 202 },
        );
      }),
    );
    renderOperation();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Результат ветеринарного осмотра"), "CORRESPONDS");
    await user.click(screen.getByRole("button", { name: "Подготовить гашение" }));
    expect(await screen.findByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Погасить эВСД" }));
    expect(submits).toBe(1);
  });

  it("does not open a local VSE after a confirmed full return", async () => {
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}/receipt-context`, () =>
        HttpResponse.json({
          write_enabled: true,
          source_revision: 7,
          reconciliation_revision: 3,
          operation_id: "aaaaaaaa-0000-4000-8000-000000000001",
          operation_state: "CONFIRMED",
        }),
      ),
      http.get("*/api/v1/operations/*", () =>
        HttpResponse.json({ id: "op", kind: "vetis.receipt", state: "CONFIRMED" }),
      ),
    );
    renderOperation({ ...reconciliation, decision: "RETURN_ALL", route: "NONE" });
    expect(await screen.findByText("Гашение подтверждено ВетИС")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Создать ВСЭ" })).toBeNull();
  });
});

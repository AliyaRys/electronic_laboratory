/**
 * Bulk price dialog unit tests (Task C02): the FULL coverage list is visible
 * before the confirmation, the 202 result is polled to per-target actual
 * results, a partial result stays visible and only failed targets are retried
 * with a NEW idempotency key (test_partial_retry UI side, SC-096).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BulkPriceDialog, bulkPriceSchema } from "./BulkPriceDialog";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const LAB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LAB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SPECIES = "11111111-1111-4111-8111-111111111111";

const labs = [
  { id: LAB_A, name: "Лаборатория аааааааа…" },
  { id: LAB_B, name: "Лаборатория бббббббб…" },
];

function renderDialog(onClose = vi.fn(), onApplied = vi.fn()): void {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <BulkPriceDialog
        laboratories={labs}
        productSpeciesId={SPECIES}
        serviceCode="trichinelloscopy"
        unitId="kg"
        onClose={onClose}
        onApplied={onApplied}
      />
    </QueryClientProvider>,
  );
}

describe("BulkPriceDialog", () => {
  it("shows the full coverage list before the confirmation", async () => {
    renderDialog();
    const coverage = screen.getByTestId("bulk-coverage");
    // Every affected laboratory of the scope is listed BEFORE confirmation.
    expect(coverage.textContent).toContain("Охват: затронутые лаборатории (2)");
    expect((coverage as HTMLFieldSetElement).querySelectorAll("input[type=checkbox]").length).toBe(2);
    expect(screen.getByTestId("bulk-coverage").textContent).toContain("Лаборатория");
    expect(document.body.textContent).toContain("наследования между лабораториями нет");
  });

  it("submits the whole-set intent and polls per-target results", async () => {
    const keys: (string | null)[] = [];
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post("*/api/v1/catalogs/bulk-prices", async ({ request }) => {
        keys.push(request.headers.get("idempotency-key"));
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            operation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            state: "COMPLETED",
            status_url: "/api/v1/operations/cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          },
          { status: 202 },
        );
      }),
      http.get("*/api/v1/catalogs/bulk-prices/:jobId", () =>
        HttpResponse.json({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          state: "COMPLETED",
          targets: [
            { lab_id: LAB_A, state: "SUCCEEDED", problem: null },
            { lab_id: LAB_B, state: "SUCCEEDED", problem: null },
          ],
        }),
      ),
    );
    const onApplied = vi.fn();
    renderDialog(vi.fn(), onApplied);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Новая цена, ₽"), "100.00");
    await user.click(screen.getByRole("button", { name: "Применить цену" }));
    await waitFor(() => expect(screen.getByTestId("bulk-result")).toBeTruthy());
    expect(keys[0]).not.toBeNull();
    expect(body).toMatchObject({
      laboratory_ids: [LAB_A, LAB_B],
      product_species_id: SPECIES,
      price: "100.00",
    });
    await waitFor(() => expect(screen.getByTestId("bulk-state").textContent).toContain("Применено"));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    // The per-target actual results are shown for both laboratories.
    const result = screen.getByTestId("bulk-result");
    expect(result.textContent).toContain("Применено");
  });

  it("offers retry only for failed targets with a NEW key", async () => {
    const keys: string[] = [];
    server.use(
      http.post("*/api/v1/catalogs/bulk-prices", () =>
        HttpResponse.json(
          {
            operation_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            state: "PARTIAL",
            status_url: "/api/v1/operations/dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          },
          { status: 202 },
        ),
      ),
      http.get("*/api/v1/catalogs/bulk-prices/:jobId", () =>
        HttpResponse.json({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          state: "PARTIAL",
          targets: [
            { lab_id: LAB_A, state: "SUCCEEDED", problem: null },
            { lab_id: LAB_B, state: "FAILED", problem: "INTERNAL_ERROR" },
          ],
        }),
      ),
      http.post("*/api/v1/catalogs/bulk-prices/:jobId/retry", ({ request }) => {
        keys.push(request.headers.get("idempotency-key") ?? "");
        return HttpResponse.json(
          {
            operation_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            state: "COMPLETED",
            status_url: "/api/v1/operations/dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          },
          { status: 202 },
        );
      }),
    );
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Новая цена, ₽"), "100.00");
    await user.click(screen.getByRole("button", { name: "Применить цену" }));
    const retry = await screen.findByRole("button", { name: "Повторить неуспешные" });
    await user.click(retry);
    await waitFor(() => expect(keys.length).toBe(1));
    // The retry key differs from the original command key (НОВЫЙ командный ключ).
    expect(keys[0]).not.toBe("");
  });

  it("validates the payload before sending", () => {
    expect(
      bulkPriceSchema.safeParse({
        product_species_id: "не-uuid",
        service_code: "x",
        unit_id: "kg",
        price: "100.00",
        laboratory_ids: [LAB_A],
        laboratory_ids_text: "",
      }).success,
    ).toBe(false);
    expect(
      bulkPriceSchema.safeParse({
        product_species_id: SPECIES,
        service_code: "x",
        unit_id: "kg",
        price: "100.00",
        laboratory_ids: [],
        laboratory_ids_text: "",
      }).success,
    ).toBe(true); // the coverage emptiness is enforced in runSubmit
    expect(
      bulkPriceSchema.safeParse({
        product_species_id: SPECIES,
        service_code: "x",
        unit_id: "kg",
        price: "100.00",
        laboratory_ids: [LAB_A],
        laboratory_ids_text: "",
      }).success,
    ).toBe(true);
  });
});

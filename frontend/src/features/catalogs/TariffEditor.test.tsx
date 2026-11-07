/**
 * Tariff editor unit tests (Task C02): scale-2 money validation, create with
 * an idempotency key and If-Match guarded update/delete.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TariffEditor, tariffEditorSchema } from "./TariffEditor";
import type { TariffView } from "./api";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const LAB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SPECIES = "11111111-1111-4111-8111-111111111111";

const TARIFF: TariffView = {
  id: "55555555-5555-5555-8555-555555555555",
  laboratory_id: LAB,
  product_species_id: SPECIES,
  service_code: "trichinelloscopy",
  unit_id: "kg",
  price: "100.00",
  version: 1,
  source: { name: "прейскурант" },
  revision: 1,
};

const base = {
  laboratoryId: LAB,
  productSpeciesId: SPECIES,
  onSaved: () => undefined,
  onClose: () => undefined,
};

describe("TariffEditor", () => {
  it("creates a tariff with a scale-2 price and idempotency key", async () => {
    const headersSeen: (string | null)[] = [];
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post("*/api/v1/catalogs/tariffs", async ({ request }) => {
        headersSeen.push(request.headers.get("idempotency-key"));
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...TARIFF, price: "0.01" }, { status: 201 });
      }),
    );
    const onSaved = vi.fn();
    render(<TariffEditor mode="create" {...base} onSaved={onSaved} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Код услуги"), "trichinelloscopy");
    await user.type(screen.getByLabelText("Единица измерения"), "kg");
    await user.type(screen.getByLabelText("Цена, ₽"), "0.01");
    await user.type(screen.getByLabelText("Версия прейскуранта"), "1");
    await user.type(screen.getByLabelText("Источник прейскуранта"), "прейскурант");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(headersSeen[0]).not.toBeNull();
    expect(body).toMatchObject({ price: "0.01", service_code: "trichinelloscopy" });
  });

  it("rejects a negative or over-precise price", () => {
    expect(tariffEditorSchema.safeParse({ ...tariffEditorSchema, ...{} }).success).toBe(false);
    for (const bad of ["-1.00", "1.001", "1e2", "", "1,5"]) {
      const parsed = tariffEditorSchema.safeParse({
        service_code: "x",
        unit_id: "kg",
        price: bad,
        version: "1",
        source_name: "прейскурант",
      });
      expect(parsed.success).toBe(false);
    }
    expect(
      tariffEditorSchema.safeParse({
        service_code: "x",
        unit_id: "kg",
        price: "150.00",
        version: "1",
        source_name: "прейскурант",
      }).success,
    ).toBe(true);
  });

  it("updates with If-Match and binds conflicts", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.put("*/api/v1/catalogs/tariffs/:tariffId", async ({ request }) => {
        seen.push(request.headers.get("if-match"));
        return HttpResponse.json(
          {
            type: "about:blank",
            title: "REVISION_CONFLICT",
            status: 409,
            detail: "Запись изменена другим пользователем.",
            code: "REVISION_CONFLICT",
            errors: [],
          },
          { status: 409, headers: { "content-type": "application/problem+json" } },
        );
      }),
    );
    render(<TariffEditor mode="edit" tariff={TARIFF} {...base} onSaved={() => undefined} />);
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Цена, ₽"));
    await user.type(screen.getByLabelText("Цена, ₽"), "150.00");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(seen[0]).toBe('"1"'));
    await screen.findByText("Запись изменена другим пользователем.");
  });

  it("deletes with If-Match after confirmation", async () => {
    server.use(
      http.delete("*/api/v1/catalogs/tariffs/:tariffId", ({ request }) => {
        expect(request.headers.get("if-match")).toBe('"1"');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const onDeleted = vi.fn();
    render(<TariffEditor mode="edit" tariff={TARIFF} {...base} onDeleted={onDeleted} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Удалить" }));
    await user.click(await screen.findByRole("button", { name: "Удалить тариф" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });
});

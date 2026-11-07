/**
 * Method editor unit tests (Task C02): the acceptance-named UI test —
 * deleting a rule warns that future saves become blocked and the old pricing
 * snapshot stays unchanged — plus create with an idempotency key and If-Match
 * guarded update.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MethodEditor, DELETE_WARNING, methodEditorDefaults, methodEditorSchema } from "./MethodEditor";
import { typedMethodRule, type MethodRuleTyped } from "./api";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const LAB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SPECIES = "11111111-1111-4111-8111-111111111111";
const INDICATOR = "22222222-2222-4222-8222-222222222222";
const STATE = "33333333-3333-4333-8333-333333333333";

const RULE: MethodRuleTyped = {
  ...typedMethodRule({
    id: "44444444-4444-4444-8444-444444444444",
    laboratory_id: LAB,
    product_species_id: SPECIES,
    product_state_id: STATE,
    indicator_id: INDICATOR,
    version: 1,
    result_schema: "DECIMAL",
    unit_id: "kg",
    rule: {},
    source: { name: "методика", edition: "2023" },
    active: true,
    revision: 1,
  }),
};

const base = {
  laboratoryId: LAB,
  productSpeciesId: SPECIES,
  onSaved: () => undefined,
  onClose: () => undefined,
};

describe("MethodEditor", () => {
  it("creates a rule with an idempotency key", async () => {
    const headersSeen: (string | null)[] = [];
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post("*/api/v1/catalogs/methods", async ({ request }) => {
        headersSeen.push(request.headers.get("idempotency-key"));
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...RULE, id: "55555555-5555-5555-8555-555555555555" }, { status: 201 });
      }),
    );
    const onSaved = vi.fn();
    render(<MethodEditor mode="create" {...base} onSaved={onSaved} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Показатель (UUID)"), INDICATOR);
    await user.type(screen.getByLabelText("Состояние продукции (UUID)"), STATE);
    await user.type(screen.getByLabelText("Единица измерения нормы"), "kg");
    await user.type(screen.getByLabelText("Нижняя граница"), "0");
    await user.type(screen.getByLabelText("Верхняя граница"), "14");
    await user.type(screen.getByLabelText("Версия"), "1");
    await user.type(screen.getByLabelText("Источник методики"), "методика");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(headersSeen[0]).not.toBeNull();
    expect(body).toMatchObject({
      laboratory_id: LAB,
      product_species_id: SPECIES,
      indicator_id: INDICATOR,
      result_schema: "DECIMAL",
      unit_id: "kg",
      rule: { type: "interval", lower: "0", upper: "14" },
      source: { name: "методика" },
    });
  });

  it("warns on deleting an active rule: future saves blocked, old snapshot stays", async () => {
    server.use(
      http.delete("*/api/v1/catalogs/methods/:ruleId", ({ request }) => {
        // The delete is If-Match guarded and idempotent (API-01/SPEC-04).
        expect(request.headers.get("if-match")).toBe('"1"');
        expect(request.headers.get("idempotency-key")).not.toBeNull();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    render(<MethodEditor mode="edit" rule={RULE} {...base} onDeleted={onDeleted} onClose={onClose} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Удалить" }));

    // The acceptance warning is explicit and complete.
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("заблокирует сохранение будущих расчётов");
    expect(dialog.textContent).toContain("Старый снимок цен останется прежним");
    expect(DELETE_WARNING).toContain("не пересчитываются");

    // Cancel keeps everything in place; confirm performs the guarded delete.
    await user.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onDeleted).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Удалить" }));
    await user.click(await screen.findByRole("button", { name: "Удалить норму" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalled();
  });

  it("updates with If-Match of the record revision", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.put("*/api/v1/catalogs/methods/:ruleId", async ({ request }) => {
        seen.push(request.headers.get("if-match"));
        return HttpResponse.json({ ...RULE, revision: 2, unit_id: "piece" }, { status: 200 });
      }),
    );
    const onSaved = vi.fn();
    render(<MethodEditor mode="edit" rule={RULE} {...base} onSaved={onSaved} />);
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Единица измерения нормы"));
    await user.type(screen.getByLabelText("Единица измерения нормы"), "piece");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(seen[0]).toBe('"1"');
  });

  it("rejects an inverted interval and a bad uuid client-side", () => {
    const parsed = methodEditorSchema.safeParse({
      ...methodEditorDefaults(),
      indicator_id: "не-uuid",
      unit_id: "kg",
      rule_type: "interval",
      lower: "10",
      upper: "5",
      version: "1",
      source_name: "методика",
    });
    expect(parsed.success).toBe(false);
  });
});

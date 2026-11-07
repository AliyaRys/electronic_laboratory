/**
 * Check service editor unit tests (Task C02): only the two CHECK codes, at
 * least one applicable decision, create/update paths.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CheckServiceEditor, checkServiceSchema } from "./CheckServiceEditor";
import type { CheckServiceRuleView } from "./api";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const RULE: CheckServiceRuleView = {
  id: "66666666-6666-6666-8666-666666666666",
  service_code: "PRODUCT_IDENTIFICATION",
  unit_id: "piece",
  multiplier_basis: "ONE_SERVICE",
  applicable_decisions: ["ACCEPT_ALL"],
  version: 1,
  source: { name: "правило" },
  revision: 1,
};

describe("CheckServiceEditor", () => {
  it("creates a rule with the applicable decisions", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post("*/api/v1/catalogs/check-services", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(RULE, { status: 201 });
      }),
    );
    const onSaved = vi.fn();
    render(<CheckServiceEditor mode="create" onSaved={onSaved} onClose={() => undefined} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Единица измерения"), "piece");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(body).toMatchObject({
      service_code: "PRODUCT_IDENTIFICATION",
      multiplier_basis: "ONE_SERVICE",
      applicable_decisions: ["ACCEPT_ALL"],
    });
  });

  it("requires at least one applicable decision", () => {
    const parsed = checkServiceSchema.safeParse({
      service_code: "PRODUCT_IDENTIFICATION",
      unit_id: "piece",
      multiplier_basis: "ONE_SERVICE",
      applicable_decisions: [],
      version: "1",
      source_name: "правило",
    });
    expect(parsed.success).toBe(false);
  });

  it("updates with If-Match", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.put("*/api/v1/catalogs/check-services/:ruleId", async ({ request }) => {
        seen.push(request.headers.get("if-match"));
        return HttpResponse.json({ ...RULE, revision: 2 }, { status: 200 });
      }),
    );
    const onSaved = vi.fn();
    render(<CheckServiceEditor mode="edit" rule={RULE} onSaved={onSaved} onClose={() => undefined} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(seen[0]).toBe('"1"');
  });
});

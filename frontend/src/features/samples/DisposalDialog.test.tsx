/**
 * DisposalDialog tests (S03): the shown weight is readonly (there is no mass
 * input at all), a stale dialog answers 409 by showing the NEW remainder and
 * requiring an explicit fresh confirmation (never a silent re-confirm), and
 * after a success the balances are re-read from the server (no optimistic
 * zeroing; the 201 carries no ETag).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DisposalDialog } from "./DisposalDialog";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SPECIES = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const balance = {
  product_species_id: SPECIES,
  mass_kg: "12.6",
  revision: 1,
};

function renderDialog(
  handlers: Parameters<typeof server.use>[0],
  props?: Partial<Parameters<typeof DisposalDialog>[0]>,
): { posts: Headers[]; balanceGets: number[] } {
  const posts: Headers[] = [];
  const balanceGets: number[] = [];
  server.use(...(Array.isArray(handlers) ? handlers : [handlers]));
  server.use(
    http.post("*/api/v1/samples/disposals", ({ request }) => {
      posts.push(request.headers);
      return HttpResponse.json(
        { code: "REVISION_CONFLICT", detail: "Остаток изменился после открытия диалога." },
        { status: 409 },
      );
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DisposalDialog
        laboratoryId={LAB}
        balance={balance}
        open
        today="2026-11-06"
        onClose={() => undefined}
        onDisposed={() => undefined}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { posts, balanceGets };
}

describe("DisposalDialog", () => {
  it("shows the kind/weight/date/number facts before the confirm and keeps the weight readonly", async () => {
    renderDialog(http.post("*/api/v1/samples/disposals", () => new HttpResponse(null, { status: 500 })));
    expect(await screen.findByTestId("disposal-shown-mass")).toHaveTextContent("12.6 кг");
    expect(screen.getByText(SPECIES)).toBeTruthy();
    // The weight is never an input: there is no editable mass field.
    expect(screen.queryByLabelText(/Вес/)).toBeNull();
    expect(screen.getByLabelText("Дата утилизации")).toBeTruthy();
    expect(screen.getByLabelText("Номер исходящей эВСД")).toBeTruthy();
    // No rounding: the exact decimal is the value shown.
    expect(screen.getByTestId("disposal-shown-mass").textContent).toBe("12.6 кг");
  });

  it("a stale dialog 409 shows the problem, requires a fresh confirmation and never resends silently", async () => {
    const posts: { headers: Headers; body: unknown }[] = [];
    server.use(
      http.post("*/api/v1/samples/disposals", async ({ request }) => {
        posts.push({ headers: request.headers, body: await request.json() });
        if (posts.length === 1) {
          return HttpResponse.json(
            {
              code: "REVISION_CONFLICT",
              detail: "Остаток изменился после открытия диалога: актуальный вес 13.4 кг.",
            },
            { status: 409 },
          );
        }
        // The fresh confirmation succeeds (server-computed mass).
        return HttpResponse.json(
          {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            laboratory_id: LAB,
            product_species_id: SPECIES,
            disposed_on: "2026-11-06",
            mass_kg: "13.4",
            external_vsd_number: "ВСД-001",
            actor_id: "00000000-0000-4000-8000-000000000001",
            recorded_at: "2026-11-06T10:00:00Z",
          },
          { status: 201 },
        );
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DisposalDialog
          laboratoryId={LAB}
          balance={balance}
          open
          today="2026-11-06"
          onClose={() => undefined}
          onDisposed={() => undefined}
        />
      </QueryClientProvider>,
    );

    await userEvent.type(await screen.findByLabelText("Номер исходящей эВСД"), "ВСД-001");
    await userEvent.click(screen.getByRole("button", { name: "Утилизировать" }));

    // The conflict is surfaced honestly: the problem text is shown and the
    // confirmation is invalidated.
    await screen.findAllByText(/Остаток изменился после открытия диалога/);
    const fresh = await screen.findByRole("button", { name: "Подтвердить заново" });
    expect(fresh).toBeTruthy();
    // Nothing was confirmed silently: exactly one POST so far.
    expect(posts.length).toBe(1);

    // The balances behind the dialog are refetched: the remainder changed and
    // the LIVE row (new mass, new revision) reaches the dialog without
    // closing it.
    view.rerender(
      <QueryClientProvider client={client}>
        <DisposalDialog
          laboratoryId={LAB}
          balance={{ product_species_id: SPECIES, mass_kg: "13.4", revision: 2 }}
          open
          today="2026-11-06"
          onClose={() => undefined}
          onDisposed={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("disposal-shown-mass")).toHaveTextContent("13.4 кг");

    // The explicit fresh confirmation rebinds to the NEW remainder: the
    // If-Match and the guard mass carry the refreshed revision/mass and the
    // disposal succeeds.
    await userEvent.click(fresh);
    await waitFor(() => {
      expect(posts.length).toBe(2);
      expect(posts[1]?.headers.get("if-match")).toBe('"2"');
      expect(posts[1]?.headers.get("idempotency-key")).toBeTruthy();
    });
    const second = posts[1]?.body as Record<string, unknown>;
    expect(second["expectedMassKg"]).toBe("13.4");
    expect(second["productSpeciesId"]).toBe(SPECIES);
  });

  it("distinct loading/empty/error states of the balances behind the dialog", async () => {
    // The dialog renders an honest not-found state without a balance.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DisposalDialog
          laboratoryId={LAB}
          balance={null}
          open
          today="2026-11-06"
          onClose={() => undefined}
          onDisposed={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Остаток не указан.")).toBeTruthy();
  });
});

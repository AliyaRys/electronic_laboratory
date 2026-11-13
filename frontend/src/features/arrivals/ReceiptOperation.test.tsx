import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
  // ТЗ DR9 §6: a direct read of a stale document blocks the repeat гашение.
  it("a stale document shows the exact DR9 text and offers no submit", async () => {
    const staleParty = { ...party, source_presence: "NOT_IN_CURRENT_CONFIRMED_LIST" } as IncomingView;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ReceiptOperation party={staleParty} reconciliation={reconciliation} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("ВСД больше не входит в текущую очередь оформленных документов."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Подготовить гашение" })).toBeNull();
  });

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

  it("demands the return date for return decisions and sends it once", async () => {
    const bodies: { return_date?: string | null; issue_date?: string; fingerprint?: string }[] = [];
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
      http.post(`*/api/v1/arrivals/${PARTY}/receipt-preview`, async ({ request }) => {
        const body = (await request.json()) as { return_date?: string; issue_date?: string };
        bodies.push(body);
        return HttpResponse.json({
          intent: {
            decision: "RETURN_ALL",
            vet_inspection: "CORRESPONDS",
            issue_date: "2026-11-09T09:00:00Z",
            return_date: body.return_date ?? null,
            source_revision: 7,
            reconciliation_revision: 3,
            discrepancy_items: [],
            unit_id: "u",
          },
          application_xml: "<application />",
          fingerprint: "b".repeat(64),
        });
      }),
      http.post(`*/api/v1/arrivals/${PARTY}/receipt`, async ({ request }) => {
        bodies.push(
          (await request.json()) as { return_date?: string; issue_date?: string; fingerprint?: string },
        );
        return HttpResponse.json(
          { operation_id: "aaaaaaaa-0000-4000-8000-000000000002", state: "QUEUED", status_url: "/x" },
          { status: 202 },
        );
      }),
    );
    renderOperation({ ...reconciliation, decision: "RETURN_ALL", route: "NONE" });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Результат ветеринарного осмотра"), "CORRESPONDS");
    const returnInput = await screen.findByLabelText("Дата и время возврата");
    // Без даты возврата кнопка остаётся заблокированной (ТЗ DR8 §9).
    expect(screen.getByRole("button", { name: "Подготовить гашение" })).toBeDisabled();
    await user.type(returnInput, "2026-11-11T12:30");
    await user.click(screen.getByRole("button", { name: "Подготовить гашение" }));
    expect(await screen.findByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeInTheDocument();
    expect(bodies[0]?.return_date).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Погасить эВСД" }));
    await waitFor(() => expect(bodies.length).toBe(2));
    // Один frozen intent: дата возврата и отпечаток совпадают в preview и submit.
    expect(bodies[1]?.return_date).toBe(bodies[0]?.return_date);
    expect(bodies[1]?.issue_date).toBe("2026-11-09T09:00:00Z");
    expect(bodies[1]?.fingerprint).toBe("b".repeat(64));
  });

  it("shows the §9 summary facts in the confirmation dialog", async () => {
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
          intent: {
            decision: "ACCEPT_ALL",
            vet_inspection: "CORRESPONDS",
            doc_inspection: "CORRESPONDS",
            issue_date: "2026-11-09T09:00:00Z",
            delivery_date: "2026-11-11T08:00:00Z",
            source_revision: 7,
            reconciliation_revision: 3,
            discrepancy_items: [],
            unit_id: "u",
          },
          application_xml: "<application />",
          fingerprint: "c".repeat(64),
        }),
      ),
    );
    renderOperation();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Результат ветеринарного осмотра"), "CORRESPONDS");
    await user.click(screen.getByRole("button", { name: "Подготовить гашение" }));
    const dialog = await screen.findByRole("dialog", { name: "Подтвердите гашение эВСД" });
    expect(dialog.textContent).toContain("Ревизия источника / сверки");
    expect(dialog.textContent).toContain("Дата поступления");
    // ТЗ DR24 §6: the technical unit GUID is hidden from the visible summary.
    expect(dialog.textContent).not.toContain("Единица измерения");
    expect(dialog.textContent).not.toContain("GUID:");
    expect(dialog.textContent).toContain("Осмотры");
    expect(dialog.textContent).toContain("Маршрут после гашения");
  });

  // ТЗ DR10 §8-4: «Подготовить гашение» is never blocked by an absent unit
  // NAME — only the canonical GUID identity matters.
  it("prepares гашение when the unit GUID exists without a name", async () => {
    const UNIT_GUID = "21ed96c9-337b-4a27-8761-c6e6ad3c9f5b";
    const partyGuidOnly = {
      ...party,
      documentary: { mass_kg: "100", quantity: "4", unit_id: UNIT_GUID },
      classification: { product: { id: null, name: "Мясо" }, unit: { id: UNIT_GUID, name: null } },
    } as unknown as IncomingView;
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
          intent: {
            decision: "ACCEPT_ALL",
            vet_inspection: "CORRESPONDS",
            doc_inspection: "CORRESPONDS",
            issue_date: "2026-11-09T09:00:00Z",
            delivery_date: "2026-11-11T08:00:00Z",
            source_revision: 7,
            reconciliation_revision: 3,
            discrepancy_items: [],
            unit_id: UNIT_GUID,
          },
          application_xml: "<application />",
          fingerprint: "d".repeat(64),
        }),
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ReceiptOperation party={partyGuidOnly} reconciliation={reconciliation} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Результат ветеринарного осмотра"), "CORRESPONDS");
    await user.click(screen.getByRole("button", { name: "Подготовить гашение" }));
    const dialog = await screen.findByRole("dialog", { name: "Подтвердите гашение эВСД" });
    // ТЗ DR24 §6: the summary never shows the technical GUID — the absent
    // NAME no longer blocks гашение (the honest mass/мест rows stay).
    expect(dialog.textContent).not.toContain("GUID:");
    expect(dialog.textContent).not.toContain(UNIT_GUID);
  });
});

// --- ТЗ DR27 §7: the receipt context refresh and frozen-preview contract -------

interface PreviewBody {
  source_revision?: number;
  reconciliation_revision?: number;
  return_date?: string | null;
}
interface SubmitBody {
  source_revision?: number;
  reconciliation_revision?: number;
  issue_date?: string;
  fingerprint?: string;
}

const DR27_PREVIEW_INTENT = {
  decision: "ACCEPT_ALL",
  vet_inspection: "CORRESPONDS",
  doc_inspection: "CORRESPONDS",
  discrepancy_items: [],
  unit_id: "u",
};

function contextJson(source_revision: number, reconciliation_revision: number): Record<string, unknown> {
  return {
    write_enabled: true,
    source_revision,
    reconciliation_revision,
    operation_id: null,
    operation_state: null,
  };
}

describe("ТЗ DR27: receipt context refresh", () => {
  it("prepare() re-reads the context and continues once after a stale cached context (§4.2)", async () => {
    let contextGets = 0;
    const previews: PreviewBody[] = [];
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}/receipt-context`, () => {
        contextGets += 1;
        // Mount = stale (2). The first prepare GET is STILL stale; exactly
        // one automatic refetch then returns the saved revision 3.
        const reconciliation_revision = contextGets >= 3 ? 3 : 2;
        return HttpResponse.json(contextJson(7, reconciliation_revision));
      }),
      http.post(`*/api/v1/arrivals/${PARTY}/receipt-preview`, async ({ request }) => {
        previews.push((await request.json()) as PreviewBody);
        return HttpResponse.json({
          intent: { ...DR27_PREVIEW_INTENT, source_revision: 7, reconciliation_revision: 3 },
          application_xml: "<application />",
          fingerprint: "e".repeat(64),
        });
      }),
    );
    renderOperation();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Результат ветеринарного осмотра"), "CORRESPONDS");
    await user.click(screen.getByRole("button", { name: "Подготовить гашение" }));
    expect(await screen.findByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeInTheDocument();
    // Mount + fresh GET + ONE automatic refetch of the stale cached context.
    expect(contextGets).toBe(3);
    expect(previews[0]?.reconciliation_revision).toBe(3);
    expect(previews[0]?.source_revision).toBe(7);
  });

  it("a context that disagrees with the displayed reconciliation blocks the preview, re-reads everything and keeps the input (§4.2)", async () => {
    let contextGets = 0;
    let previews = 0;
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}/receipt-context`, () => {
        contextGets += 1;
        return HttpResponse.json(contextJson(7, 2));
      }),
      http.post(`*/api/v1/arrivals/${PARTY}/receipt-preview`, () => {
        previews += 1;
        return HttpResponse.json({ intent: {}, application_xml: "<a/>", fingerprint: "0".repeat(64) });
      }),
    );
    renderOperation();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Результат ветеринарного осмотра"), "CORRESPONDS");
    await user.click(screen.getByRole("button", { name: "Подготовить гашение" }));
    expect(
      await screen.findByText("Сверка обновилась. Проверьте данные и сохраните сверку заново"),
    ).toBeInTheDocument();
    // No stale preview is ever sent; the automatic refetch happened once.
    expect(previews).toBe(0);
    expect(contextGets).toBeGreaterThanOrEqual(3);
    // The user input survives the refresh — nothing was auto-cleared.
    expect((screen.getByLabelText("Результат ветеринарного осмотра") as HTMLSelectElement).value).toBe(
      "CORRESPONDS",
    );
    expect(screen.queryByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeNull();
  });

  it("confirm() takes revisions, dates and fingerprint from the frozen preview, never the context (§4.3)", async () => {
    let contextGets = 0;
    const submits: SubmitBody[] = [];
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}/receipt-context`, () => {
        contextGets += 1;
        // The cached source revision is deliberately WRONG: only the frozen
        // preview may feed the submit payload.
        return HttpResponse.json(contextJson(5, 3));
      }),
      http.post(`*/api/v1/arrivals/${PARTY}/receipt-preview`, () =>
        HttpResponse.json({
          intent: {
            ...DR27_PREVIEW_INTENT,
            source_revision: 11,
            reconciliation_revision: 9,
            issue_date: "2026-11-09T09:00:00Z",
            delivery_date: "2026-11-11T08:00:00Z",
            return_date: null,
          },
          application_xml: "<application />",
          fingerprint: "f".repeat(64),
        }),
      ),
      http.post(`*/api/v1/arrivals/${PARTY}/receipt`, async ({ request }) => {
        submits.push((await request.json()) as SubmitBody);
        return HttpResponse.json(
          { operation_id: "aaaaaaaa-0000-4000-8000-000000000003", state: "QUEUED", status_url: "/x" },
          { status: 202 },
        );
      }),
    );
    renderOperation();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Результат ветеринарного осмотра"), "CORRESPONDS");
    await user.click(screen.getByRole("button", { name: "Подготовить гашение" }));
    await user.click(await screen.findByRole("button", { name: "Погасить эВСД" }));
    await waitFor(() => expect(submits.length).toBe(1));
    const body = submits[0];
    expect(body?.source_revision).toBe(11);
    expect(body?.reconciliation_revision).toBe(9);
    expect(body?.issue_date).toBe("2026-11-09T09:00:00Z");
    expect(body?.fingerprint).toBe("f".repeat(64));
    expect(contextGets).toBeGreaterThanOrEqual(2);
  });

  it("REVISION_CONFLICT between preview and confirm drops the stale preview, offers a new one and never auto-submits (§4.3)", async () => {
    const submits: SubmitBody[] = [];
    let previews = 0;
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}/receipt-context`, () => HttpResponse.json(contextJson(7, 3))),
      http.post(`*/api/v1/arrivals/${PARTY}/receipt-preview`, () => {
        previews += 1;
        return HttpResponse.json({
          intent: {
            ...DR27_PREVIEW_INTENT,
            source_revision: 7,
            reconciliation_revision: 3,
            issue_date: "2026-11-09T09:00:00Z",
            delivery_date: "2026-11-11T08:00:00Z",
            return_date: null,
          },
          application_xml: "<application />",
          fingerprint: "1".repeat(64),
        });
      }),
      http.post(`*/api/v1/arrivals/${PARTY}/receipt`, async ({ request }) => {
        submits.push((await request.json()) as SubmitBody);
        return HttpResponse.json(
          {
            type: "about:blank",
            title: "Revision Conflict",
            status: 409,
            detail: "Источник или сверка изменились; сформируйте preview заново.",
            code: "REVISION_CONFLICT",
            current_source_revision: 8,
            current_reconciliation_revision: 3,
          },
          { status: 409 },
        );
      }),
    );
    renderOperation();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Результат ветеринарного осмотра"), "CORRESPONDS");
    await user.click(screen.getByRole("button", { name: "Подготовить гашение" }));
    await user.click(await screen.findByRole("button", { name: "Погасить эВСД" }));
    // The conflict closes the dialog, drops the preview and explains itself.
    expect(await screen.findByText("Источник или сверка изменились")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Погасить эВСД" })).toBeNull();
    // No automatic retry: exactly one submit for the one confirmation.
    expect(submits.length).toBe(1);
    // The diagnostics of §5.2 are shown with the cause.
    expect(screen.getByText(/Актуальные ревизии: источник 8/)).toBeInTheDocument();
    // The user input is preserved after the error.
    expect((screen.getByLabelText("Результат ветеринарного осмотра") as HTMLSelectElement).value).toBe(
      "CORRESPONDS",
    );
    // A new preview is always an explicit user action.
    await user.click(screen.getByRole("button", { name: "Сформировать preview заново" }));
    expect(await screen.findByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeInTheDocument();
    expect(previews).toBe(2);
    expect(submits.length).toBe(1); // still no automatic submit
  });

  it("a failed preview keeps the user input and never opens the dialog (§7.7)", async () => {
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}/receipt-context`, () => HttpResponse.json(contextJson(7, 3))),
      http.post(`*/api/v1/arrivals/${PARTY}/receipt-preview`, () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Validation error",
            status: 422,
            detail: "Дата поступления должна содержать часовой пояс и не быть в будущем.",
            code: "VALIDATION_ERROR",
          },
          { status: 422 },
        ),
      ),
    );
    renderOperation();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Результат ветеринарного осмотра"), "MISMATCH");
    await user.click(screen.getByRole("button", { name: "Подготовить гашение" }));
    expect(await screen.findByText("Проверьте значения формы")).toBeInTheDocument();
    expect((screen.getByLabelText("Результат ветеринарного осмотра") as HTMLSelectElement).value).toBe(
      "MISMATCH",
    );
    expect(screen.queryByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeNull();
  });

  it("a double click on Погасить creates exactly one submit (§7.5)", async () => {
    let submits = 0;
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY}/receipt-context`, () => HttpResponse.json(contextJson(7, 3))),
      http.post(`*/api/v1/arrivals/${PARTY}/receipt-preview`, () =>
        HttpResponse.json({
          intent: {
            ...DR27_PREVIEW_INTENT,
            source_revision: 7,
            reconciliation_revision: 3,
            issue_date: "2026-11-09T09:00:00Z",
            delivery_date: "2026-11-11T08:00:00Z",
            return_date: null,
          },
          application_xml: "<application />",
          fingerprint: "2".repeat(64),
        }),
      ),
      http.post(`*/api/v1/arrivals/${PARTY}/receipt`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        submits += 1;
        return HttpResponse.json(
          { operation_id: "aaaaaaaa-0000-4000-8000-000000000004", state: "QUEUED", status_url: "/x" },
          { status: 202 },
        );
      }),
    );
    renderOperation();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Результат ветеринарного осмотра"), "CORRESPONDS");
    await user.click(screen.getByRole("button", { name: "Подготовить гашение" }));
    const confirmButton = await screen.findByRole("button", { name: "Погасить эВСД" });
    await user.click(confirmButton);
    await user.click(confirmButton);
    await waitFor(() => expect(submits).toBe(1), { timeout: 3_000 });
    await waitFor(() => expect(submits).toBe(1));
  });

  it("the specified party a560d943… Save → Prepare sends the CURRENT revision (§7.8)", async () => {
    // The §2.3 party: reconciliation.rev moved to 5 independently of the
    // source revision 1; the context was refreshed after the save.
    const PARTY_A = "a560d943-38e3-467f-956c-e2a885514cad";
    const partyA = { ...party, party_id: PARTY_A, laboratory_id: LAB } as unknown as IncomingView;
    const views = { ...reconciliation, revision: 5 };
    let previews: PreviewBody[] = [];
    server.use(
      http.get(`*/api/v1/arrivals/${PARTY_A}/receipt-context`, () => HttpResponse.json(contextJson(1, 5))),
      http.post(`*/api/v1/arrivals/${PARTY_A}/receipt-preview`, async ({ request }) => {
        previews.push((await request.json()) as PreviewBody);
        return HttpResponse.json({
          intent: { ...DR27_PREVIEW_INTENT, source_revision: 1, reconciliation_revision: 5 },
          application_xml: "<application />",
          fingerprint: "3".repeat(64),
        });
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ReceiptOperation party={partyA} reconciliation={views} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Результат ветеринарного осмотра"), "CORRESPONDS");
    await user.click(screen.getByRole("button", { name: "Подготовить гашение" }));
    expect(await screen.findByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeInTheDocument();
    expect(previews.length).toBe(1);
    // The NEW reconciliation revision reaches the preview — never the stale 4.
    expect(previews[0]?.reconciliation_revision).toBe(5);
    expect(previews[0]?.source_revision).toBe(1);
    previews = [];
  });
});

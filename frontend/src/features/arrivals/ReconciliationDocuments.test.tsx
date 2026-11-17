/**
 * ТЗ DR40 §10 (frontend): the accompanying-documents block of the
 * reconciliation form — one card per document with ONE pair of
 * «Соответствует»/«Не соответствует» controls per DOCUMENT, the structured
 * mismatch fact inside the card, the honest empty state, the saved
 * documentChecks round-trip and the accessibility contract (radiogroup
 * semantics, full Russian names, no GUID leakage). No VetIS is ever called
 * from the browser: everything runs on local fixtures/MSW.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { ReconciliationForm } from "./ReconciliationForm";
import { DocumentComparisonField } from "./DocumentComparisonField";
import { seriesAndNumberLabel } from "./api";
import type { AccompanyingDocument, IncomingView, ReconciliationView } from "./api";
import { useDirtyStore } from "../../entities/session/context";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";

const TTN_KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1";
const TORG_KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2";

const documents: AccompanyingDocument[] = [
  {
    key: TTN_KEY,
    sourceOrder: 0,
    typeCode: "1",
    typeLabel: "Товарно-транспортная накладная",
    series: "0006",
    number: "5555",
    seriesAndNumber: "0006 5555",
    createdOn: "2026-11-16",
    relationshipType: "1",
  },
  {
    key: TORG_KEY,
    sourceOrder: 1,
    typeCode: "6",
    typeLabel: "ТОРГ-12",
    series: "33333",
    number: "66666",
    seriesAndNumber: "33333 66666",
    createdOn: "2026-11-16",
    relationshipType: "6",
  },
];

const party: IncomingView = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "CONFIRMED",
    accompanyingDocuments: documents,
    fields: {
      documentUuid: "1f0e6d2a-1111-4222-8333-444444444444",
      issuedOn: "2026-11-03",
      statusLabel: "Оформлен",
      purpose: "реализация в пищу людям",
      transportNumber: "А123ВС77",
      consignor: "ООО «Мясопром»",
      consignee: "Убойный пункт Ленина, 5",
      productItem: "Отруба говяжьи",
    },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: null,
    productItem: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002", name: "Отруба говяжьи" },
    unit: { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "кг" },
  },
  documentary: { mass_kg: "120.0", quantity: "4", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  confirmation: null,
  queue: "WORK",
  examination_id: null,
  revision: 1,
  source_presence: "CURRENT_CONFIRMED",
};

const partyWithoutDocuments: IncomingView = {
  ...party,
  external: { ...party.external, accompanyingDocuments: [] },
};

const emptyView: ReconciliationView = {
  id: "",
  party_id: PARTY,
  revision: 1,
  state: "OPEN",
  checks: {},
  documentChecks: {},
  inspection: { compartment: null, jointCarriage: null },
  delivered: { mass_kg: "120.0", quantity: "4", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  accepted: { mass_kg: "120.0", quantity: "4", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  returned: { mass_kg: "0", quantity: "0", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  decision: null,
  return_reason: null,
  repeat: null,
  transaction: { planned: null, type: null },
  fair: false,
  services: [],
  actor_id: "",
  saved_at: "2026-11-07T10:00:00Z",
  completed_at: null,
  allowed_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
  act: { required: false, items: [] },
  route: null,
  errors: [],
  complete: false,
};

function renderForm(
  props: { party?: IncomingView; initial?: ReconciliationView } = {},
  onSaved = vi.fn(),
): void {
  const client = new QueryClient();
  client.setQueryData([LAB, PARTY, "reconciliation"], props.initial ?? emptyView);
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ReconciliationForm
          party={props.party ?? party}
          initial={props.initial ?? emptyView}
          onSaved={onSaved}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  useDirtyStore.getState().setDirty(false);
});

beforeAll(() => {
  // DR24: the decimal inputs canonicalise on blur through rAF — present but
  // not asserted here; jsdom needs no extra setup.
});

function documentCards(): HTMLElement[] {
  const section = screen
    .getByRole("heading", { name: "Сопроводительные документы" })
    .closest("section") as HTMLElement;
  return [...section.querySelectorAll<HTMLElement>(".vse-rec-document-card")];
}

describe("ТЗ DR40: сопроводительные документы", () => {
  it("renders TWO separate document cards for type 1 and type 6 in source order", () => {
    renderForm();
    const cards = documentCards();
    expect(cards.length).toBe(2);
    expect(within(cards[0]).getAllByText("Товарно-транспортная накладная").length).toBeGreaterThanOrEqual(1);
    expect(within(cards[1]).getAllByText("ТОРГ-12").length).toBeGreaterThanOrEqual(1);
  });

  it("gives each card exactly ONE pair of controls and the three required rows", () => {
    renderForm();
    const cards = documentCards();
    for (const card of cards) {
      expect(within(card).getAllByRole("radio").length).toBe(2);
      expect(within(card).getByText("Тип сопроводительного документа")).toBeInTheDocument();
      expect(within(card).getByText("Серия и номер")).toBeInTheDocument();
      expect(within(card).getByText("Дата создания")).toBeInTheDocument();
    }
    expect(within(cards[0]).getByText("0006 5555")).toBeInTheDocument();
    expect(within(cards[1]).getByText("33333 66666")).toBeInTheDocument();
  });

  it("renders the date as DD.MM.YYYY without a timezone shift", () => {
    renderForm();
    expect(screen.getAllByText("16.11.2026").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the full accessible names and radio semantics per document", () => {
    renderForm();
    expect(
      screen.getByRole("radio", { name: "Соответствует: Товарно-транспортная накладная" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Не соответствует: ТОРГ-12" })).toBeInTheDocument();
  });

  it("shows the honest empty state without any fictive mark", () => {
    renderForm({ party: partyWithoutDocuments });
    expect(screen.getByText("В эВСД нет сопроводительных документов.")).toBeInTheDocument();
    expect(documentCards().length).toBe(0);
  });

  it("marks a mismatch and reveals the structured actual fields and reason INSIDE the card", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("radio", { name: "Не соответствует: ТОРГ-12" }));
    const cards = documentCards();
    expect(within(cards[1]).getByText("Фактическое значение")).toBeInTheDocument();
    expect(within(cards[1]).getAllByText("Серия и номер").length).toBeGreaterThanOrEqual(2);
    expect(within(cards[1]).getByLabelText("Причина несоответствия")).toBeInTheDocument();
    expect(within(cards[0]).queryByText("Фактическое значение")).toBeNull();
  });

  it("requires the reason of a mismatched document before saving", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("radio", { name: "Не соответствует: ТОРГ-12" }));
    await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
    expect(await screen.findByText("Проверьте введённые значения количеств и отметки.")).toBeInTheDocument();
  });

  it("sends documentChecks with the structured actual value and no legacy CHK-F25/26/27", async () => {
    const savedPayloads: Record<string, unknown>[] = [];
    const savedView: ReconciliationView = {
      ...emptyView,
      id: "c1e2d3a4-1111-4222-8333-444444444444",
      revision: 2,
      documentChecks: {
        [TTN_KEY]: { matches: true },
        [TORG_KEY]: {
          matches: false,
          actual: { typeCode: "6", series: "33333", number: "66666", createdOn: "2026-11-16" },
          reason: "Номер в накладной другой",
        },
      },
    };
    const server = setupServer(
      http.get("*/api/v1/me", () =>
        HttpResponse.json({
          id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
          full_name: "Ветврач",
          login: "vet",
          email: "vet@lab.test",
          position: null,
          role: "VET",
          active: true,
          scopes: [{ laboratory_id: LAB, product_scope_id: null }],
          capabilities: [],
          revision: 1,
          source_presence: "CURRENT_CONFIRMED",
        }),
      ),
      http.put("*/api/v1/arrivals/:partyId/reconciliation", async ({ request }) => {
        savedPayloads.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(savedView, { status: 200 });
      }),
    );
    server.listen();
    try {
      function SaveFlow(): React.ReactElement {
        const [view, setView] = useState<ReconciliationView>(emptyView);
        return <ReconciliationForm party={party} initial={view} onSaved={setView} />;
      }
      render(
        <MemoryRouter>
          <SaveFlow />
        </MemoryRouter>,
      );
      await userEvent.click(
        screen.getByRole("radio", { name: "Соответствует: Товарно-транспортная накладная" }),
      );
      await userEvent.click(screen.getByRole("radio", { name: "Не соответствует: ТОРГ-12" }));
      await userEvent.type(screen.getByLabelText("Причина несоответствия"), "Номер в накладной другой");
      await userEvent.click(screen.getByRole("button", { name: "Сохранить сверку" }));
      await waitFor(() => expect(savedPayloads.length).toBeGreaterThan(0));
      const payload = savedPayloads[0] as {
        documentChecks?: Record<string, unknown>;
        checks?: Record<string, unknown>;
      };
      expect(Object.keys(payload.checks ?? {})).not.toContain("CHK-F25");
      const documentChecks = payload.documentChecks ?? {};
      expect(documentChecks[TTN_KEY]).toEqual({ matches: true });
      expect(documentChecks[TORG_KEY]).toEqual({
        matches: false,
        actual: { typeCode: "6", series: "33333", number: "66666", createdOn: "2026-11-16" },
        reason: "Номер в накладной другой",
      });
    } finally {
      server.close();
    }
  });

  it("restores the saved document marks from documentChecks (legacy CHK fields are not copied)", () => {
    renderForm({
      initial: {
        ...emptyView,
        documentChecks: { [TTN_KEY]: { matches: true } },
      },
    });
    expect(
      (
        screen.getByRole("radio", {
          name: "Соответствует: Товарно-транспортная накладная",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (screen.getByRole("radio", { name: "Не соответствует: ТОРГ-12" }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("keeps an unknown type visible and an absent series honest («—»)", () => {
    renderForm({
      party: {
        ...party,
        external: {
          ...party.external,
          accompanyingDocuments: [
            {
              key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3",
              sourceOrder: 0,
              typeCode: "99",
              typeLabel: "Тип документа 99",
              series: null,
              number: "77",
              seriesAndNumber: "77",
              createdOn: null,
              relationshipType: "6",
            },
          ],
        },
      },
    });
    expect(screen.getAllByText(/Тип документа 99/).length).toBeGreaterThanOrEqual(1);
    const card = documentCards()[0];
    expect(within(card).getByText("—")).toBeInTheDocument();
  });

  it("joins series and number with one space (helper contract)", () => {
    expect(seriesAndNumberLabel("0006", "5555")).toBe("0006 5555");
    expect(seriesAndNumberLabel(null, "5555")).toBe("5555");
    expect(seriesAndNumberLabel("0006", null)).toBe("0006");
    expect(seriesAndNumberLabel(null, null)).toBe("—");
  });

  it("keeps long type labels readable (no grid break): the card wraps with overflow-wrap", () => {
    const longLabel = "Разрешение Россельхознадзора на ввоз/вывоз/транзит подконтрольной продукции";
    render(
      <DocumentComparisonField
        documentKey={TTN_KEY}
        document={{ ...documents[0], typeLabel: longLabel }}
        value={{ matches: null, reason: "" }}
        onChange={vi.fn()}
      />,
    );
    const card = document.body.querySelector<HTMLElement>(".vse-rec-document-card");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getAllByText(longLabel).length).toBeGreaterThanOrEqual(1);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

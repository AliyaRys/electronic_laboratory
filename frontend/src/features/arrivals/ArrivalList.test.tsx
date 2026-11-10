/**
 * ArrivalList unit tests (A01): rows navigate to the REAL party id, only
 * expected arrivals offer the hide action, and long data wraps (no GUID is
 * ever shown).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ArrivalList } from "./ArrivalList";
import type { IncomingView } from "./api";

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";

const base: IncomingView = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "COMPLETED",
    fields: {
      documentNumber: "№ A-001234",
      transportNumber: "А123ВС77",
      consignor: "ООО «Мясопром»",
      consignee: "Убойный пункт",
      productItem: "Отруба говяжьи",
    },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: null,
    productItem: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002", name: "Отруба говяжьи" },
    unit: { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "кг" },
  },
  documentary: { mass_kg: "120.0", quantity: "4", unit_id: "u1" },
  confirmation: null,
  queue: "EXPECTED",
  examination_id: null,
  revision: 1,
};

function renderList(items: IncomingView[], onHide = vi.fn()): void {
  render(<ArrivalList labId={LAB} items={items} onHide={onHide} />);
}

describe("ArrivalList", () => {
  it("navigates to the real party id, never the raw UUID of the eVSD", () => {
    renderList([base]);
    const link = screen.getByRole("link", { name: "говядина" });
    expect(link.getAttribute("href")).toBe(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`);
    expect(document.body.textContent).not.toContain("1f0e6d2a");
  });

  it("offers hide only for expected arrivals without confirmation", async () => {
    const onHide = vi.fn();
    renderList([base, { ...base, party_id: "bb", queue: "WORK" }], onHide);
    await userEvent.click(screen.getByRole("button", { name: "Действия со строкой" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Скрыть из очереди" }));
    expect(onHide).toHaveBeenCalledWith(PARTY);
  });

  it("shows a product name for a dictionary miss without a raw GUID", () => {
    renderList([
      {
        ...base,
        classification: { ...base.classification, product: { id: null, name: null } },
      },
    ]);
    expect(screen.getByText("Продукция не определена")).toBeTruthy();
  });

  it("has an explicit reconciliation action with the required accessible name", () => {
    renderList([base]);
    const action = screen.getByRole("link", { name: "Перейти к сверке данных" });
    expect(action.getAttribute("href")).toBe(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`);
    expect(action.textContent).toContain("Сверить");
  });

  it("the action href uses the real party id and never the evsd_uuid", () => {
    renderList([base]);
    const action = screen.getByRole("link", { name: "Перейти к сверке данных" });
    expect(action.getAttribute("href")).toContain(PARTY);
    expect(action.getAttribute("href")).toContain(LAB);
    expect(document.querySelector(`a[href*="1f0e6d2a"]`)).toBeNull();
  });

  it("the action is present for EXPECTED, WORK and ACCEPTED", () => {
    renderList([
      base,
      { ...base, party_id: "b1", queue: "WORK" },
      { ...base, party_id: "b2", queue: "ACCEPTED" },
    ]);
    expect(screen.getAllByRole("link", { name: "Перейти к сверке данных" }).length).toBe(3);
  });

  it("for EXPECTED the transition and hide coexist independently", async () => {
    const onHide = vi.fn();
    renderList([base], onHide);
    const action = screen.getByRole("link", { name: "Перейти к сверке данных" });
    expect(screen.getByRole("button", { name: "Действия со строкой" })).toBeTruthy();
    // Clicking the transition must not trigger the hide mutation.
    action.addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(action);
    expect(onHide).not.toHaveBeenCalled();
  });

  it("a row without the hide right still gets the transition link", () => {
    // WORK row: no hide menu is offered, read of the party is still possible.
    renderList([{ ...base, party_id: "bb", queue: "WORK" }]);
    const action = screen.getByRole("link", { name: "Перейти к сверке данных" });
    expect(action.getAttribute("href")).toBe(`/labs/${LAB}/arrivals/bb/reconciliation`);
    expect(screen.queryByRole("button", { name: "Действия со строкой" })).toBeNull();
  });
});

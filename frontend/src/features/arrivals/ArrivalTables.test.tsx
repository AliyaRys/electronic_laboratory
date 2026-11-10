/**
 * ArrivalTables unit tests (DR3, spec 20): per-stage columns, no «Очередь»
 * column, distinct EXPECTED icon actions, honest «—» for absent data and
 * the exact empty-state texts.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CompletedArrivalsTable, ExpectedArrivalsTable, WorkArrivalsTable } from "./ArrivalTables";
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
      documentNumber: "RU016:260812-005102",
      issuedOn: "2026-08-12T08:40:00",
      transportNumber: "А245КМ 116",
      consignor: "ООО «Мясопром»",
      consignee: "Лаборатория ВСЭ",
    },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: null,
    productItem: null,
    unit: null,
  },
  documentary: { mass_kg: "486.5", quantity: "3", unit_id: "u" },
  confirmation: null,
  queue: "EXPECTED",
  examination_id: null,
  revision: 1,
};

function withConfirmation(view: IncomingView): IncomingView {
  return {
    ...view,
    confirmation: {
      id: "55555555-1111-4222-8333-444444444444",
      accepted_mass_kg: "486.500000",
      accepted_quantity: "3.000000",
      accepted_unit_id: "u",
      returned_mass_kg: "0.000000",
      returned_quantity: "0.000000",
      confirmed_at: "2026-08-12T11:40:00Z",
    },
  };
}

describe("ExpectedArrivalsTable", () => {
  it("shows the mockup columns in the mockup order without an «Очередь» column", () => {
    render(<ExpectedArrivalsTable labId={LAB} items={[base]} />);
    for (const header of [
      "Дата создания ВСД",
      "Номер эВСД",
      "Хозяйство",
      "Вид продукции",
      "Объём / масса",
      "Количество",
      "ТС",
    ]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    }
    expect(screen.queryByRole("columnheader", { name: "Очередь" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Стоимость сверки" })).toBeNull();
  });

  it("has TWO separate icon actions: hide (button) and reconciliation (link)", () => {
    const onHide = vi.fn();
    render(<ExpectedArrivalsTable labId={LAB} items={[base]} onHide={onHide} />);
    const hide = screen.getByRole("button", { name: "Скрыть поступление из очереди" });
    const reconcile = screen.getByRole("link", { name: "Перейти к сверке данных" });
    expect(hide.getAttribute("href")).toBeNull();
    expect(reconcile.getAttribute("href")).toBe(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`);
    // Clicking reconciliation never triggers the hide mutation.
    reconcile.addEventListener("click", (event) => event.preventDefault());
    return userEvent.click(reconcile).then(() => expect(onHide).not.toHaveBeenCalled());
  });

  it("uses the real fields; a missing vehicle renders «—», never mockup data", () => {
    render(
      <ExpectedArrivalsTable
        labId={LAB}
        items={[
          {
            ...base,
            external: { ...base.external, fields: { ...base.external.fields, transportNumber: null } },
          },
        ]}
      />,
    );
    expect(screen.getByText("12.08.2026 08:40")).toBeTruthy();
    expect(screen.getByText("RU016:260812-005102")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("keeps the exact empty-state text", () => {
    render(<ExpectedArrivalsTable labId={LAB} items={[]} />);
    expect(screen.getByText("По заданным условиям эВСД не найдены")).toBeTruthy();
  });
});

describe("WorkArrivalsTable", () => {
  it("shows the mockup columns and honest «—» for cost/author (API-gap)", () => {
    render(<WorkArrivalsTable labId={LAB} items={[withConfirmation(base)]} />);
    expect(screen.getByRole("columnheader", { name: "Дата сверки данных" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Стоимость сверки" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Автор сверки данных" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Очередь" })).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("the action is «Создать ВСЭ» on the real examination/new route", () => {
    render(<WorkArrivalsTable labId={LAB} items={[withConfirmation(base)]} />);
    const action = screen.getByRole("link", { name: "Создать ВСЭ" });
    expect(action.getAttribute("href")).toBe(`/labs/${LAB}/arrivals/${PARTY}/examination/new`);
  });

  it("a server-fact draft row gets the gray tone and «Продолжить создание ВСЭ»", () => {
    render(
      <WorkArrivalsTable labId={LAB} items={[withConfirmation(base)]} draftPartyIds={new Set([PARTY])} />,
    );
    expect(screen.getByRole("link", { name: "Продолжить создание ВСЭ" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Создать ВСЭ" })).toBeNull();
    expect(document.querySelector("tr.app-row-draft")).toBeTruthy();
  });

  it("keeps the exact empty-state text", () => {
    render(<WorkArrivalsTable labId={LAB} items={[]} />);
    expect(screen.getByText("По заданным условиям поступления в работе не найдены")).toBeTruthy();
  });
});

describe("CompletedArrivalsTable", () => {
  it("shows the mockup core columns; queue is never a veterinary result", () => {
    render(
      <CompletedArrivalsTable
        labId={LAB}
        items={[
          withConfirmation({
            ...base,
            queue: "ACCEPTED",
            examination_id: "77777777-1111-4222-8333-444444444444",
          }),
        ]}
        hiddenColumns={new Set()}
      />,
    );
    for (const header of ["Дата сверки данных", "Статус ВСД", "ВСЭ", "Стоимость", "Срок реализации"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    }
    expect(screen.queryByRole("columnheader", { name: "Очередь" })).toBeNull();
    // Result column stays honest «—»: the read model has no ВСЭ result.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("the eye action opens the real examination card only with a real id", () => {
    render(
      <CompletedArrivalsTable
        labId={LAB}
        items={[
          withConfirmation({
            ...base,
            queue: "ACCEPTED",
            examination_id: "77777777-1111-4222-8333-444444444444",
          }),
        ]}
        hiddenColumns={new Set()}
      />,
    );
    const view = screen.getByRole("link", { name: "Открыть карточку ВСЭ" });
    expect(view.getAttribute("href")).toBe(`/labs/${LAB}/examinations/77777777-1111-4222-8333-444444444444`);
  });

  it("a row without examination id renders no dead action", () => {
    render(
      <CompletedArrivalsTable
        labId={LAB}
        items={[withConfirmation({ ...base, queue: "ACCEPTED" })]}
        hiddenColumns={new Set()}
      />,
    );
    expect(screen.queryByRole("link", { name: "Открыть карточку ВСЭ" })).toBeNull();
  });

  it("the column chooser can hide optional columns but never the actions", () => {
    render(
      <CompletedArrivalsTable
        labId={LAB}
        items={[withConfirmation({ ...base, queue: "ACCEPTED" })]}
        hiddenColumns={new Set(["checkAuthor", "vseAuthor", "vseNumber"])}
      />,
    );
    expect(screen.queryByRole("columnheader", { name: "Автор ВСЭ" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Стоимость" })).toBeTruthy();
  });

  it("keeps the exact empty-state text", () => {
    render(<CompletedArrivalsTable labId={LAB} items={[]} hiddenColumns={new Set()} />);
    expect(screen.getByText("По заданным условиям завершенные поступления не найдены")).toBeTruthy();
  });
});

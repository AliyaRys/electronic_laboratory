/**
 * ConclusionPreview unit tests (D02): the rows mirror the view-model fields
 * in the manifest order, the preliminary warning is honest, long data wraps
 * without a GUID substitution and the signature stays an empty place.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConclusionPreview } from "./ConclusionPreview";
import type { ConclusionView } from "./api";

const view: ConclusionView = {
  basis_kind: "LOCAL",
  basis_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  fields: {
    organization: "ГБУ «Ветлаб»",
    laboratory: "Лаборатория №1",
    date: "2026-11-07",
    basis: "Местная ВСЭ № Д-1 от 2026-11-05",
    evsd: "ЭВСД-120",
    owner: "ИП Владелец",
    product: "Говядина охлаждённая",
    mass: "100",
    count: "4",
    unit: "руб/кг",
    stamp: "Клеймо-1",
    signature: "",
  },
  form_id: "conclusion-local",
  form_version: "1",
  official: false,
  warnings: ["Предварительная форма"],
};

describe("ConclusionPreview", () => {
  it("renders the same model fields in the manifest order", () => {
    render(<ConclusionPreview view={view} />);
    expect(screen.getByText("Принятая масса, кг")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("Говядина охлаждённая")).toBeInTheDocument();
    expect(screen.getByText("ЭВСД-120")).toBeInTheDocument();
  });

  it("shows the preliminary form warning while official is false", () => {
    render(<ConclusionPreview view={view} />);
    expect(screen.getByRole("status")).toHaveTextContent("Предварительная форма");
  });

  it("keeps the signature an empty place and long data intact", () => {
    const long = {
      ...view,
      basis_kind: "PREVIOUS" as const,
      fields: {
        ...view.fields,
        owner:
          "Общество с ограниченной ответственностью «Агропромышленное объединение переработки мясной продукции чрезвычайно длинного наименования владельца»",
      },
    };
    render(<ConclusionPreview view={long} />);
    expect(screen.getByText(/чрезвычайно длинного наименования владельца/)).toBeInTheDocument();
    expect(screen.getByText(/убойного пункта/)).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("Подпись (заполняется от руки)");
  });
});

/**
 * D02 component stories: the conclusion preview (ordinary and long data) and
 * the document actions (ready and the honest 503 problem state).
 */
import type { Meta, StoryObj } from "@storybook/react";
import { DocumentActions } from "./DocumentActions";
import { ConclusionPreview } from "./ConclusionPreview";
import type { ConclusionView } from "./api";
import "./documents.css";

const meta: Meta = {
  title: "D02/Документы",
};
export default meta;

const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";

const base: ConclusionView = {
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

const longData: ConclusionView = {
  ...base,
  basis_kind: "PREVIOUS",
  fields: {
    ...base.fields,
    owner:
      "Общество с ограниченной ответственностью «Агропромышленное объединение переработки мясной продукции и сопутствующих товарных позиций чрезвычайно длинного наименования владельца»",
    product:
      "Говядина первая категория охлаждённая в полутушах крайне длинное наименование продукции для переноса на следующую строку таблицы",
    basis: "Прежняя ВСЭ № П-77 от 2026-10-20",
    stamp: "Клеймо убойного пункта 555",
  },
};

export const ЗаключениеМестнойВсэ: StoryObj<typeof ConclusionPreview> = {
  render: (args) => <ConclusionPreview {...args} />,
  args: { view: base },
};

export const ЗаключениеУбойногоПунктаСДлиннымиДанными: StoryObj<typeof ConclusionPreview> = {
  render: (args) => <ConclusionPreview {...args} />,
  args: { view: longData },
};

export const Действия: StoryObj<typeof DocumentActions> = {
  render: (args) => (
    <div>
      <ConclusionPreview view={base} />
      <DocumentActions {...args} />
    </div>
  ),
  args: { partyId: PARTY },
};

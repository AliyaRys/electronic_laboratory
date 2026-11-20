/**
 * D02 component stories: the conclusion preview (ordinary and long data) and
 * the document actions (ready and the honest 503 problem state).
 */
import type { Meta, StoryObj } from "@storybook/react";
import { DocumentActions } from "./DocumentActions";
import { ConclusionActionsMenu } from "./ConclusionActionsMenu";
import { ConclusionPreview } from "./ConclusionPreview";
import { Icon } from "../../shared/ui/Icon";
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

// --- ТЗ DR55 §5.5: the shared conclusion menu states --------------------------------

const MenuSandbox = (): React.ReactElement => {
  // A demo party id: stories never call the real backend; the item actions
  // are exercised by the MSW unit tests.
  return (
    <div style={{ minHeight: 420, padding: 16 }}>
      <ConclusionActionsMenu partyId={PARTY} canDownload canPrint />
      <p style={{ marginTop: 16 }}>Рядом расположенный контент — проверка перекрытия popover.</p>
    </div>
  );
};

const MenuOpenSandbox = (): React.ReactElement => (
  <div style={{ minHeight: 420, padding: 16 }}>
    {/* ТЗ DR55 §5.5: the open state with the 156px popover and its two items. */}
    <ConclusionActionsMenu partyId={PARTY} canDownload canPrint defaultOpen />
  </div>
);

const MenuBusySandbox = (): React.ReactElement => {
  // The busy state is exercised in stories by the disabled trigger/item
  // markup — the real loading is covered by the MSW unit tests.
  return (
    <div style={{ minHeight: 420, padding: 16 }}>
      <span className="vse-conclusion-menu">
        <button type="button" className="vse-conclusion-trigger" disabled aria-label="Действия с заключением">
          <Icon name="admin-download" />
        </button>
      </span>
      <p style={{ marginTop: 16, color: "var(--app-muted, #5b6470)" }}>Документ формируется…</p>
    </div>
  );
};

const MenuErrorSandbox = (): React.ReactElement => (
  <div style={{ minHeight: 420, padding: 16 }}>
    <ConclusionActionsMenu partyId={PARTY} canDownload canPrint />
    <div className="vse-document-error" role="alert" style={{ maxWidth: 360 }}>
      <p>Документ не сформирован (DOCUMENT_BASIS_INCOMPLETE, 422).</p>
      <p>Основание заключения непригодно или неполно; документ не формируется.</p>
    </div>
  </div>
);

export const МенюЗаключения: StoryObj<typeof ConclusionActionsMenu> = {
  render: () => <MenuSandbox />,
  parameters: { docs: { description: { story: "Закрытое меню «Действия с заключением» (34×34 триггер)." } } },
};

export const МенюЗаключенияОткрыто: StoryObj<typeof ConclusionActionsMenu> = {
  render: () => <MenuOpenSandbox />,
};

export const МенюЗаключенияЗагрузка: StoryObj<typeof ConclusionActionsMenu> = {
  render: () => <MenuBusySandbox />,
};

export const МенюЗаключенияОшибка: StoryObj<typeof ConclusionActionsMenu> = {
  render: () => <MenuErrorSandbox />,
};

export const МенюЗаключенияБезПечати: StoryObj<typeof ConclusionActionsMenu> = {
  render: () => (
    <div style={{ minHeight: 420, padding: 16 }}>
      <ConclusionActionsMenu partyId={PARTY} canDownload canPrint={false} />
    </div>
  ),
};

export const МенюЗаключенияУзкийЭкран: StoryObj<typeof ConclusionActionsMenu> = {
  render: () => (
    <div style={{ maxWidth: 390, minHeight: 420, padding: 16 }}>
      <ConclusionActionsMenu partyId={PARTY} canDownload canPrint />
    </div>
  ),
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

export const ОшибкаДокумента: StoryObj<typeof DocumentActions> = {
  render: (args) => (
    <div style={{ maxWidth: 480 }}>
      <DocumentActions {...args} />
    </div>
  ),
};

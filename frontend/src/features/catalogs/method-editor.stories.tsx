import type { Meta, StoryObj } from "@storybook/react";
import { MethodEditor } from "./MethodEditor";

const REGISTRY = [
  {
    id: "5410ca53-ffae-5a27-ab8d-51cb20fe4011",
    code: "VSE-F19",
    name: "Идентификация продукции",
    result_schema: "ENUM",
    unit_id: null,
    mandatory: true,
    conditional: false,
    options: ["Соответствует", "Не соответствует"],
  },
  {
    id: "ec2fba68-e4d1-5c82-9591-92ee9da5293e",
    code: "VSE-F20",
    name: "Температура в толще мышц",
    result_schema: "DECIMAL",
    unit_id: "°C",
    mandatory: true,
    conditional: false,
    options: null,
  },
];

const meta: Meta<typeof MethodEditor> = {
  title: "C02/MethodEditor",
  component: MethodEditor,
  parameters: { layout: "padded" },
  args: {
    mode: "create",
    laboratoryId: "7c1e6bb2-0000-4000-8000-000000000001",
    productSpeciesId: "11111111-1111-4111-8111-111111111111",
    onSaved: () => undefined,
    onClose: () => undefined,
  },
};

export default meta;
type Story = StoryObj<typeof MethodEditor>;

const base = {
  laboratoryId: "7c1e6bb2-0000-4000-8000-000000000001",
  productSpeciesId: "11111111-1111-4111-8111-111111111111",
  onSaved: () => undefined,
  onClose: () => undefined,
};

export const Create: Story = {
  render: () => <MethodEditor mode="create" {...base} />,
};
/** ТЗ-DR28 §6.2: the registry-driven create — the indicator is chosen by its
 * Russian name and code; the species/state come from the scoped context. */
export const CreateFromContext: Story = {
  render: () => (
    <MethodEditor
      mode="create"
      {...base}
      productStateId="cccccccc-0000-4000-8000-000000000001"
      indicators={REGISTRY}
    />
  ),
};
export const Narrow: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <MethodEditor mode="create" {...base} />
    </div>
  ),
};
export const NarrowFromContext: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <MethodEditor
        mode="create"
        {...base}
        productStateId="cccccccc-0000-4000-8000-000000000001"
        indicators={REGISTRY}
      />
    </div>
  ),
};

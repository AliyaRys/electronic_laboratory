import type { Meta, StoryObj } from "@storybook/react";
import { MethodEditor } from "./MethodEditor";

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
export const Narrow: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <MethodEditor mode="create" {...base} />
    </div>
  ),
};

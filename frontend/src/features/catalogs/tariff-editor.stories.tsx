import type { Meta, StoryObj } from "@storybook/react";
import { TariffEditor } from "./TariffEditor";

const base = {
  mode: "create" as const,
  laboratoryId: "7c1e6bb2-0000-4000-8000-000000000001",
  productSpeciesId: "11111111-1111-4111-8111-111111111111",
  onSaved: () => undefined,
  onClose: () => undefined,
};

const meta: Meta<typeof TariffEditor> = {
  title: "C02/TariffEditor",
  component: TariffEditor,
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof TariffEditor>;

export const Create: Story = {
  render: () => <TariffEditor {...base} />,
};
export const Narrow: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <TariffEditor {...base} />
    </div>
  ),
};

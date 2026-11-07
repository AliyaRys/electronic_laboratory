import type { Meta, StoryObj } from "@storybook/react";
import { CheckServiceEditor } from "./CheckServiceEditor";

const meta: Meta<typeof CheckServiceEditor> = {
  title: "C02/CheckServiceEditor",
  component: CheckServiceEditor,
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof CheckServiceEditor>;

const base = {
  mode: "create" as const,
  onSaved: () => undefined,
  onClose: () => undefined,
};

export const Create: Story = {
  render: () => <CheckServiceEditor {...base} />,
};
export const Narrow: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <CheckServiceEditor {...base} />
    </div>
  ),
};

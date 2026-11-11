import type { Meta, StoryObj } from "@storybook/react";
import { BulkPriceDialog } from "./BulkPriceDialog";

const labs = [
  { id: "7c1e6bb2-0000-4000-8000-000000000001", name: "Лаборатория 7c1e6bb2…" },
  { id: "7c1e6bb2-0000-4000-8000-000000000002", name: "Лаборатория 7c1e6bb3…" },
];

const meta: Meta<typeof BulkPriceDialog> = {
  title: "C02/BulkPriceDialog",
  component: BulkPriceDialog,
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof BulkPriceDialog>;

export const CoverageBeforeConfirm: Story = {
  args: {
    laboratories: labs,
    serviceCode: "trichinelloscopy",
    onClose: () => undefined,
  },
};
export const Narrow: Story = {
  args: {
    laboratories: labs,
    serviceCode: "trichinelloscopy",
    onClose: () => undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 390 }}>
        <Story />
      </div>
    ),
  ],
};

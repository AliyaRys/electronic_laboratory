/**
 * DR48 §3.4: stories of the shared date-range popover primitive — closed,
 * open, disabled, and the long applied label. The open state shows the
 * «С»/«По» fields with the shared actions; there is no dedicated error
 * story: the apply-time validation text appears on an invalid draft only.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { DateRangePopover } from "./DateRangePopover";

const meta: Meta = {
  title: "UI/DateRangePopover",
};
export default meta;

export const Закрытый: StoryObj<typeof DateRangePopover> = {
  render: (args) => <DateRangePopover {...args} />,
  args: {
    caption: "Период отчёта",
    applied: { from: "", to: "" },
    onApply: () => undefined,
    onReset: () => undefined,
  },
};

export const Открытый: StoryObj<typeof DateRangePopover> = {
  render: (args) => <DateRangePopover {...args} />,
  args: {
    caption: "Период отчёта",
    applied: { from: "", to: "" },
    onApply: () => undefined,
    onReset: () => undefined,
    initialOpen: true,
  },
};

export const ПрименённыйДиапазон: StoryObj<typeof DateRangePopover> = {
  render: (args) => <DateRangePopover {...args} />,
  args: {
    caption: "Период отчёта",
    applied: { from: "2026-01-01", to: "2026-06-30" },
    onApply: () => undefined,
    onReset: () => undefined,
  },
};

export const ОдинДень: StoryObj<typeof DateRangePopover> = {
  render: (args) => <DateRangePopover {...args} />,
  args: {
    caption: "Период отчёта",
    applied: { from: "2026-11-18", to: "2026-11-18" },
    onApply: () => undefined,
    onReset: () => undefined,
  },
};

export const Недоступный: StoryObj<typeof DateRangePopover> = {
  render: (args) => <DateRangePopover {...args} />,
  args: {
    caption: "Период отчёта",
    applied: { from: "", to: "" },
    onApply: () => undefined,
    onReset: () => undefined,
    disabled: true,
  },
};

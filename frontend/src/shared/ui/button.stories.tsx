import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "F02/Button",
  component: Button,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { children: "Сохранить", variant: "primary" } };
export const Secondary: Story = { args: { children: "Продолжить" } };
export const Danger: Story = { args: { children: "Удалить", variant: "danger" } };
export const Disabled: Story = { args: { children: "Удалить", variant: "danger", disabled: true } };
export const Busy: Story = { args: { children: "Сохранить", variant: "primary", busy: true } };
export const IconOnly: Story = {
  args: { children: "", label: "Удалить", icon: "admin-delete", iconOnly: true },
};
export const LongLabel: Story = {
  args: { children: "Отправить заключение в сервис Max ветеринарной службы" },
};
export const Narrow: Story = {
  args: { children: "Отправить заключение в сервис Max ветеринарной службы", variant: "primary" },
  decorators: [
    (Story) => (
      <div style={{ width: 390 }}>
        <Story />
      </div>
    ),
  ],
};

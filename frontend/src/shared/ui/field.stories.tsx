import type { Meta, StoryObj } from "@storybook/react";
import { Field } from "./Field";

const meta: Meta<typeof Field> = {
  title: "F02/Field",
  component: Field,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof Field>;

export const Default: Story = {
  args: { label: "Комментарий", value: "", onChange: () => undefined },
};
export const Hint: Story = {
  args: { label: "Логин", value: "kuznetsova", onChange: () => undefined, hint: "Латиницей, без пробелов" },
};
export const Error: Story = {
  args: { label: "Логин", value: "", onChange: () => undefined, error: "Укажите логин." },
};
export const Disabled: Story = {
  args: { label: "Логин", value: "kuznetsova", onChange: () => undefined, disabled: true },
};
export const Password: Story = {
  args: { label: "Пароль", type: "password", value: "", onChange: () => undefined },
};
export const LongValue: Story = {
  args: {
    label: "Полное название",
    value:
      "Общество с ограниченной ответственностью «Агрофирма Свободный Труд имени двадцатилетия Татарской Автономной Советской Социалистической Республики»",
    onChange: () => undefined,
  },
};
export const Narrow: Story = {
  args: { label: "Логин", value: "", onChange: () => undefined, error: "Укажите логин." },
  decorators: [
    (Story) => (
      <div style={{ width: 390 }}>
        <Story />
      </div>
    ),
  ],
};

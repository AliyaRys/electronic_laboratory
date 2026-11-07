import type { Meta, StoryObj } from "@storybook/react";
import { PasswordForm } from "./PasswordForm";

const meta: Meta<typeof PasswordForm> = {
  title: "F03/PasswordForm",
  component: PasswordForm,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof PasswordForm>;

export const Change: Story = {
  args: { mode: "change", onSubmit: async () => null },
};
export const Reset: Story = {
  args: { mode: "reset", onSubmit: async () => null },
};
export const FieldError: Story = {
  render: () => <PasswordHarness />,
};

/** Harness with a pre-bound server error rendered through the real form. */
import { useState } from "react";
function PasswordHarness(): React.ReactElement {
  const [attempt] = useState(0);
  return (
    <PasswordForm
      key={attempt}
      mode="change"
      busy={false}
      onSubmit={async () => ({
        type: "about:blank",
        title: "VALIDATION_ERROR",
        status: 422,
        detail: "Проверьте данные.",
        code: "VALIDATION_ERROR",
        errors: [{ path: "current_password", message: "Текущий пароль указан неверно." }],
      })}
      onSuccess={() => undefined}
    />
  );
}
export const Busy: Story = {
  args: { mode: "change", busy: true, onSubmit: async () => null },
};

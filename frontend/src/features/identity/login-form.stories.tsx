import type { Meta, StoryObj } from "@storybook/react";
import { LoginForm } from "./LoginForm";

const meta: Meta<typeof LoginForm> = {
  title: "F03/LoginForm",
  component: LoginForm,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof LoginForm>;

/** Stories are presentational: the command transport is injected by pages. */
export const Default: Story = {
  args: {
    onSubmit: async () => ({
      ok: false,
      problem: {
        type: "about:blank",
        title: "",
        status: 401,
        detail: "Неверный логин или пароль.",
        code: "INVALID_CREDENTIALS",
      },
    }),
  },
};
export const WrongCredentials: Story = {
  args: {
    onSubmit: async () => ({
      ok: false,
      problem: {
        type: "about:blank",
        title: "",
        status: 401,
        detail: "Неверный логин или пароль.",
        code: "INVALID_CREDENTIALS",
      },
    }),
  },
};
export const Blocked: Story = {
  args: {
    onSubmit: async () => ({
      ok: false,
      problem: {
        type: "about:blank",
        title: "",
        status: 403,
        detail: "Учётная запись заблокирована администратором. Вход недоступен.",
        code: "ACCOUNT_BLOCKED",
      },
    }),
  },
};
export const RateLimited: Story = {
  args: {
    onSubmit: async () => ({
      ok: false,
      problem: {
        type: "about:blank",
        title: "",
        status: 429,
        detail: "Слишком много попыток входа. Повторите позже.",
        code: "LOGIN_RATE_LIMITED",
      },
    }),
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import { UserEditor } from "./UserEditor";

const meta: Meta<typeof UserEditor> = {
  title: "F03/UserEditor",
  component: UserEditor,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof UserEditor>;

export const Create: Story = {
  args: {
    mode: "create",
    onSubmit: async () => null,
  },
};
export const CreateWithError: Story = {
  render: () => (
    <UserEditor
      mode="create"
      onSubmit={async () => ({
        type: "about:blank",
        title: "ACCESS_DENIED",
        status: 403,
        detail: "Назначение вне делегированной территории.",
        code: "ACCESS_DENIED",
        errors: [{ path: "scopes.0.laboratory_id", message: "Лаборатория вне вашей территории." }],
      })}
    />
  ),
};
export const Edit: Story = {
  args: {
    mode: "edit",
    initial: {
      full_name: "Врач Е2Е Ветеринарный",
      login: "e2e-vet",
      email: "e2e-vet@e2e.test",
      position: "Ветеринарный врач",
      role: "VET",
      scopes: [
        {
          laboratory_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          product_scope_id: "11111111-1111-4111-8111-111111111111",
        },
      ],
    },
    onSubmit: async () => null,
  },
};
export const LongValue: Story = {
  args: {
    mode: "create",
    initial: {
      full_name:
        "Ветеринарный Врач с очень длинной фамилией Общества с ограниченной ответственностью «Агрофирма Свободный Труд имени двадцатилетия Татарской Автономной Советской Социалистической Республики»",
      login: "long-name-vet",
      email: "long-name-vet@example.test",
      role: "VET",
      scopes: [],
    },
    onSubmit: async () => null,
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import { StatusView } from "./StatusView";

const meta: Meta<typeof StatusView> = {
  title: "F02/StatusView",
  component: StatusView,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof StatusView>;

export const Loading: Story = { args: { state: "loading" } };
export const Empty: Story = { args: { state: "empty" } };
export const NoMatch: Story = {
  args: { state: "no-match", title: "По фильтрам за 6 ноября ничего не найдено." },
};
export const NotFound: Story = {
  args: { state: "not-found" },
};
export const NoScope: Story = { args: { state: "no-scope" } };
export const Forbidden: Story = {
  args: {
    state: "forbidden",
    detail: "ACCESS_DENIED: раздел недоступен для вашей роли.",
  },
};
export const NetworkError: Story = {
  args: {
    state: "network-error",
    title: "Не удалось загрузить журнал",
    detail: "503 DEPENDENCY_UNAVAILABLE",
    trace: "trace_id: 8f3f21d4-99a2-4a58-8fa1-42d0f0c17b7e",
    onRetry: () => undefined,
  },
};
export const Unknown: Story = {
  args: {
    state: "unknown",
    detail: "OPERATION_UNRESOLVED: результат приёмки проверяется вручную.",
  },
};
export const Narrow: Story = {
  args: {
    state: "network-error",
    title: "Не удалось загрузить журнал",
    detail: "503 DEPENDENCY_UNAVAILABLE",
  },
  decorators: [
    (Story) => (
      <div style={{ width: 390 }}>
        <Story />
      </div>
    ),
  ],
};

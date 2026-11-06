import type { Meta, StoryObj } from "@storybook/react";
import { AppHeader, type HeaderUser } from "./AppHeader";

const user: HeaderUser = { fullName: "Анна Кузнецова", initials: "АК" };
const longUser: HeaderUser = {
  fullName: "Александр Владимирович Мустафин-Гайнутдинов",
  initials: "АМ",
};

const meta: Meta<typeof AppHeader> = {
  title: "F02/AppHeader",
  component: AppHeader,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof AppHeader>;

export const WorkMeat: Story = {
  args: {
    mode: "work",
    user,
    product: "meat",
    active: "arrivals",
    institution: "Лаборатория ВСЭ №1 г. Казань",
    onLogout: () => undefined,
  },
};
export const WorkMilk: Story = {
  args: {
    mode: "work",
    user,
    product: "milk",
    active: "journal",
    institution: "Лаборатория ВСЭ №1 г. Казань",
    onLogout: () => undefined,
  },
};
export const Admin: Story = {
  args: {
    mode: "admin",
    user,
    active: "users",
    institution: "Главная ветеринарная лаборатория",
    onLogout: () => undefined,
  },
};
export const Analyst: Story = {
  args: {
    mode: "analyst",
    user,
    active: "reports",
    institution: "Аналитический отдел",
    onLogout: () => undefined,
  },
};
export const NoProducts: Story = {
  args: { mode: "no-products", user, institution: "Лаборатория ВСЭ №1 г. Казань", onLogout: () => undefined },
};
export const LongData: Story = {
  args: {
    mode: "work",
    user: longUser,
    product: "milk",
    active: "directories",
    institution: "ГБУ «Центральное управление государственной ветеринарной службы Республики Татарстан»",
    onLogout: () => undefined,
  },
};
export const NoUser: Story = {
  args: { mode: "no-products", user: null, onLogout: () => undefined },
};
export const Narrow: Story = {
  args: { mode: "work", user: longUser, product: "milk", active: "arrivals", onLogout: () => undefined },
  decorators: [
    (Story) => (
      <div style={{ width: 390 }}>
        <Story />
      </div>
    ),
  ],
};

import type { Meta, StoryObj } from "@storybook/react";
import { AppHeader, type HeaderUser } from "./AppHeader";

const user: HeaderUser = { fullName: "Анна Кузнецова", initials: "АК" };
const longUser: HeaderUser = {
  fullName: "Александр Владимирович Мустафин-Гайнутдинов",
  initials: "АМ",
};

/** Selected laboratory of the story examples (contextual DR37 links). */
const LAB = "11111111-2222-4333-8444-555555555555";

const selectedLabLinks = {
  brand: `/labs/${LAB}/arrivals?queue=expected`,
  arrivals: `/labs/${LAB}/arrivals?queue=expected`,
  journal: `/labs/${LAB}/examinations`,
  reports: `/labs/${LAB}/reports`,
};

const samplesOnlyLinks = {
  brand: `/labs/${LAB}/arrivals?queue=expected`,
  arrivals: `/labs/${LAB}/arrivals?queue=expected`,
  journal: `/labs/${LAB}/examinations`,
  // DR37: a VET has NO 5-вет hub access — «Отчёты» leads straight into
  // «Учёт проб», the only permitted direction.
  reports: `/labs/${LAB}/reports/samples`,
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
    links: selectedLabLinks,
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
    links: selectedLabLinks,
    onLogout: () => undefined,
  },
};
/** ТЗ DR46 §3.1: the production work header shows the common roadmap menu —
 * «Мясо и мясопродукты» selected, the other directions «Пока недоступно». */
export const WorkRoadmapMenu: Story = {
  args: {
    mode: "work",
    user,
    product: "meat",
    active: "arrivals",
    institution: "Лаборатория ВСЭ №1 г. Казань",
    links: selectedLabLinks,
    onLogout: () => undefined,
  },
};
/** VET: no 5-вет hub — «Отчёты» opens «Учёт проб» directly (DR37). */
export const VetSamplesOnly: Story = {
  args: {
    mode: "work",
    user,
    product: "meat",
    active: "reports",
    institution: "Лаборатория ВСЭ №1 г. Казань",
    links: samplesOnlyLinks,
    onLogout: () => undefined,
  },
};
/** HEAD: all reporting directions of the own laboratory. */
export const HeadAllReports: Story = {
  args: {
    mode: "work",
    user,
    product: "meat",
    active: "reports",
    institution: "Лаборатория ВСЭ №1 г. Казань",
    links: selectedLabLinks,
    onLogout: () => undefined,
  },
};
export const Admin: Story = {
  args: {
    mode: "admin",
    user,
    active: "users",
    institution: "Республика Татарстан",
    onLogout: () => undefined,
  },
};
/** DR37: the administrator never gets a reports item (FT-RPT-01). */
export const AdminWithoutReports: Story = {
  args: {
    mode: "admin",
    user,
    active: "users",
    institution: "Республика Татарстан",
    onLogout: () => undefined,
  },
};
/** ANALYST inside the selected laboratory: «Отчёты» is the active item. */
export const AnalystSelectedLab: Story = {
  args: {
    mode: "analyst",
    user,
    active: "reports",
    institution: "Республика Татарстан",
    links: selectedLabLinks,
    onLogout: () => undefined,
  },
};
/** ANALYST before the choice: the honest /labs selection, no guessed lab. */
export const AnalystNoLab: Story = {
  args: {
    mode: "analyst",
    user,
    institution: "Республика Татарстан",
    links: { reports: "/labs" },
    onLogout: () => undefined,
  },
};
export const NoProducts: Story = {
  args: { mode: "no-products", user, institution: "Лаборатория ВСЭ №1 г. Казань", onLogout: () => undefined },
};
/** ТЗ DR41 §3.2: an assigned scope without a laboratory_name. */
export const WorkMissingLabName: Story = {
  args: {
    mode: "work",
    user,
    product: "meat",
    active: "arrivals",
    institution: "Лаборатория не указана",
    onLogout: () => undefined,
  },
};
export const LongData: Story = {
  args: {
    mode: "work",
    user: longUser,
    product: "milk",
    active: "directories",
    institution: "ГБУ «Центральное управление государственной ветеринарной службы Республики Татарстан»",
    links: selectedLabLinks,
    onLogout: () => undefined,
  },
};
export const NoUser: Story = {
  args: { mode: "no-products", user: null, onLogout: () => undefined },
};
export const Narrow: Story = {
  args: {
    mode: "work",
    user: longUser,
    product: "milk",
    active: "arrivals",
    links: selectedLabLinks,
    onLogout: () => undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 390 }}>
        <Story />
      </div>
    ),
  ],
};

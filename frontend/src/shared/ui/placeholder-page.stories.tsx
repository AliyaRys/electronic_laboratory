/**
 * PLACEHOLDER story: build-storybook needs at least one story to prove the
 * pipeline works (F01 quality gate). Real stories arrive with F02 next to
 * their components — delete this file when the first module story lands.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { PlaceholderPage } from "./PlaceholderPage";

const meta: Meta<typeof PlaceholderPage> = {
  title: "F01/Заглушка навигации",
  component: PlaceholderPage,
  tags: ["placeholder"],
};

export default meta;

export const Заглушка: StoryObj<typeof PlaceholderPage> = {
  args: {
    title: "Заглушка",
    note: "Временная история для проверки сборки каталога (F01).",
  },
};

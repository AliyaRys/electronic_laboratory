import type { StorybookConfig } from "@storybook/react-vite";

// F01 delivers the working Storybook configuration; module stories arrive with
// F02 alongside their single components (SPEC-02: stories live next to the
// component).
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  addons: ["@storybook/addon-docs"],
  docs: {
    defaultName: "Docs",
  },
};

export default config;

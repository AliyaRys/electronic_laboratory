import type { Preview } from "@storybook/react-vite";

// Global preview: the visual tokens and decorations arrive with F02 (UI-02
// ownership rules). No app-wide CSS exists yet, so the preview stays empty.
const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;

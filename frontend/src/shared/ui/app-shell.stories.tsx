import type { Meta, StoryObj } from "@storybook/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppShell } from "./AppShell";

const meta: Meta<typeof AppShell> = {
  title: "F02/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof AppShell>;

const routes = [
  {
    element: (
      <AppShell
        user={{ fullName: "Анна Кузнецова", initials: "АК" }}
        session={{ status: "ready" }}
        onLogout={() => undefined}
      />
    ),
    children: [{ path: "*", element: <p style={{ padding: 24 }}>Содержимое рабочего экрана.</p> }],
  },
];

function ShellStory(): React.ReactElement {
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  return <RouterProvider router={router} />;
}

export const Ready: Story = { render: () => <ShellStory /> };

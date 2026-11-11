import type { Meta, StoryObj } from "@storybook/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createQueryClient } from "../../app/providers";
import { catalogWorker } from "../../mocks/catalog-editor-browser";
import { TariffsEditorPage } from "./TariffsEditorPage";
import { CheckServicesEditorPage } from "./CheckServicesEditorPage";
import { MethodsEditorPage } from "./MethodsEditorPage";

/** One worker for the page stories: fixtures only, no demo mockup values. */
const PageStory = ({ route }: { route: string }): React.ReactElement => {
  const router = createMemoryRouter([{ path: "/catalogs", element: <Page route={route} /> }], {
    initialEntries: [route],
  });
  return (
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
};

function Page({ route }: { route: string }): React.ReactElement {
  if (route.includes("tariffs")) return <TariffsEditorPage />;
  if (route.includes("check-services")) return <CheckServicesEditorPage />;
  return <MethodsEditorPage />;
}

let started = false;
const withWorker = async (): Promise<void> => {
  if (!started) {
    started = true;
    await catalogWorker.start({ quiet: true } as never);
  }
};

const meta: Meta<typeof PageStory> = {
  title: "C02/EditorPages",
  parameters: { layout: "padded" },
  decorators: [
    (Story) => {
      void withWorker();
      return Story();
    },
  ],
};
export default meta;
type Story = StoryObj<typeof PageStory>;

export const TariffsWide: Story = {
  render: () => <PageStory route="/catalogs?tab=tariffs" />,
};

export const TariffsNarrow: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <PageStory route="/catalogs?tab=tariffs" />
    </div>
  ),
};

export const PaidServicesWide: Story = {
  render: () => <PageStory route="/catalogs?tab=check-services" />,
};

export const PaidServicesNarrow: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <PageStory route="/catalogs?tab=check-services" />
    </div>
  ),
};

export const NormsWide: Story = {
  render: () => <PageStory route="/catalogs?tab=methods" />,
};

export const NormsNarrow: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <PageStory route="/catalogs?tab=methods" />
    </div>
  ),
};

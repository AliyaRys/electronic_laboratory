import type { Meta, StoryObj } from "@storybook/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createQueryClient } from "../../app/providers";
import { catalogWorker } from "../../mocks/catalog-editor-browser";
import { TariffsEditorPage } from "./TariffsEditorPage";
import { CheckServicesEditorPage } from "./CheckServicesEditorPage";
import { MethodsEditorPage } from "./MethodsEditorPage";

/** One worker for the page stories: fixtures only, no demo mockup values.
 * The story waits for the MSW worker activation so the FIRST boot requests
 * (GET /me, /contexts) are already mocked — no pass-through 404s. */
let workerReady: Promise<unknown> | null = null;
const withWorker = async (): Promise<unknown> => {
  workerReady ??= catalogWorker.start({ quiet: true } as never);
  return workerReady;
};

const PageStory = ({ route }: { route: string }): React.ReactElement => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void withWorker().then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);
  const router = createMemoryRouter([{ path: "/catalogs", element: <Page route={route} /> }], {
    initialEntries: [route],
  });
  if (!ready) return <div aria-busy="true" />;
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

const meta: Meta<typeof PageStory> = {
  title: "C02/EditorPages",
  parameters: { layout: "padded" },
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

/** §18: visual parity against directory-norms-edit — the same page at the
 * mockup width; only real read-model data is shown, never demo numbers. */
export const NormsParityDirectoryNormsEdit: Story = {
  render: () => <PageStory route="/catalogs?tab=methods" />,
};

export const NormsTablet: Story = {
  render: () => (
    <div style={{ width: 768 }}>
      <PageStory route="/catalogs?tab=methods" />
    </div>
  ),
};

export const NormsNarrow: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <PageStory route="/catalogs?tab=methods" />
    </div>
  ),
};

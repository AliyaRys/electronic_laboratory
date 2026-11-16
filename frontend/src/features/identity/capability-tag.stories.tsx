/**
 * DR33 (ТЗ §13): CapabilityTags stories over the shared registry. No local
 * Russian strings — every label comes from capabilityLabels.ts via the same
 * component the profile page uses.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CapabilityTags } from "./CapabilityTag";

const meta: Meta<typeof CapabilityTags> = {
  title: "F03/CapabilityTags",
  component: CapabilityTags,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof CapabilityTags>;

/** VET base rights from PERMISSION_MATRIX. */
const VET_CAPABILITIES = [
  "profile:read",
  "password:change",
  "context:list",
  "operation:read",
  "arrivals:list",
  "arrivals:read",
  "arrivals:search",
  "arrivals:count",
  "arrivals:hide",
  "reconciliation:save",
  "vetis:sync",
  "receipt:submit",
  "receipt:reconcile",
  "examination:create-complete",
  "sample:collect",
  "catalog:read",
];

/** HEAD: the long set (ТЗ §12.3/§13). */
const HEAD_CAPABILITIES = [
  ...VET_CAPABILITIES,
  "examination:list",
  "examination:read",
  "examination:search",
  "examination:count",
  "examination:create-wait",
  "examination:update",
  "examination:complete-waiting",
  "examination:delete",
  "conclusion:preview",
  "conclusion:pdf",
  "conclusion:print",
  "sample:read",
  "sample:reuse",
  "sample:edit",
  "sample:dispose",
  "catalog:create",
  "catalog:update",
  "catalog:delete",
  "catalog:bulk-price",
  "catalog:retry",
  "report:operational",
];

/** ADMIN: user-management rights (ТЗ §6.8). */
const ADMIN_CAPABILITIES = [
  "profile:read",
  "password:change",
  "context:list",
  "operation:read",
  "catalog:read",
  "catalog:create",
  "catalog:update",
  "catalog:delete",
  "catalog:bulk-price",
  "catalog:retry",
  "users:list",
  "users:read",
  "users:history",
  "users:create",
  "users:update",
  "users:block",
  "users:unblock",
  "users:reset-password",
  "users:delete",
];

export const VetBasic: Story = { args: { capabilities: VET_CAPABILITIES } };

export const HeadLongSet: Story = { args: { capabilities: HEAD_CAPABILITIES } };

export const AdminUsers: Story = { args: { capabilities: ADMIN_CAPABILITIES } };

export const NoRights: Story = { args: { capabilities: [] } };

export const UnknownCapability: Story = {
  args: { capabilities: ["arrivals:read", "future:right"] },
};

export const LongNames: Story = {
  args: {
    capabilities: [
      "examination:complete-waiting",
      "context:list",
      "receipt:reconcile",
      "catalog:bulk-price",
      "catalog:retry",
      "users:reset-password",
    ],
  },
};

export const NarrowViewport: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <CapabilityTags capabilities={HEAD_CAPABILITIES} />
    </div>
  ),
};

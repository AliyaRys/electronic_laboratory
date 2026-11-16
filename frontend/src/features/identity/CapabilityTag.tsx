/**
 * DR33 (ТЗ §8): profile capability tag components over the shared registry.
 * The full Russian name stays in the DOM/accessible name; CSS only truncates
 * it visually (ellipsis), and the tooltip carries the full text. An unknown
 * code keeps its data-capability-code for diagnostics without affecting
 * access. Used by the profile page and the Storybook stories alike.
 */
import { capabilityLabel, capabilityTooltip, isKnownCapability } from "./capabilityLabels";

export function CapabilityTag({ capability }: { capability: string }): React.ReactElement {
  const known = isKnownCapability(capability);
  return (
    <span
      className="vse-profile-right-tag"
      title={capabilityTooltip(capability)}
      {...(known ? {} : { "data-capability-code": capability })}
    >
      {capabilityLabel(capability)}
    </span>
  );
}

export function CapabilityTags({ capabilities }: { capabilities: readonly string[] }): React.ReactElement {
  return (
    <div className="vse-profile-rights">
      {capabilities.length === 0 ? (
        <span>Прав не назначено.</span>
      ) : (
        capabilities.map((capability) => <CapabilityTag key={capability} capability={capability} />)
      )}
    </div>
  );
}

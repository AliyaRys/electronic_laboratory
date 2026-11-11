/**
 * Context slot of the editor pages (ТЗ-DR6 §6): the compact laboratory
 * selector for roles with several allowed laboratories (ADMIN/ANALYST; VET
 * read-only pick) and a calm product line. HEAD and single-context roles see
 * NO selector — only the honest name of the assigned laboratory.
 */
import "./catalogs.css";
import { CatalogContextSelector } from "./editor-parts";
import type { CatalogContext } from "./use-catalog-context";

export interface CatalogContextSlotProps {
  context: CatalogContext;
  /** Deep-link update of the URL laboratory; null — no selector is shown. */
  onPick: ((laboratoryId: string) => void) | null;
}

export function CatalogContextSlot({ context, onPick }: CatalogContextSlotProps): React.ReactElement {
  if (onPick === null) {
    // HEAD (and single-context roles): no switcher, no UUID — one calm line.
    return (
      <div className="vse-catalog-context" data-testid="catalog-context-info">
        <p className="vse-catalog-context-note">
          Лаборатория: {context.laboratoryName ?? "название недоступно"} · Продукция: {context.productLabel}
        </p>
      </div>
    );
  }
  return (
    <>
      <CatalogContextSelector
        laboratories={context.laboratories}
        value={context.laboratoryId ?? ""}
        onChange={onPick}
      />
      <p className="vse-catalog-context-note">Продукция: {context.productLabel}</p>
    </>
  );
}

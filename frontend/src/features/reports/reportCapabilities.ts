/**
 * Reporting capability predicates (DR37 §Task 3, FT-RPT-01, O-05): the
 * capability list of GET /me is the single UI source — the role by itself
 * never opens a direction. The role and the laboratory scope stay additional
 * server-side restrictions: every request is re-checked by the backend
 * (API-06/API-08 authorizers), a hidden affordance never replaces that check.
 */
export interface ReportAccess {
  /** «Учёт проб» (API-06) — needs ``sample:read``. */
  samples: boolean;
  /** «Операционные показатели» (API-08) — needs ``report:operational``. */
  operational: boolean;
  /** The saved 5-вет list — needs ``report:5vet-list``. */
  list5vet: boolean;
  /** One saved 5-вет snapshot — needs ``report:5vet-read``. */
  read5vet: boolean;
  /** Creation of 5-вет needs BOTH ``report:5vet-preview`` AND ``report:5vet-save``. */
  create5vet: boolean;
  /** Export/print of a saved snapshot — needs ``report:5vet-export``. */
  export5vet: boolean;
  /** Deletion of a saved snapshot — needs ``report:5vet-delete``. */
  delete5vet: boolean;
  /** At least one reporting direction exists for the user. */
  any: boolean;
}

/** Typed projection of the /me capability strings onto reporting directions. */
export function reportAccess(capabilities: readonly string[] | undefined): ReportAccess {
  const set = new Set(capabilities ?? []);
  const has = (capability: string): boolean => set.has(capability);
  const samples = has("sample:read");
  const operational = has("report:operational");
  const list5vet = has("report:5vet-list");
  const read5vet = has("report:5vet-read");
  const create5vet = has("report:5vet-preview") && has("report:5vet-save");
  const export5vet = has("report:5vet-export");
  const delete5vet = has("report:5vet-delete");
  const any = samples || operational || list5vet || read5vet || create5vet;
  return { samples, operational, list5vet, read5vet, create5vet, export5vet, delete5vet, any };
}

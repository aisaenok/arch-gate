import type {
  ArchitectureModel,
  Fact,
  RepositoryRelationMatch
} from "./model.js";

function repositoryId(
  fact: Fact,
  field: string
): string | undefined {
  const value = fact[field];
  return typeof value === "string" ? value : undefined;
}

export function relatedRepositoryIds(
  model: ArchitectureModel,
  current: Fact,
  match: RepositoryRelationMatch
): Set<string> | undefined {
  const currentRepository = repositoryId(
    current,
    match.currentField
  );
  if (!currentRepository) return undefined;

  const direction = match.direction ?? "outgoing";
  const ids = new Set<string>();

  for (const relation of model.relations) {
    if (relation.type !== match.type) continue;

    if (
      direction === "outgoing" &&
      relation.from === currentRepository
    ) {
      ids.add(relation.to);
    }

    if (
      direction === "incoming" &&
      relation.to === currentRepository
    ) {
      ids.add(relation.from);
    }
  }

  return ids;
}

export function repositoryRelationMatches(
  model: ArchitectureModel,
  current: Fact,
  candidate: Fact,
  match: RepositoryRelationMatch
): boolean {
  const related = relatedRepositoryIds(model, current, match);
  if (!related) return false;

  const candidateRepository = repositoryId(
    candidate,
    match.candidateField
  );

  return (
    candidateRepository !== undefined &&
    related.has(candidateRepository)
  );
}

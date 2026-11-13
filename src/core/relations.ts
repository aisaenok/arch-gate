import type {
  ArchitectureModel,
  Fact,
  RepositoryRelationDirection,
  RepositoryRelationMatch,
  RepositoryRelationStep
} from "./model.js";

function repositoryId(
  fact: Fact,
  field: string
): string | undefined {
  const value = fact[field];
  return typeof value === "string" ? value : undefined;
}

function steps(
  match: RepositoryRelationMatch
): RepositoryRelationStep[] {
  if (match.path) return match.path;

  if (!match.type) return [];

  return [
    {
      type: match.type,
      direction: match.direction
    }
  ];
}

function traverseStep(
  model: ArchitectureModel,
  repositories: Set<string>,
  step: RepositoryRelationStep
): Set<string> {
  const direction: RepositoryRelationDirection =
    step.direction ?? "outgoing";
  const next = new Set<string>();

  for (const relation of model.relations) {
    if (relation.type !== step.type) continue;

    if (
      direction === "outgoing" &&
      repositories.has(relation.from)
    ) {
      next.add(relation.to);
    }

    if (
      direction === "incoming" &&
      repositories.has(relation.to)
    ) {
      next.add(relation.from);
    }
  }

  return next;
}

export function repositoryRelationDescription(
  match: RepositoryRelationMatch
): string {
  return steps(match)
    .map((step) => {
      const direction = step.direction ?? "outgoing";
      return direction === "outgoing"
        ? `->${step.type}`
        : `<-${step.type}`;
    })
    .join(" ");
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

  let repositories = new Set([currentRepository]);

  for (const step of steps(match)) {
    repositories = traverseStep(
      model,
      repositories,
      step
    );

    if (repositories.size === 0) break;
  }

  return repositories;
}

export function repositoryRelationMatches(
  model: ArchitectureModel,
  current: Fact,
  candidate: Fact,
  match: RepositoryRelationMatch
): boolean {
  const related = relatedRepositoryIds(
    model,
    current,
    match
  );
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

import type {
  ArchitectureModel,
  Fact,
  RepositoryRoleSelector,
  RuleSelector
} from "./model.js";

function repositoryHasRole(
  model: ArchitectureModel,
  fact: Fact,
  selector: RepositoryRoleSelector
): boolean {
  const repositoryId = fact[selector.field];
  if (typeof repositoryId !== "string") return false;

  return model.repositories[repositoryId]?.roles.includes(selector.role) ?? false;
}

export function selectFacts(
  model: ArchitectureModel,
  selector: RuleSelector
): Fact[] {
  return model.facts.filter((fact) => {
    if (fact.kind !== selector.fact) return false;

    for (const condition of selector.where ?? []) {
      if (fact[condition.field] !== condition.equals) return false;
    }

    for (const role of selector.repositoryRoles ?? []) {
      if (!repositoryHasRole(model, fact, role)) return false;
    }

    return true;
  });
}

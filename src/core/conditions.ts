import type {
  ArchitectureModel,
  Fact,
  MemberOfSelector,
  RuleCondition
} from "./model.js";
import { relatedRepositoryIds } from "./relations.js";
import { selectFacts } from "./selectors.js";

export interface RelatedMemberMatches {
  related: Set<string> | undefined;
  matching: Set<string>;
}

export function relatedMemberMatches(
  model: ArchitectureModel,
  current: Fact,
  field: string,
  selector: MemberOfSelector
): RelatedMemberMatches {
  const relation = selector.repositoryRelation;
  if (!relation) {
    return {
      related: undefined,
      matching: new Set()
    };
  }

  const related = relatedRepositoryIds(
    model,
    current,
    relation
  );
  const matching = new Set<string>();

  if (!related || related.size === 0) {
    return { related, matching };
  }

  const value = current[field];
  const candidates = selectFacts(model, {
    fact: selector.fact,
    repositoryRoles: selector.repositoryRoles,
    where: selector.where
  });

  for (const candidate of candidates) {
    const candidateRepository =
      candidate[relation.candidateField];

    if (
      typeof candidateRepository !== "string" ||
      !related.has(candidateRepository) ||
      candidate[selector.field] !== value
    ) {
      continue;
    }

    matching.add(candidateRepository);
  }

  return { related, matching };
}

function memberOf(
  model: ArchitectureModel,
  current: Fact,
  field: string,
  selector: MemberOfSelector
): boolean {
  if (selector.repositoryRelation) {
    const { related, matching } = relatedMemberMatches(
      model,
      current,
      field,
      selector
    );

    if (!related || related.size === 0) return false;

    const quantifier =
      selector.repositoryRelation.quantifier ?? "any";

    return quantifier === "all"
      ? [...related].every((repositoryId) =>
          matching.has(repositoryId)
        )
      : matching.size > 0;
  }

  const value = current[field];
  const candidates = selectFacts(model, {
    fact: selector.fact,
    repositoryRoles: selector.repositoryRoles,
    where: selector.where
  });

  return candidates.some((candidate) => {
    if (selector.repositoryMatch) {
      const sourceRepository =
        candidate[selector.repositoryMatch.sourceField];
      const currentRepository =
        current[selector.repositoryMatch.currentField];

      if (sourceRepository !== currentRepository) {
        return false;
      }
    }

    return candidate[selector.field] === value;
  });
}

export function evaluateCondition(
  model: ArchitectureModel,
  fact: Fact,
  condition: RuleCondition
): boolean {
  let result: boolean;

  if (Object.prototype.hasOwnProperty.call(condition, "equals")) {
    result = fact[condition.field] === condition.equals;
  } else if (condition.hasRole !== undefined) {
    const repositoryId = fact[condition.field];
    result =
      typeof repositoryId === "string" &&
      (model.repositories[repositoryId]?.roles.includes(condition.hasRole) ?? false);
  } else if (condition.repositoryExists !== undefined) {
    const repositoryId = fact[condition.field];
    const exists =
      typeof repositoryId === "string" &&
      model.repositories[repositoryId] !== undefined;
    result = condition.repositoryExists ? exists : !exists;
  } else if (condition.memberOf) {
    result = memberOf(
      model,
      fact,
      condition.field,
      condition.memberOf
    );
  } else {
    throw new Error(
      `Unsupported condition for field "${condition.field}"`
    );
  }

  return condition.not ? !result : result;
}

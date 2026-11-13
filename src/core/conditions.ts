import type {
  ArchitectureModel,
  Fact,
  MemberOfSelector,
  RuleCondition
} from "./model.js";
import { selectFacts } from "./selectors.js";

function memberOf(
  model: ArchitectureModel,
  current: Fact,
  field: string,
  selector: MemberOfSelector
): boolean {
  const value = current[field];
  const candidates = selectFacts(model, {
    fact: selector.fact,
    repositoryRoles: selector.repositoryRoles,
    where: selector.where
  });

  return candidates.some((candidate) => {
    if (selector.repositoryMatch) {
      const sourceRepository = candidate[selector.repositoryMatch.sourceField];
      const currentRepository = current[selector.repositoryMatch.currentField];
      if (sourceRepository !== currentRepository) return false;
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
    result = memberOf(model, fact, condition.field, condition.memberOf);
  } else {
    throw new Error(`Unsupported condition for field "${condition.field}"`);
  }

  return condition.not ? !result : result;
}

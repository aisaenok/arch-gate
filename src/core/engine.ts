import type {
  ArchitectureModel,
  CoverageGap,
  EvaluationResult,
  Fact,
  RuleCondition,
  RuleDefinition,
  RuleScope,
  RuleSelector,
  Violation
} from "./model.js";
import { evaluateCondition } from "./conditions.js";
import { relatedRepositoryIds } from "./relations.js";
import { selectFacts } from "./selectors.js";

function ruleApplies(
  rule: RuleDefinition,
  scope: RuleScope
): boolean {
  const ruleScope = rule.scope ?? "both";
  return ruleScope === "both" || ruleScope === scope;
}

function factField(
  fact: Fact,
  field: string | undefined
): string | undefined {
  if (!field) return undefined;
  const value = fact[field];
  return value === null || value === undefined
    ? undefined
    : String(value);
}

function repositoryIdsForSelector(
  model: ArchitectureModel,
  selector: RuleSelector
): Set<string> | undefined {
  const roles = selector.repositoryRoles ?? [];
  if (
    roles.length === 0 ||
    roles.some((role) => role.field !== "repositoryId")
  ) {
    return undefined;
  }

  return new Set(
    Object.values(model.repositories)
      .filter((repository) =>
        roles.every((role) => repository.roles.includes(role.role))
      )
      .map((repository) => repository.id)
  );
}

function selectorCoverage(
  model: ArchitectureModel,
  rule: RuleDefinition,
  selector: RuleSelector
): CoverageGap[] {
  const repositoryIds = repositoryIdsForSelector(model, selector);
  let evidence = model.evidence.filter(
    (item) => item.factKind === selector.fact
  );

  if (repositoryIds) {
    evidence = evidence.filter((item) =>
      repositoryIds.has(item.repositoryId)
    );
  }

  if (evidence.length === 0) {
    return [
      {
        rule: rule.id,
        fact: selector.fact,
        message:
          repositoryIds && repositoryIds.size === 0
            ? `No configured repository matches the roles required by fact "${selector.fact}".`
            : `No analyzer evidence exists for fact "${selector.fact}".`
      }
    ];
  }

  return evidence
    .filter((item) => item.status !== "complete")
    .map((item) => ({
      rule: rule.id,
      fact: selector.fact,
      repositoryId: item.repositoryId,
      message:
        item.message ??
        `Evidence for fact "${selector.fact}" is ${item.status}.`
    }));
}

function baseRequiredSelectors(
  rule: RuleDefinition
): RuleSelector[] {
  const selectors: RuleSelector[] = [rule.select];

  for (const condition of rule.assert) {
    if (
      !condition.memberOf ||
      condition.memberOf.repositoryRelation
    ) {
      continue;
    }

    selectors.push({
      fact: condition.memberOf.fact,
      repositoryRoles: condition.memberOf.repositoryRoles,
      where: condition.memberOf.where
    });
  }

  return selectors;
}

function baseCoverageGaps(
  model: ArchitectureModel,
  rule: RuleDefinition
): CoverageGap[] {
  const gaps: CoverageGap[] = [];

  for (const selector of baseRequiredSelectors(rule)) {
    gaps.push(...selectorCoverage(model, rule, selector));
  }

  return gaps;
}

function relationCoverageGaps(
  model: ArchitectureModel,
  rule: RuleDefinition,
  fact: Fact,
  condition: RuleCondition
): CoverageGap[] {
  const selector = condition.memberOf;
  const relation = selector?.repositoryRelation;

  if (!selector || !relation) return [];

  const related = relatedRepositoryIds(model, fact, relation);
  if (!related) {
    return [
      {
        rule: rule.id,
        fact: selector.fact,
        message:
          `Fact "${fact.kind}" does not contain repository field "${relation.currentField}" required by relation "${relation.type}".`
      }
    ];
  }

  if (related.size === 0) {
    const currentRepository = fact[relation.currentField];
    return [
      {
        rule: rule.id,
        fact: selector.fact,
        repositoryId:
          typeof currentRepository === "string"
            ? currentRepository
            : undefined,
        message:
          `No ${relation.direction ?? "outgoing"} repository relation "${relation.type}" is configured for "${String(currentRepository)}".`
      }
    ];
  }

  const gaps: CoverageGap[] = [];

  for (const repositoryId of related) {
    const evidence = model.evidence.filter(
      (item) =>
        item.factKind === selector.fact &&
        item.repositoryId === repositoryId
    );

    if (evidence.length === 0) {
      gaps.push({
        rule: rule.id,
        fact: selector.fact,
        repositoryId,
        message:
          `No analyzer evidence exists for relation-scoped fact "${selector.fact}" in repository "${repositoryId}".`
      });
      continue;
    }

    for (const item of evidence) {
      if (item.status === "complete") continue;
      gaps.push({
        rule: rule.id,
        fact: selector.fact,
        repositoryId,
        message:
          item.message ??
          `Evidence for relation-scoped fact "${selector.fact}" is ${item.status}.`
      });
    }
  }

  return gaps;
}

function addUniqueGaps(
  target: CoverageGap[],
  seen: Set<string>,
  gaps: CoverageGap[]
): void {
  for (const gap of gaps) {
    const key =
      `${gap.rule}|${gap.fact}|${gap.repositoryId ?? ""}|${gap.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(gap);
  }
}

export function evaluateRules(
  model: ArchitectureModel,
  rules: RuleDefinition[],
  scope: RuleScope
): EvaluationResult {
  const violations: Violation[] = [];
  const gaps: CoverageGap[] = [];
  const seenGaps = new Set<string>();

  for (const rule of rules) {
    if (!ruleApplies(rule, scope)) continue;

    addUniqueGaps(
      gaps,
      seenGaps,
      baseCoverageGaps(model, rule)
    );

    const facts = selectFacts(model, rule.select);

    for (const fact of facts) {
      for (const condition of rule.assert) {
        const conditionGaps = relationCoverageGaps(
          model,
          rule,
          fact,
          condition
        );

        if (conditionGaps.length > 0) {
          addUniqueGaps(gaps, seenGaps, conditionGaps);
          continue;
        }

        if (evaluateCondition(model, fact, condition)) continue;

        violations.push({
          rule: rule.id,
          message: condition.message ?? rule.description,
          source: factField(fact, rule.sourceField),
          target: factField(fact, rule.targetField),
          details: {
            fact: fact.kind,
            field: condition.field
          }
        });
      }
    }
  }

  return {
    status:
      violations.length > 0
        ? "fail"
        : gaps.length > 0
          ? "partial"
          : "pass",
    violations,
    gaps
  };
}

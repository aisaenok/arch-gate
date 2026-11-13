import type {
  ArchitectureModel,
  CoverageGap,
  EvaluationResult,
  Fact,
  FactEvidence,
  RuleDefinition,
  RuleScope,
  RuleSelector,
  Violation
} from "./model.js";
import { evaluateCondition } from "./conditions.js";
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

function requiredSelectors(rule: RuleDefinition): RuleSelector[] {
  const selectors: RuleSelector[] = [rule.select];

  for (const condition of rule.assert) {
    if (!condition.memberOf) continue;
    selectors.push({
      fact: condition.memberOf.fact,
      repositoryRoles: condition.memberOf.repositoryRoles,
      where: condition.memberOf.where
    });
  }

  return selectors;
}

function coverageGaps(
  model: ArchitectureModel,
  rule: RuleDefinition
): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  const seen = new Set<string>();

  for (const selector of requiredSelectors(rule)) {
    for (const gap of selectorCoverage(model, rule, selector)) {
      const key = `${gap.rule}|${gap.fact}|${gap.repositoryId ?? ""}|${gap.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      gaps.push(gap);
    }
  }

  return gaps;
}

export function evaluateRules(
  model: ArchitectureModel,
  rules: RuleDefinition[],
  scope: RuleScope
): EvaluationResult {
  const violations: Violation[] = [];
  const gaps: CoverageGap[] = [];

  for (const rule of rules) {
    if (!ruleApplies(rule, scope)) continue;

    gaps.push(...coverageGaps(model, rule));

    const facts = selectFacts(model, rule.select);

    for (const fact of facts) {
      for (const condition of rule.assert) {
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

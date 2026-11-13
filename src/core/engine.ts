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
import {
  evaluateCondition,
  relatedMemberMatches
} from "./conditions.js";
import {
  relatedRepositoryIds,
  repositoryRelationDescription
} from "./relations.js";
import { selectFacts } from "./selectors.js";

type ConditionStatus = "pass" | "fail" | "partial";

interface ConditionEvaluation {
  status: ConditionStatus;
  gaps?: CoverageGap[];
  details?: Record<string, string>;
}

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
        roles.every((role) =>
          repository.roles.includes(role.role)
        )
      )
      .map((repository) => repository.id)
  );
}

function selectorCoverage(
  model: ArchitectureModel,
  rule: RuleDefinition,
  selector: RuleSelector
): CoverageGap[] {
  const repositoryIds = repositoryIdsForSelector(
    model,
    selector
  );
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
      repositoryRoles:
        condition.memberOf.repositoryRoles,
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

function evidenceIsComplete(
  model: ArchitectureModel,
  factKind: string,
  repositoryId: string
): boolean {
  const evidence = model.evidence.filter(
    (item) =>
      item.factKind === factKind &&
      item.repositoryId === repositoryId
  );

  return (
    evidence.length > 0 &&
    evidence.every((item) => item.status === "complete")
  );
}

function evidenceGap(
  model: ArchitectureModel,
  rule: RuleDefinition,
  factKind: string,
  repositoryId: string
): CoverageGap {
  const evidence = model.evidence.filter(
    (item) =>
      item.factKind === factKind &&
      item.repositoryId === repositoryId
  );

  if (evidence.length === 0) {
    return {
      rule: rule.id,
      fact: factKind,
      repositoryId,
      message:
        `No analyzer evidence exists for relation-scoped fact "${factKind}" in repository "${repositoryId}".`
    };
  }

  const nonComplete = evidence.find(
    (item) => item.status !== "complete"
  );

  return {
    rule: rule.id,
    fact: factKind,
    repositoryId,
    message:
      nonComplete?.message ??
      `Evidence for relation-scoped fact "${factKind}" is incomplete.`
  };
}

function invertStatus(
  status: ConditionStatus,
  not: boolean | undefined
): ConditionStatus {
  if (!not || status === "partial") return status;
  return status === "pass" ? "fail" : "pass";
}

function relationCondition(
  model: ArchitectureModel,
  rule: RuleDefinition,
  fact: Fact,
  condition: RuleCondition
): ConditionEvaluation | undefined {
  const selector = condition.memberOf;
  const relation = selector?.repositoryRelation;

  if (!selector || !relation) return undefined;

  const related = relatedRepositoryIds(
    model,
    fact,
    relation
  );

  if (!related) {
    return {
      status: "partial",
      gaps: [
        {
          rule: rule.id,
          fact: selector.fact,
          message:
            `Fact "${fact.kind}" does not contain repository field "${relation.currentField}" required by repository relation path "${repositoryRelationDescription(relation)}".`
        }
      ]
    };
  }

  if (related.size === 0) {
    const currentRepository =
      fact[relation.currentField];

    return {
      status: "partial",
      gaps: [
        {
          rule: rule.id,
          fact: selector.fact,
          repositoryId:
            typeof currentRepository === "string"
              ? currentRepository
              : undefined,
          message:
            `Repository relation path "${repositoryRelationDescription(relation)}" reaches no repositories from "${String(currentRepository)}".`
        }
      ]
    };
  }

  const { matching } = relatedMemberMatches(
    model,
    fact,
    condition.field,
    selector
  );
  const quantifier = relation.quantifier ?? "any";

  let status: ConditionStatus;
  let unknown = new Set<string>();
  let missing = new Set<string>();

  if (quantifier === "any") {
    if (matching.size > 0) {
      status = "pass";
    } else {
      unknown = new Set(
        [...related].filter(
          (repositoryId) =>
            !evidenceIsComplete(
              model,
              selector.fact,
              repositoryId
            )
        )
      );

      status =
        unknown.size > 0 ? "partial" : "fail";
      missing = new Set(related);
    }
  } else {
    missing = new Set(
      [...related].filter(
        (repositoryId) =>
          !matching.has(repositoryId)
      )
    );

    if (missing.size === 0) {
      status = "pass";
    } else {
      unknown = new Set(
        [...missing].filter(
          (repositoryId) =>
            !evidenceIsComplete(
              model,
              selector.fact,
              repositoryId
            )
        )
      );

      const provenMissing = [...missing].filter(
        (repositoryId) =>
          !unknown.has(repositoryId)
      );

      status =
        provenMissing.length > 0
          ? "fail"
          : "partial";
    }
  }

  const finalStatus = invertStatus(
    status,
    condition.not
  );

  if (finalStatus === "partial") {
    return {
      status: "partial",
      gaps: [...unknown].map((repositoryId) =>
        evidenceGap(
          model,
          rule,
          selector.fact,
          repositoryId
        )
      )
    };
  }

  return {
    status: finalStatus,
    details: {
      quantifier,
      relatedRepositories: [...related].join(","),
      matchingRepositories: [...matching].join(","),
      missingRepositories: [...missing].join(",")
    }
  };
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
        const relationEvaluation = relationCondition(
          model,
          rule,
          fact,
          condition
        );

        if (relationEvaluation) {
          if (relationEvaluation.status === "partial") {
            addUniqueGaps(
              gaps,
              seenGaps,
              relationEvaluation.gaps ?? []
            );
            continue;
          }

          if (relationEvaluation.status === "pass") {
            continue;
          }

          violations.push({
            rule: rule.id,
            message:
              condition.message ?? rule.description,
            source: factField(
              fact,
              rule.sourceField
            ),
            target: factField(
              fact,
              rule.targetField
            ),
            details: {
              fact: fact.kind,
              field: condition.field,
              ...(relationEvaluation.details ?? {})
            }
          });
          continue;
        }

        if (evaluateCondition(model, fact, condition)) {
          continue;
        }

        violations.push({
          rule: rule.id,
          message:
            condition.message ?? rule.description,
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

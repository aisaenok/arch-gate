import type {
  ArchitectureModel,
  Fact,
  RuleDefinition,
  RuleScope,
  Violation
} from "./model.js";
import { evaluateCondition } from "./conditions.js";
import { selectFacts } from "./selectors.js";

function ruleApplies(rule: RuleDefinition, scope: RuleScope): boolean {
  const ruleScope = rule.scope ?? "both";
  return ruleScope === "both" || ruleScope === scope;
}

function factField(fact: Fact, field: string | undefined): string | undefined {
  if (!field) return undefined;
  const value = fact[field];
  return value === null || value === undefined ? undefined : String(value);
}

export function evaluateRules(
  model: ArchitectureModel,
  rules: RuleDefinition[],
  scope: RuleScope
): Violation[] {
  const violations: Violation[] = [];

  for (const rule of rules) {
    if (!ruleApplies(rule, scope)) continue;

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

  return violations;
}

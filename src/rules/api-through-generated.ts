import type {
  ApiThroughGeneratedRuleConfig,
  ArchitectureModel,
  Violation
} from "../core/model.js";

function hasRole(roles: string[], role: string): boolean {
  return roles.includes(role);
}

export function checkApiThroughGenerated(
  model: ArchitectureModel,
  rule: ApiThroughGeneratedRuleConfig
): Violation[] {
  const consumerIds = new Set(
    Object.values(model.repositories)
      .filter((repository) => hasRole(repository.roles, rule.consumerRole))
      .map((repository) => repository.id)
  );

  const violations: Violation[] = [];

  for (const facts of model.typescript) {
    if (!consumerIds.has(facts.repositoryId)) continue;

    for (const usage of facts.httpUsages) {
      if (usage.directHttpAllowed) continue;

      violations.push({
        rule: "ARCH001",
        source: usage.source,
        target: usage.target,
        message: `Repository "${facts.repositoryId}" uses direct HTTP transport outside its generated runtime boundary.`,
        details: {
          repository: facts.repositoryId,
          consumerRole: rule.consumerRole,
          expected: "generated runtime API",
          actual: usage.kind
        }
      });
    }
  }

  return violations;
}

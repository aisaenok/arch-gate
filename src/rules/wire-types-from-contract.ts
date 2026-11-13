import type {
  ArchitectureModel,
  Violation,
  WireTypesFromContractRuleConfig
} from "../core/model.js";

function hasRole(roles: string[], role: string): boolean {
  return roles.includes(role);
}

export function checkWireTypesFromContract(
  model: ArchitectureModel,
  rule: WireTypesFromContractRuleConfig
): Violation[] {
  const consumerIds = new Set(
    Object.values(model.repositories)
      .filter((repository) => hasRole(repository.roles, rule.consumerRole))
      .map((repository) => repository.id)
  );

  const contractIds = new Set(
    Object.values(model.repositories)
      .filter((repository) => hasRole(repository.roles, rule.contractRole))
      .map((repository) => repository.id)
  );

  const ownersBySchema = new Map<string, string[]>();

  for (const catalog of model.contracts) {
    if (!contractIds.has(catalog.repositoryId)) continue;

    for (const schemaName of catalog.schemaNames) {
      const owners = ownersBySchema.get(schemaName) ?? [];
      owners.push(catalog.repositoryId);
      ownersBySchema.set(schemaName, owners);
    }
  }

  const violations: Violation[] = [];

  for (const facts of model.typescript) {
    if (!consumerIds.has(facts.repositoryId)) continue;

    for (const declaration of facts.declaredTypes) {
      if (declaration.manualContractTypeAllowed) continue;

      const owners = ownersBySchema.get(declaration.name);
      if (!owners) continue;

      violations.push({
        rule: "ARCH002",
        source: declaration.source,
        target: declaration.name,
        message: `Repository "${facts.repositoryId}" manually declares a type owned by a contract repository.`,
        details: {
          repository: facts.repositoryId,
          contractRepositories: owners.join(", "),
          expected: `${declaration.name} generated from contract`,
          actual: `manual ${declaration.kind} declaration`
        }
      });
    }
  }

  return violations;
}

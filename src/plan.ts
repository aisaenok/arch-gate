import { readFile } from "node:fs/promises";
import type {
  ArchitectureIntent,
  ArchitectureModel,
  ResolvedGateConfig,
  Violation
} from "./core/model.js";

export async function loadIntent(file: string): Promise<ArchitectureIntent> {
  return JSON.parse(await readFile(file, "utf8")) as ArchitectureIntent;
}

function hasRole(roles: string[], role: string): boolean {
  return roles.includes(role);
}

function unknownRepository(id: string): Violation {
  return {
    rule: "PLAN000",
    target: id,
    message: `Architecture intent references unknown repository "${id}".`
  };
}

export function checkPlan(
  intent: ArchitectureIntent,
  model: ArchitectureModel,
  config: ResolvedGateConfig
): Violation[] {
  const violations: Violation[] = [];
  const apiRule = config.rules.apiThroughGenerated;
  const wireRule = config.rules.wireTypesFromContract;

  for (const apiCall of intent.apiCalls ?? []) {
    const consumer = model.repositories[apiCall.consumer];
    const provider = model.repositories[apiCall.provider];

    if (!consumer) {
      violations.push(unknownRepository(apiCall.consumer));
      continue;
    }

    if (!provider) {
      violations.push(unknownRepository(apiCall.provider));
      continue;
    }

    if (!apiRule) continue;
    if (!hasRole(consumer.roles, apiRule.consumerRole)) continue;
    if (!hasRole(provider.roles, apiRule.providerRole)) continue;

    const contractIds = new Set(
      Object.values(model.repositories)
        .filter((repository) => hasRole(repository.roles, apiRule.contractRole))
        .map((repository) => repository.id)
    );

    const operationExists = model.contracts.some(
      (catalog) =>
        contractIds.has(catalog.repositoryId) &&
        catalog.operationIds.has(apiCall.operationId)
    );

    if (!operationExists) {
      violations.push({
        rule: "PLAN001",
        target: apiCall.operationId,
        message: "Planned API operation is not declared by a configured contract repository.",
        details: {
          consumer: apiCall.consumer,
          provider: apiCall.provider,
          contractRole: apiRule.contractRole
        }
      });
    }

    if (apiCall.via !== "generated-runtime") {
      violations.push({
        rule: "PLAN002",
        target: apiCall.operationId,
        message: "Planned API access must go through generated runtime API.",
        details: {
          consumer: apiCall.consumer,
          provider: apiCall.provider,
          expected: "generated-runtime",
          actual: apiCall.via
        }
      });
    }
  }

  for (const wireType of intent.wireTypes ?? []) {
    const consumer = model.repositories[wireType.consumer];
    const source = model.repositories[wireType.source];

    if (!consumer) {
      violations.push(unknownRepository(wireType.consumer));
      continue;
    }

    if (!source) {
      violations.push(unknownRepository(wireType.source));
      continue;
    }

    if (!wireRule || !hasRole(consumer.roles, wireRule.consumerRole)) continue;

    const sourceIsContract = hasRole(source.roles, wireRule.contractRole);
    const sourceCatalog = model.contracts.find(
      (catalog) => catalog.repositoryId === source.id
    );

    if (!sourceIsContract) {
      violations.push({
        rule: "PLAN004",
        target: wireType.name,
        message: "Planned wire DTO source is not a configured contract repository.",
        details: {
          consumer: wireType.consumer,
          source: wireType.source,
          expectedRole: wireRule.contractRole
        }
      });
      continue;
    }

    if (!sourceCatalog?.schemaNames.has(wireType.name)) {
      violations.push({
        rule: "PLAN003",
        target: wireType.name,
        message: "Planned wire type is not declared by its contract repository.",
        details: {
          contractRepository: wireType.source,
          schema: wireType.name
        }
      });
    }
  }

  return violations;
}

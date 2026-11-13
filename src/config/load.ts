import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import {
  assertFactField,
  assertKnownFactKind
} from "../core/facts.js";
import type {
  JavaFramework,
  MemberOfSelector,
  RawGateConfig,
  RepositoryRelation,
  ResolvedGateConfig,
  ResolvedRepository,
  RuleCondition,
  RuleDefinition,
  RuleSelector
} from "../core/model.js";

const JAVA_FRAMEWORKS = new Set<JavaFramework>(["jax-rs"]);

function requireRoles(repositoryId: string, roles: unknown): string[] {
  if (!Array.isArray(roles) || roles.some((role) => typeof role !== "string")) {
    throw new Error(`Repository "${repositoryId}" must define roles as an array of strings`);
  }

  return roles;
}

function requireJavaFrameworks(
  repositoryId: string,
  frameworks: unknown
): JavaFramework[] {
  if (frameworks === undefined) return [];

  if (!Array.isArray(frameworks) || frameworks.some((item) => typeof item !== "string")) {
    throw new Error(
      `Java repository "${repositoryId}" must define frameworks as an array of strings`
    );
  }

  for (const framework of frameworks) {
    if (!JAVA_FRAMEWORKS.has(framework as JavaFramework)) {
      throw new Error(
        `Java repository "${repositoryId}" references unsupported framework "${framework}". Supported: ${[...JAVA_FRAMEWORKS].join(", ")}`
      );
    }
  }

  return frameworks as JavaFramework[];
}

function validateRelations(
  repositories: RawGateConfig["repositories"],
  relations: unknown
): RepositoryRelation[] {
  if (relations === undefined) return [];

  if (!Array.isArray(relations)) {
    throw new Error("Config relations must be an array");
  }

  const result: RepositoryRelation[] = [];
  const seen = new Set<string>();

  for (const [index, value] of relations.entries()) {
    if (!value || typeof value !== "object") {
      throw new Error(`Relation at index ${index} must be an object`);
    }

    const relation = value as Partial<RepositoryRelation>;

    if (
      typeof relation.type !== "string" ||
      relation.type.trim() === "" ||
      typeof relation.from !== "string" ||
      relation.from.trim() === "" ||
      typeof relation.to !== "string" ||
      relation.to.trim() === ""
    ) {
      throw new Error(
        `Relation at index ${index} must define non-empty type, from and to`
      );
    }

    if (!repositories[relation.from]) {
      throw new Error(
        `Relation "${relation.type}" references unknown source repository "${relation.from}"`
      );
    }

    if (!repositories[relation.to]) {
      throw new Error(
        `Relation "${relation.type}" references unknown target repository "${relation.to}"`
      );
    }

    const key = `${relation.type}|${relation.from}|${relation.to}`;
    if (seen.has(key)) {
      throw new Error(
        `Duplicate repository relation "${relation.type}": ${relation.from} -> ${relation.to}`
      );
    }

    seen.add(key);
    result.push({
      type: relation.type,
      from: relation.from,
      to: relation.to
    });
  }

  return result;
}

function validateSelector(
  ruleId: string,
  selector: RuleSelector,
  context: string
): void {
  assertKnownFactKind(selector.fact, context);

  for (const role of selector.repositoryRoles ?? []) {
    assertFactField(selector.fact, role.field, context);
  }

  for (const condition of selector.where ?? []) {
    assertFactField(selector.fact, condition.field, context);
  }
}

function validateMemberOf(
  ruleId: string,
  currentFact: string,
  selector: MemberOfSelector,
  relationTypes: Set<string>
): void {
  const context = `Rule "${ruleId}" memberOf`;
  assertKnownFactKind(selector.fact, context);
  assertFactField(selector.fact, selector.field, context);

  for (const role of selector.repositoryRoles ?? []) {
    assertFactField(selector.fact, role.field, context);
  }

  for (const condition of selector.where ?? []) {
    assertFactField(selector.fact, condition.field, context);
  }

  if (selector.repositoryMatch && selector.repositoryRelation) {
    throw new Error(
      `${context} cannot define both repositoryMatch and repositoryRelation`
    );
  }

  if (selector.repositoryMatch) {
    assertFactField(selector.fact, selector.repositoryMatch.sourceField, context);
    assertFactField(currentFact, selector.repositoryMatch.currentField, context);
  }

  if (selector.repositoryRelation) {
    const relation = selector.repositoryRelation;

    if (!relationTypes.has(relation.type)) {
      throw new Error(
        `${context} references unknown repository relation type "${relation.type}"`
      );
    }

    if (
      relation.direction !== undefined &&
      relation.direction !== "outgoing" &&
      relation.direction !== "incoming"
    ) {
      throw new Error(
        `${context} repositoryRelation.direction must be outgoing or incoming`
      );
    }

    assertFactField(
      currentFact,
      relation.currentField,
      `${context} repositoryRelation.currentField`
    );
    assertFactField(
      selector.fact,
      relation.candidateField,
      `${context} repositoryRelation.candidateField`
    );
  }
}

function validateCondition(
  ruleId: string,
  factKind: string,
  condition: RuleCondition,
  relationTypes: Set<string>
): void {
  const operators = [
    Object.prototype.hasOwnProperty.call(condition, "equals"),
    typeof condition.hasRole === "string",
    typeof condition.repositoryExists === "boolean",
    condition.memberOf !== undefined
  ].filter(Boolean).length;

  if (operators !== 1) {
    throw new Error(
      `Rule "${ruleId}" condition for field "${condition.field}" must define exactly one operator`
    );
  }

  assertFactField(factKind, condition.field, `Rule "${ruleId}"`);

  if (condition.memberOf) {
    validateMemberOf(
      ruleId,
      factKind,
      condition.memberOf,
      relationTypes
    );
  }
}

function validateRule(
  rule: RuleDefinition,
  relationTypes: Set<string>
): void {
  if (!rule.id || !rule.description || !rule.select?.fact) {
    throw new Error("Every rule must define id, description and select.fact");
  }

  validateSelector(rule.id, rule.select, `Rule "${rule.id}" selector`);

  if (!Array.isArray(rule.assert) || rule.assert.length === 0) {
    throw new Error(`Rule "${rule.id}" must define at least one assertion`);
  }

  for (const condition of rule.assert) {
    validateCondition(
      rule.id,
      rule.select.fact,
      condition,
      relationTypes
    );
  }

  if (rule.sourceField) {
    assertFactField(
      rule.select.fact,
      rule.sourceField,
      `Rule "${rule.id}" sourceField`
    );
  }

  if (rule.targetField) {
    assertFactField(
      rule.select.fact,
      rule.targetField,
      `Rule "${rule.id}" targetField`
    );
  }
}

export async function loadConfig(configFile: string): Promise<ResolvedGateConfig> {
  const absoluteConfig = path.resolve(configFile);
  const configDir = path.dirname(absoluteConfig);
  const raw = parse(await readFile(absoluteConfig, "utf8")) as RawGateConfig;

  if (!raw.repositories || Object.keys(raw.repositories).length === 0) {
    throw new Error("Config must define at least one repository");
  }

  if (!Array.isArray(raw.rules)) {
    throw new Error("Config must define rules as an array");
  }

  const relations = validateRelations(
    raw.repositories,
    raw.relations
  );
  const relationTypes = new Set(
    relations.map((relation) => relation.type)
  );

  raw.rules.forEach((rule) =>
    validateRule(rule, relationTypes)
  );

  const repositories: Record<string, ResolvedRepository> = {};

  for (const [id, repository] of Object.entries(raw.repositories)) {
    const root = path.resolve(configDir, repository.root);
    const roles = requireRoles(id, repository.roles);

    if (repository.type === "typescript") {
      repositories[id] = {
        id,
        type: "typescript",
        root,
        roles,
        sourceDir: path.resolve(root, repository.sourceDir ?? "src"),
        generatedRuntimeDirs: (repository.generatedRuntimeDirs ?? []).map((dir) =>
          path.resolve(root, dir)
        ),
        allowDirectHttpDirs: (repository.allowDirectHttpDirs ?? []).map((dir) =>
          path.resolve(root, dir)
        ),
        allowManualContractTypeDirs: (
          repository.allowManualContractTypeDirs ?? []
        ).map((dir) => path.resolve(root, dir)),
        httpModules: repository.httpModules ?? ["axios"]
      };
      continue;
    }

    if (repository.type === "openapi") {
      if (!repository.openapi) {
        throw new Error(`OpenAPI repository "${id}" must define "openapi"`);
      }

      repositories[id] = {
        id,
        type: "openapi",
        root,
        roles,
        openapiFile: path.resolve(root, repository.openapi)
      };
      continue;
    }

    if (repository.type === "java") {
      repositories[id] = {
        id,
        type: "java",
        root,
        roles,
        sourceDirs: (repository.sourceDirs ?? ["."]).map((dir) =>
          path.resolve(root, dir)
        ),
        frameworks: requireJavaFrameworks(id, repository.frameworks)
      };
      continue;
    }

    const unsupported = repository as { type?: string };
    throw new Error(
      `Unsupported repository type "${unsupported.type ?? "<missing>"}" for "${id}"`
    );
  }

  return {
    configFile: absoluteConfig,
    repositories,
    relations,
    rules: raw.rules
  };
}

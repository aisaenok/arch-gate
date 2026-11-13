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

function validateSelector(ruleId: string, selector: RuleSelector, context: string): void {
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
  selector: MemberOfSelector
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

  if (selector.repositoryMatch) {
    assertFactField(selector.fact, selector.repositoryMatch.sourceField, context);
    assertFactField(currentFact, selector.repositoryMatch.currentField, context);
  }
}

function validateCondition(
  ruleId: string,
  factKind: string,
  condition: RuleCondition
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
    validateMemberOf(ruleId, factKind, condition.memberOf);
  }
}

function validateRule(rule: RuleDefinition): void {
  if (!rule.id || !rule.description || !rule.select?.fact) {
    throw new Error("Every rule must define id, description and select.fact");
  }

  validateSelector(rule.id, rule.select, `Rule "${rule.id}" selector`);

  if (!Array.isArray(rule.assert) || rule.assert.length === 0) {
    throw new Error(`Rule "${rule.id}" must define at least one assertion`);
  }

  for (const condition of rule.assert) {
    validateCondition(rule.id, rule.select.fact, condition);
  }

  if (rule.sourceField) {
    assertFactField(rule.select.fact, rule.sourceField, `Rule "${rule.id}" sourceField`);
  }

  if (rule.targetField) {
    assertFactField(rule.select.fact, rule.targetField, `Rule "${rule.id}" targetField`);
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

  raw.rules.forEach(validateRule);

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
    rules: raw.rules
  };
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  RawGateConfig,
  ResolvedGateConfig,
  ResolvedRepository
} from "../core/model.js";

function requireRoles(repositoryId: string, roles: unknown): string[] {
  if (!Array.isArray(roles) || roles.some((role) => typeof role !== "string")) {
    throw new Error(`Repository "${repositoryId}" must define roles as an array of strings`);
  }

  return roles;
}

export async function loadConfig(configFile: string): Promise<ResolvedGateConfig> {
  const absoluteConfig = path.resolve(configFile);
  const configDir = path.dirname(absoluteConfig);
  const raw = JSON.parse(await readFile(absoluteConfig, "utf8")) as RawGateConfig;

  if (!raw.repositories || Object.keys(raw.repositories).length === 0) {
    throw new Error("Config must define at least one repository");
  }

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
        generatedRuntimeDirs: (repository.generatedRuntimeDirs ?? []).map((dir) => path.resolve(root, dir)),
        allowDirectHttpDirs: (repository.allowDirectHttpDirs ?? []).map((dir) => path.resolve(root, dir)),
        allowManualContractTypeDirs: (repository.allowManualContractTypeDirs ?? []).map((dir) => path.resolve(root, dir)),
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
        roles
      };
      continue;
    }

    const unsupported = repository as { type?: string };
    throw new Error(`Unsupported repository type "${unsupported.type ?? "<missing>"}" for "${id}"`);
  }

  return {
    configFile: absoluteConfig,
    repositories,
    rules: raw.rules ?? {}
  };
}

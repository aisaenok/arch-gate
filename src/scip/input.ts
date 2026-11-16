import type {
  ResolvedJavaRepository,
  ResolvedRepository,
  ResolvedTypeScriptRepository
} from "../core/model.js";
import {
  loadScipIndex,
  type ScipIndex
} from "./index.js";
import { ScipWorkspace } from "./workspace.js";

type ScipRepository =
  | ResolvedJavaRepository
  | ResolvedTypeScriptRepository;

function hasScipInput(
  repository: ResolvedRepository
): repository is ScipRepository {
  return (
    repository.type === "java" ||
    repository.type === "typescript"
  );
}

export async function loadScipWorkspace(
  repositories: readonly ResolvedRepository[]
): Promise<ScipWorkspace> {
  const entries = await Promise.all(
    repositories
      .filter(hasScipInput)
      .filter(
        (repository) =>
          repository.scipIndexFile !== undefined
      )
      .map(async (repository) => ({
        repositoryId: repository.id,
        repositoryRoot: repository.root,
        index: await loadScipIndex(
          repository.scipIndexFile!
        )
      }))
  );

  return new ScipWorkspace(entries);
}

export async function loadJavaScipInput(
  repository: ResolvedJavaRepository
): Promise<ScipIndex | undefined> {
  if (!repository.scipIndexFile) {
    return undefined;
  }

  return loadScipIndex(repository.scipIndexFile);
}

export async function loadTypeScriptScipInput(
  repository: ResolvedTypeScriptRepository
): Promise<ScipIndex | undefined> {
  if (!repository.scipIndexFile) {
    return undefined;
  }

  return loadScipIndex(repository.scipIndexFile);
}

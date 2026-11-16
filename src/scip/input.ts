import type {
  ResolvedRepository
} from "../core/model.js";
import {
  loadScipIndex
} from "./index.js";
import { ScipWorkspace } from "./workspace.js";

type ScipRepository = Extract<
  ResolvedRepository,
  { type: "java" | "typescript" }
>;

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

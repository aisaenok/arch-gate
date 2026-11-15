import type {
  ResolvedJavaRepository
} from "../core/model.js";
import {
  loadScipIndex,
  type ScipIndex
} from "./index.js";

export async function loadJavaScipInput(
  repository: ResolvedJavaRepository
): Promise<ScipIndex | undefined> {
  if (!repository.scipIndexFile) {
    return undefined;
  }

  return loadScipIndex(repository.scipIndexFile);
}

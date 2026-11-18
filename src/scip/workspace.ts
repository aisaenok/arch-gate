import path from "node:path";
import type { Document } from "@scip-code/scip";
import type { ScipIndex } from "./index.js";

function isLocalSymbol(symbol: string): boolean {
  return symbol.startsWith("local ");
}

export interface ScipWorkspaceRepository {
  repositoryId: string;
  repositoryRoot: string;
  index: ScipIndex;
}

export interface ScipWorkspaceDefinition {
  repositoryId: string;
  repositoryRoot: string;
  index: ScipIndex;
  document: Document;
  absolutePath: string;
}

export type ScipWorkspaceDefinitionResolution =
  | {
      status: "found";
      definition: ScipWorkspaceDefinition;
    }
  | {
      status: "missing";
    }
  | {
      status: "ambiguous";
      definitions: ScipWorkspaceDefinition[];
    };

export class ScipWorkspace {
  private readonly repositories = new Map<
    string,
    ScipWorkspaceRepository
  >();

  constructor(
    repositories: readonly ScipWorkspaceRepository[]
  ) {
    for (const repository of repositories) {
      if (
        this.repositories.has(
          repository.repositoryId
        )
      ) {
        throw new Error(
          `duplicate SCIP workspace repository "${repository.repositoryId}"`
        );
      }

      this.repositories.set(
        repository.repositoryId,
        repository
      );
    }
  }

  getIndex(
    repositoryId: string
  ): ScipIndex | undefined {
    return this.repositories.get(repositoryId)?.index;
  }

  getRepositoryIds(): string[] {
    return [...this.repositories.keys()];
  }

  resolveDefinition(
    symbol: string
  ): ScipWorkspaceDefinitionResolution {
    if (!symbol || isLocalSymbol(symbol)) {
      return { status: "missing" };
    }

    const matches: ScipWorkspaceDefinition[] = [];

    for (const repository of this.repositories.values()) {
      const document =
        repository.index.getDefiningDocument(symbol);

      if (!document) {
        continue;
      }

      matches.push({
        repositoryId: repository.repositoryId,
        repositoryRoot: repository.repositoryRoot,
        index: repository.index,
        document,
        absolutePath: path.resolve(
          repository.repositoryRoot,
          document.relativePath
        )
      });
    }

    if (matches.length === 0) {
      return { status: "missing" };
    }

    if (matches.length > 1) {
      return {
        status: "ambiguous",
        definitions: matches
      };
    }

    return {
      status: "found",
      definition: matches[0]!
    };
  }

  findDefinition(
    symbol: string
  ): ScipWorkspaceDefinition | undefined {
    const resolution = this.resolveDefinition(symbol);

    if (resolution.status === "missing") {
      return undefined;
    }

    if (resolution.status === "ambiguous") {
      throw new Error(
        `SCIP symbol "${symbol}" has definitions in multiple workspace repositories: ${resolution.definitions
          .map((match) => match.repositoryId)
          .join(", ")}`
      );
    }

    return resolution.definition;
  }
}

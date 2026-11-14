import { readFile } from "node:fs/promises";
import { fromBinary } from "@bufbuild/protobuf";
import {
  IndexSchema,
  type Document,
  type Index,
  type Occurrence,
  type SymbolInformation
} from "@scip-code/scip";

export class ScipIndex {
  private readonly documentsByPath = new Map<string, Document>();
  private readonly symbolInformationById = new Map<
    string,
    SymbolInformation
  >();
  private readonly definingDocumentBySymbol = new Map<
    string,
    Document
  >();
  private readonly implementationsByTarget = new Map<
    string,
    Set<string>
  >();

  constructor(readonly raw: Index) {
    for (const document of raw.documents) {
      if (this.documentsByPath.has(document.relativePath)) {
        throw new Error(
          `duplicate SCIP document "${document.relativePath}"`
        );
      }

      this.documentsByPath.set(document.relativePath, document);

      for (const symbol of document.symbols) {
        this.indexSymbol(symbol, document);
      }
    }

    for (const symbol of raw.externalSymbols) {
      this.indexSymbol(symbol);
    }
  }

  private indexSymbol(
    information: SymbolInformation,
    definingDocument?: Document
  ): void {
    if (!information.symbol) {
      throw new Error("SCIP SymbolInformation is missing symbol");
    }

    if (this.symbolInformationById.has(information.symbol)) {
      throw new Error(
        `duplicate SCIP SymbolInformation "${information.symbol}"`
      );
    }

    this.symbolInformationById.set(
      information.symbol,
      information
    );

    if (definingDocument) {
      this.definingDocumentBySymbol.set(
        information.symbol,
        definingDocument
      );
    }

    for (const relationship of information.relationships) {
      if (!relationship.isImplementation) {
        continue;
      }

      const implementations =
        this.implementationsByTarget.get(
          relationship.symbol
        ) ?? new Set<string>();

      implementations.add(information.symbol);
      this.implementationsByTarget.set(
        relationship.symbol,
        implementations
      );
    }
  }

  getDocument(relativePath: string): Document | undefined {
    return this.documentsByPath.get(relativePath);
  }

  getOccurrences(
    relativePath: string
  ): readonly Occurrence[] {
    return (
      this.documentsByPath.get(relativePath)?.occurrences ?? []
    );
  }

  getSymbolInformation(
    symbol: string
  ): SymbolInformation | undefined {
    return this.symbolInformationById.get(symbol);
  }

  getDefiningDocument(
    symbol: string
  ): Document | undefined {
    return this.definingDocumentBySymbol.get(symbol);
  }

  getImplementations(symbol: string): readonly string[] {
    return [
      ...(this.implementationsByTarget.get(symbol) ?? [])
    ];
  }
}

export function parseScipIndex(
  bytes: Uint8Array
): ScipIndex {
  return new ScipIndex(fromBinary(IndexSchema, bytes));
}

export async function loadScipIndex(
  path: string
): Promise<ScipIndex> {
  return parseScipIndex(await readFile(path));
}

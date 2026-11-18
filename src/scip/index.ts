import { readFile } from "node:fs/promises";
import { fromBinary } from "@bufbuild/protobuf";
import {
  IndexSchema,
  type Document,
  type Index,
  type Occurrence,
  type SymbolInformation
} from "@scip-code/scip";

function isLocalSymbol(symbol: string): boolean {
  return symbol.startsWith("local ");
}

export class ScipIndex {
  private readonly documentsByPath = new Map<string, Document>();
  private readonly symbolInformationById = new Map<
    string,
    SymbolInformation
  >();
  private readonly localSymbolInformationByDocument = new Map<
    string,
    Map<string, SymbolInformation>
  >();
  private readonly definingDocumentBySymbol = new Map<
    string,
    Document
  >();
  private readonly implementationsByTarget = new Map<
    string,
    Set<string>
  >();
  private readonly implementationTargetsBySymbol = new Map<
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

    if (isLocalSymbol(information.symbol)) {
      if (!definingDocument) {
        throw new Error(
          `local SCIP symbol "${information.symbol}" has no defining document`
        );
      }

      const bySymbol =
        this.localSymbolInformationByDocument.get(
          definingDocument.relativePath
        ) ?? new Map<string, SymbolInformation>();

      if (bySymbol.has(information.symbol)) {
        throw new Error(
          `duplicate local SCIP SymbolInformation "${information.symbol}" in document "${definingDocument.relativePath}"`
        );
      }

      bySymbol.set(information.symbol, information);
      this.localSymbolInformationByDocument.set(
        definingDocument.relativePath,
        bySymbol
      );

      // Local SCIP symbols are only meaningful inside their document.
      // Do not place them into global symbol or relationship maps.
      return;
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
      if (
        !relationship.isImplementation ||
        isLocalSymbol(relationship.symbol)
      ) {
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

      const targets =
        this.implementationTargetsBySymbol.get(
          information.symbol
        ) ?? new Set<string>();
      targets.add(relationship.symbol);
      this.implementationTargetsBySymbol.set(
        information.symbol,
        targets
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
    symbol: string,
    relativePath?: string
  ): SymbolInformation | undefined {
    if (isLocalSymbol(symbol)) {
      return relativePath
        ? this.localSymbolInformationByDocument
            .get(relativePath)
            ?.get(symbol)
        : undefined;
    }

    return this.symbolInformationById.get(symbol);
  }

  getDefiningDocument(
    symbol: string,
    relativePath?: string
  ): Document | undefined {
    if (isLocalSymbol(symbol)) {
      if (!relativePath) return undefined;

      return this.localSymbolInformationByDocument
        .get(relativePath)
        ?.has(symbol)
        ? this.documentsByPath.get(relativePath)
        : undefined;
    }

    return this.definingDocumentBySymbol.get(symbol);
  }

  getImplementations(symbol: string): readonly string[] {
    if (isLocalSymbol(symbol)) return [];

    return [
      ...(this.implementationsByTarget.get(symbol) ?? [])
    ];
  }

  getImplementationTargets(
    symbol: string
  ): readonly string[] {
    if (isLocalSymbol(symbol)) return [];

    return [
      ...(this.implementationTargetsBySymbol.get(
        symbol
      ) ?? [])
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

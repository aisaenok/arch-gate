import {
  SymbolRole,
  type Occurrence
} from "@scip-code/scip";
import type {
  JavaInterfaceEndpointCandidate
} from "../analyzers/java.js";
import type { ScipIndex } from "./index.js";

export interface JavaScipImplementationTarget {
  interfaceSymbol: string;
  implementationSymbol: string;
  implementationSourceFile: string;
  implementationDefinitionLine: number;
  implementationMethodName: string;
}

export interface JavaScipEndpointResolution {
  interfaceSymbols: string[];
  implementations: JavaScipImplementationTarget[];
  incompleteImplementationSymbols: string[];
}

function occurrenceStartLine(
  occurrence: Occurrence
): number | undefined {
  if (occurrence.typedRange.case === "singleLineRange") {
    return occurrence.typedRange.value.line;
  }

  if (occurrence.typedRange.case === "multiLineRange") {
    return occurrence.typedRange.value.startLine;
  }

  return occurrence.range[0];
}

function isDefinition(
  occurrence: Occurrence
): boolean {
  return (
    (occurrence.symbolRoles & SymbolRole.Definition) !== 0
  );
}

export function javaDefinitionSymbolsAt(
  index: ScipIndex,
  relativePath: string,
  line: number,
  displayName: string
): string[] {
  return index
    .getOccurrences(relativePath)
    .filter(
      (occurrence) =>
        isDefinition(occurrence) &&
        occurrenceStartLine(occurrence) === line - 1
    )
    .filter((occurrence) => {
      const information = index.getSymbolInformation(
        occurrence.symbol,
        relativePath
      );
      return information?.displayName === displayName;
    })
    .map((occurrence) => occurrence.symbol);
}

export function javaDefinitionLine(
  index: ScipIndex,
  symbol: string
): number | undefined {
  const document = index.getDefiningDocument(symbol);
  if (!document) return undefined;

  const occurrence = document.occurrences.find(
    (item) =>
      item.symbol === symbol &&
      isDefinition(item)
  );

  const line = occurrence
    ? occurrenceStartLine(occurrence)
    : undefined;

  return line === undefined ? undefined : line + 1;
}

export function resolveJavaEndpointImplementationsWithScip(
  index: ScipIndex,
  endpoint: JavaInterfaceEndpointCandidate
): JavaScipEndpointResolution {
  const interfaceSymbols = javaDefinitionSymbolsAt(
    index,
    endpoint.interfaceSourceFile,
    endpoint.interfaceDefinitionLine,
    endpoint.interfaceMethodName
  );

  const implementations: JavaScipImplementationTarget[] = [];
  const incompleteImplementationSymbols: string[] = [];
  const seen = new Set<string>();

  for (const interfaceSymbol of interfaceSymbols) {
    for (
      const implementationSymbol of
      index.getImplementations(interfaceSymbol)
    ) {
      if (seen.has(implementationSymbol)) continue;
      seen.add(implementationSymbol);

      const implementationDocument =
        index.getDefiningDocument(implementationSymbol);
      const implementationDefinitionLine =
        javaDefinitionLine(index, implementationSymbol);
      const implementationInformation =
        index.getSymbolInformation(implementationSymbol);

      if (
        !implementationDocument ||
        implementationDefinitionLine === undefined ||
        !implementationInformation?.displayName
      ) {
        incompleteImplementationSymbols.push(
          implementationSymbol
        );
        continue;
      }

      implementations.push({
        interfaceSymbol,
        implementationSymbol,
        implementationSourceFile:
          implementationDocument.relativePath,
        implementationDefinitionLine,
        implementationMethodName:
          implementationInformation.displayName
      });
    }
  }

  return {
    interfaceSymbols,
    implementations,
    incompleteImplementationSymbols
  };
}

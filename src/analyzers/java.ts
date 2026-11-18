import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/java";
import { operationKey } from "../core/routes.js";
import type { ScipIndex } from "../scip/index.js";
import type { ScipWorkspace } from "../scip/workspace.js";
import {
  javaDefinitionLine,
  javaDefinitionSymbolsAt,
  resolveJavaEndpointImplementationsWithScip
} from "../scip/java-resolution.js";
import type {
  AnalysisResult,
  Fact,
  FactEvidence,
  ResolvedJavaRepository
} from "../core/model.js";

const HTTP_ANNOTATIONS = new Map([
  ["GET", "GET"],
  ["POST", "POST"],
  ["PUT", "PUT"],
  ["PATCH", "PATCH"],
  ["DELETE", "DELETE"],
  ["HEAD", "HEAD"],
  ["OPTIONS", "OPTIONS"]
]);

interface AnnotationInfo {
  name: string;
  value?: string;
  attributes: Map<string, string>;
}

interface EndpointDraft {
  className: string;
  methodName: string;
  offset: number;
  definitionOffset: number;
  operationId: string;
  method: string;
  path: string;
}

interface ParsedFile {
  file: string;
  source: string;
  root: SyntaxNode;
}

export interface JavaInterfaceEndpointCandidate {
  interfaceSourceFile: string;
  interfaceDefinitionLine: number;
  interfaceMethodName: string;
}

export interface JavaAnalysisOptions {
  scipIndex?: ScipIndex;
  scipWorkspace?: ScipWorkspace;
}

interface ClassInfo {
  name: string;
  file: ParsedFile;
  methodNodes: SyntaxNode[];
  directEndpoints: EndpointDraft[];
}

interface InterfaceEndpointEntry {
  endpoint: EndpointDraft;
  candidate: JavaInterfaceEndpointCandidate;
}

function relativeToRoot(file: string, root: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

async function walkJava(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    if (
      entry.name === ".git" ||
      entry.name === "target" ||
      entry.name === "build" ||
      entry.name === "node_modules"
    ) {
      continue;
    }

    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJava(absolute)));
    } else if (entry.isFile() && entry.name.endsWith(".java")) {
      files.push(absolute);
    }
  }

  return files;
}

function directChildren(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (
    let child = node.firstChild;
    child;
    child = child.nextSibling
  ) {
    result.push(child);
  }
  return result;
}

function directChild(
  node: SyntaxNode,
  name: string
): SyntaxNode | undefined {
  return directChildren(node).find((child) => child.name === name);
}

function firstDescendant(
  node: SyntaxNode,
  name: string
): SyntaxNode | undefined {
  for (const child of directChildren(node)) {
    if (child.name === name) return child;
    const nested = firstDescendant(child, name);
    if (nested) return nested;
  }
  return undefined;
}

function annotationNodes(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];

  const visit = (current: SyntaxNode): void => {
    for (const child of directChildren(current)) {
      if (
        child.name === "Annotation" ||
        child.name === "MarkerAnnotation"
      ) {
        result.push(child);
        continue;
      }
      visit(child);
    }
  };

  visit(node);
  return result;
}

function sourceText(node: SyntaxNode, source: string): string {
  return source.slice(node.from, node.to);
}

function decodeJavaString(raw: string): string {
  const body = raw.slice(1, -1);
  return body
    .replace(/\\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function stringLiterals(text: string): string[] {
  const result: string[] = [];
  const pattern = /"(?:\\.|[^"\\])*"/g;
  for (const match of text.matchAll(pattern)) {
    result.push(decodeJavaString(match[0]));
  }
  return result;
}

function parseAnnotation(text: string): AnnotationInfo | undefined {
  const nameMatch = text.match(
    /^@\s*(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)/
  );
  if (!nameMatch) return undefined;

  const attributes = new Map<string, string>();
  const operationIdMatch = text.match(
    /\boperationId\s*=\s*("(?:\\.|[^"\\])*")/
  );
  if (operationIdMatch) {
    attributes.set(
      "operationId",
      decodeJavaString(operationIdMatch[1])
    );
  }

  return {
    name: nameMatch[1],
    value: stringLiterals(text)[0],
    attributes
  };
}

function annotations(
  node: SyntaxNode | undefined,
  source: string
): AnnotationInfo[] {
  if (!node) return [];
  return annotationNodes(node)
    .map((annotation) =>
      parseAnnotation(sourceText(annotation, source))
    )
    .filter(
      (annotation): annotation is AnnotationInfo =>
        annotation !== undefined
    );
}

function joinPaths(base: string, child: string): string {
  const parts = [base, child]
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^\/+|\/+$/g, ""));

  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function definitionName(
  node: SyntaxNode,
  source: string
): string {
  const definition = firstDescendant(node, "Definition");
  return definition ? sourceText(definition, source) : "";
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (starts[mid] <= offset) low = mid + 1;
    else high = mid;
  }

  return Math.max(1, low);
}

function hasParseError(root: SyntaxNode): boolean {
  const cursor = root.cursor();

  do {
    if (cursor.type.isError) return true;
  } while (cursor.next());

  return false;
}

function methodDefinitionNode(
  methodNode: SyntaxNode
): SyntaxNode | undefined {
  const directDefinition = directChild(
    methodNode,
    "Definition"
  );
  if (directDefinition) return directDefinition;

  const header = directChild(methodNode, "methodHeader");
  const declarator = header
    ? firstDescendant(header, "methodDeclarator")
    : undefined;

  return declarator
    ? firstDescendant(declarator, "Definition")
    : undefined;
}

function methodName(
  methodNode: SyntaxNode,
  source: string
): string {
  const definition = methodDefinitionNode(methodNode);
  return definition ? sourceText(definition, source) : "";
}

function endpointFromMethod(
  methodNode: SyntaxNode,
  className: string,
  classPath: string,
  source: string
): EndpointDraft | undefined {
  const modifiers = directChild(methodNode, "Modifiers");
  const methodAnnotations = annotations(modifiers, source);

  const httpAnnotation = methodAnnotations.find((annotation) =>
    HTTP_ANNOTATIONS.has(annotation.name)
  );
  if (!httpAnnotation) return undefined;

  const method = HTTP_ANNOTATIONS.get(httpAnnotation.name)!;
  const methodPath =
    methodAnnotations.find((annotation) => annotation.name === "Path")
      ?.value ?? "";

  const operationId =
    methodAnnotations
      .find((annotation) => annotation.name === "Operation")
      ?.attributes.get("operationId") ?? "";

  const definition = methodDefinitionNode(methodNode);

  return {
    className,
    methodName: methodName(methodNode, source),
    offset: methodNode.from,
    definitionOffset: definition?.from ?? methodNode.from,
    operationId,
    method,
    path: joinPaths(classPath, methodPath)
  };
}

function collectMethodNodeList(
  typeNode: SyntaxNode
): SyntaxNode[] {
  const body =
    directChild(typeNode, "ClassBody") ??
    directChild(typeNode, "InterfaceBody");

  if (!body) return [];

  return directChildren(body).filter(
    (child) => child.name === "MethodDeclaration"
  );
}

function directEndpoints(
  typeNode: SyntaxNode,
  source: string
): EndpointDraft[] {
  const modifiers = directChild(typeNode, "Modifiers");
  const classAnnotations = annotations(modifiers, source);
  const classPath =
    classAnnotations.find((annotation) => annotation.name === "Path")
      ?.value ?? "";
  const className = definitionName(typeNode, source);

  const body =
    directChild(typeNode, "ClassBody") ??
    directChild(typeNode, "InterfaceBody");
  if (!body) return [];

  const endpoints: EndpointDraft[] = [];
  for (const child of directChildren(body)) {
    if (child.name !== "MethodDeclaration") continue;
    const endpoint = endpointFromMethod(
      child,
      className,
      classPath,
      source
    );
    if (endpoint) endpoints.push(endpoint);
  }

  return endpoints;
}

function topLevelTypes(
  file: ParsedFile
): Array<{ node: SyntaxNode; kind: "class" | "interface" }> {
  const result: Array<{
    node: SyntaxNode;
    kind: "class" | "interface";
  }> = [];

  for (const child of directChildren(file.root)) {
    if (child.name === "ClassDeclaration") {
      result.push({ node: child, kind: "class" });
    } else if (child.name === "InterfaceDeclaration") {
      result.push({ node: child, kind: "interface" });
    }
  }

  return result;
}

async function externalInterfaceEndpoint(
  interfaceSymbol: string,
  workspace: ScipWorkspace
): Promise<
  | { endpoint: EndpointDraft; repositoryId: string }
  | { error: string }
> {
  const definitionResolution =
    workspace.resolveDefinition(interfaceSymbol);

  if (definitionResolution.status === "missing") {
    return {
      error:
        `SCIP interface symbol "${interfaceSymbol}" has no workspace definition`
    };
  }

  if (definitionResolution.status === "ambiguous") {
    return {
      error:
        `SCIP interface symbol "${interfaceSymbol}" has definitions in multiple workspace repositories: ${definitionResolution.definitions
          .map((definition) => definition.repositoryId)
          .join(", ")}`
    };
  }

  const definition = definitionResolution.definition;
  const definitionLine = javaDefinitionLine(
    definition.index,
    interfaceSymbol
  );
  const information =
    definition.index.getSymbolInformation(
      interfaceSymbol
    );

  if (
    definitionLine === undefined ||
    !information?.displayName
  ) {
    return {
      error:
        `SCIP interface symbol "${interfaceSymbol}" has incomplete definition metadata`
    };
  }

  let source: string;
  try {
    source = await readFile(
      definition.absolutePath,
      "utf8"
    );
  } catch {
    return {
      error:
        `SCIP interface definition "${definition.absolutePath}" is unavailable`
    };
  }

  const root = parser.parse(source).topNode;
  if (hasParseError(root)) {
    return {
      error:
        `SCIP interface definition "${definition.absolutePath}" could not be parsed`
    };
  }

  const file: ParsedFile = {
    file: definition.absolutePath,
    source,
    root
  };
  const starts = lineStarts(source);
  const matches: EndpointDraft[] = [];

  for (const type of topLevelTypes(file)) {
    if (type.kind !== "interface") continue;

    for (const endpoint of directEndpoints(
      type.node,
      source
    )) {
      if (
        endpoint.methodName ===
          information.displayName &&
        lineAt(
          starts,
          endpoint.definitionOffset
        ) === definitionLine
      ) {
        matches.push(endpoint);
      }
    }
  }

  if (matches.length !== 1) {
    return {
      error:
        `${definition.document.relativePath}:${definitionLine}: expected one JAX-RS interface endpoint for SCIP symbol "${interfaceSymbol}", found ${matches.length}`
    };
  }

  return {
    endpoint: matches[0]!,
    repositoryId: definition.repositoryId
  };
}

function endpointFacts(
  repository: ResolvedJavaRepository,
  file: string,
  source: string,
  endpoints: EndpointDraft[]
): Fact[] {
  const sourceFile = relativeToRoot(file, repository.root);
  const starts = lineStarts(source);

  return endpoints.map((endpoint) => ({
    kind: "backend-endpoint",
    repositoryId: repository.id,
    source: `${sourceFile}:${lineAt(starts, endpoint.offset)}:1`,
    sourceFile,
    framework: "jax-rs",
    className: endpoint.className,
    methodName: endpoint.methodName,
    operationId: endpoint.operationId,
    method: endpoint.method,
    path: endpoint.path,
    operationKey: operationKey(endpoint.method, endpoint.path)
  }));
}

export async function analyzeJavaRepository(
  repository: ResolvedJavaRepository,
  options: JavaAnalysisOptions = {}
): Promise<AnalysisResult> {
  if (!repository.frameworks.includes("jax-rs")) {
    return {
      facts: [],
      evidence: [
        {
          repositoryId: repository.id,
          producer: "java",
          factKind: "backend-endpoint",
          status: "unavailable",
          message:
            "No supported Java endpoint framework is declared. Configure frameworks: [jax-rs] to enable JAX-RS endpoint facts."
        }
      ]
    };
  }

  const sourceDirFailures: string[] = [];
  const discoveredFiles: string[] = [];

  for (const directory of repository.sourceDirs) {
    try {
      const info = await stat(directory);
      if (!info.isDirectory()) {
        sourceDirFailures.push(
          `${relativeToRoot(
            directory,
            repository.root
          )}: configured Java sourceDir is not a directory`
        );
        continue;
      }

      discoveredFiles.push(...(await walkJava(directory)));
    } catch {
      sourceDirFailures.push(
        `${relativeToRoot(
          directory,
          repository.root
        )}: configured Java sourceDir is unavailable`
      );
    }
  }

  const files = [...new Set(discoveredFiles)];

  const parsedFiles: ParsedFile[] = [];
  const parseFailures: string[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const tree = parser.parse(source);

    if (hasParseError(tree.topNode)) {
      parseFailures.push(
        `${relativeToRoot(
          file,
          repository.root
        )}: Java syntax tree contains error nodes`
      );
      continue;
    }

    parsedFiles.push({
      file,
      source,
      root: tree.topNode
    });
  }

  const interfaceEndpointEntries: InterfaceEndpointEntry[] = [];
  const classes: ClassInfo[] = [];

  for (const file of parsedFiles) {
    for (const type of topLevelTypes(file)) {
      const name = definitionName(type.node, file.source);

      if (type.kind === "interface") {
        const endpoints = directEndpoints(
          type.node,
          file.source
        );
        const starts = lineStarts(file.source);
        const sourceFile = relativeToRoot(
          file.file,
          repository.root
        );

        for (const endpoint of endpoints) {
          interfaceEndpointEntries.push({
            endpoint,
            candidate: {
              interfaceSourceFile: sourceFile,
              interfaceDefinitionLine: lineAt(
                starts,
                endpoint.definitionOffset
              ),
              interfaceMethodName: endpoint.methodName
            }
          });
        }
        continue;
      }

      classes.push({
        name,
        file,
        methodNodes: collectMethodNodeList(type.node),
        directEndpoints: directEndpoints(
          type.node,
          file.source
        )
      });
    }
  }

  const facts: Fact[] = [];
  const scipInheritedByClass = new Map<
    ClassInfo,
    EndpointDraft[]
  >();
  const scipResolutionFailures: string[] = [];

  if (options.scipIndex) {
    for (const entry of interfaceEndpointEntries) {
      const resolution =
        resolveJavaEndpointImplementationsWithScip(
          options.scipIndex,
          entry.candidate
        );

      if (resolution.interfaceSymbols.length === 0) {
        scipResolutionFailures.push(
          `${entry.candidate.interfaceSourceFile}:${entry.candidate.interfaceDefinitionLine}: SCIP interface method definition is missing`
        );
        continue;
      }

      for (
        const symbol of
        resolution.incompleteImplementationSymbols
      ) {
        scipResolutionFailures.push(
          `${entry.candidate.interfaceSourceFile}:${entry.candidate.interfaceDefinitionLine}: SCIP implementation "${symbol}" has incomplete local definition metadata`
        );
      }

      for (const target of resolution.implementations) {
        const matches: Array<{
          info: ClassInfo;
          method: SyntaxNode;
        }> = [];

        for (const info of classes) {
          if (
            relativeToRoot(
              info.file.file,
              repository.root
            ) !== target.implementationSourceFile
          ) {
            continue;
          }

          const starts = lineStarts(info.file.source);
          for (const method of info.methodNodes) {
            const definition = methodDefinitionNode(method);
            const definitionLine = lineAt(
              starts,
              definition?.from ?? method.from
            );

            if (
              definitionLine ===
                target.implementationDefinitionLine &&
              methodName(method, info.file.source) ===
                target.implementationMethodName
            ) {
              matches.push({ info, method });
            }
          }
        }

        if (matches.length !== 1) {
          scipResolutionFailures.push(
            `${target.implementationSourceFile}:${target.implementationDefinitionLine}: expected one parsed Java method for SCIP implementation, found ${matches.length}`
          );
          continue;
        }

        const match = matches[0]!;
        const inherited =
          scipInheritedByClass.get(match.info) ?? [];

        inherited.push({
          ...entry.endpoint,
          className: match.info.name,
          offset: match.method.from,
          definitionOffset:
            methodDefinitionNode(match.method)?.from ??
            match.method.from
        });
        scipInheritedByClass.set(match.info, inherited);
      }
    }
  }


  if (options.scipIndex) {
    for (const info of classes) {
      const sourceFile = relativeToRoot(
        info.file.file,
        repository.root
      );
      const starts = lineStarts(info.file.source);

      for (const method of info.methodNodes) {
        const definition = methodDefinitionNode(method);
        const definitionLine = lineAt(
          starts,
          definition?.from ?? method.from
        );
        const name = methodName(
          method,
          info.file.source
        );
        const implementationSymbols =
          javaDefinitionSymbolsAt(
            options.scipIndex,
            sourceFile,
            definitionLine,
            name
          );

        for (const implementationSymbol of
          implementationSymbols) {
          for (const interfaceSymbol of
            options.scipIndex.getImplementationTargets(
              implementationSymbol
            )) {
            const localInterface =
              options.scipIndex.getDefiningDocument(
                interfaceSymbol
              );
            if (localInterface) {
              continue;
            }

            if (!options.scipWorkspace) {
              scipResolutionFailures.push(
                `${sourceFile}:${definitionLine}: SCIP workspace is required to resolve external interface "${interfaceSymbol}"`
              );
              continue;
            }

            const external =
              await externalInterfaceEndpoint(
                interfaceSymbol,
                options.scipWorkspace
              );

            if ("error" in external) {
              scipResolutionFailures.push(
                `${sourceFile}:${definitionLine}: ${external.error}`
              );
              continue;
            }

            const inherited =
              scipInheritedByClass.get(info) ?? [];

            inherited.push({
              ...external.endpoint,
              className: info.name,
              offset: method.from,
              definitionOffset:
                definition?.from ?? method.from
            });
            scipInheritedByClass.set(
              info,
              inherited
            );
          }
        }
      }
    }
  }

  for (const info of classes) {
    const inheritedEndpoints =
      scipInheritedByClass.get(info) ?? [];

    const seen = new Set<string>();
    const endpoints = [
      ...info.directEndpoints,
      ...inheritedEndpoints
    ].filter((endpoint) => {
      const key =
        `${endpoint.methodName}|${endpoint.method}|${endpoint.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    facts.push(
      ...endpointFacts(
        repository,
        info.file.file,
        info.file.source,
        endpoints
      )
    );
  }

  if (!options.scipIndex && interfaceEndpointEntries.length > 0) {
    scipResolutionFailures.push(
      "SCIP index is required to resolve JAX-RS interface endpoint implementations"
    );
  }

  const evidenceFailures = [
    ...sourceDirFailures,
    ...parseFailures,
    ...scipResolutionFailures
  ];

  const evidence: FactEvidence = evidenceFailures.length
    ? {
        repositoryId: repository.id,
        producer: "java",
        factKind: "backend-endpoint",
        status: "partial",
        message:
          `Java endpoint analysis incomplete: ${evidenceFailures
            .slice(0, 3)
            .join("; ")}`
      }
    : {
        repositoryId: repository.id,
        producer: "java",
        factKind: "backend-endpoint",
        status: "complete"
      };

  return {
    facts,
    evidence: [evidence]
  };
}

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/java";
import { operationKey } from "../core/routes.js";
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
  arity: number;
  offset: number;
  operationId: string;
  method: string;
  path: string;
}

interface ParsedFile {
  file: string;
  source: string;
  root: SyntaxNode;
  packageName: string;
  imports: Map<string, string>;
}

interface InterfaceInfo {
  name: string;
  fqn: string;
  file: ParsedFile;
  endpoints: EndpointDraft[];
}

export interface JavaImplementationResolution {
  repositoryId: string;
  implementationSourceFile: string;
  implementationLine: number;
  implementationClassName: string;
  implementationMethodName: string;
  implementationArity: number;
  interfaceSourceFile: string;
  interfaceName: string;
  interfaceFqn: string;
  interfaceMethodName: string;
  interfaceArity: number;
}

export interface JavaAnalysisOptions {
  onImplementationResolution?: (
    resolution: JavaImplementationResolution
  ) => void;
}

interface ClassInfo {
  name: string;
  fqn: string;
  file: ParsedFile;
  node: SyntaxNode;
  methods: Map<string, SyntaxNode>;
  implementedInterfaces: string[];
  directEndpoints: EndpointDraft[];
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

function methodName(
  methodNode: SyntaxNode,
  source: string
): string {
  const directDefinition = directChild(
    methodNode,
    "Definition"
  );
  if (directDefinition) {
    return sourceText(directDefinition, source);
  }

  const header = directChild(methodNode, "methodHeader");
  const declarator = header
    ? firstDescendant(header, "methodDeclarator")
    : undefined;

  return declarator
    ? definitionName(declarator, source)
    : "";
}

function methodArity(
  methodNode: SyntaxNode
): number {
  const parameters = directChild(
    methodNode,
    "FormalParameters"
  );
  if (!parameters) return 0;

  return directChildren(parameters).filter(
    (child) =>
      child.name === "FormalParameter" ||
      child.name === "SpreadParameter"
  ).length;
}

function methodSignature(
  name: string,
  arity: number
): string {
  return `${name}/${arity}`;
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

  return {
    className,
    methodName: methodName(methodNode, source),
    arity: methodArity(methodNode),
    offset: methodNode.from,
    operationId,
    method,
    path: joinPaths(classPath, methodPath)
  };
}

function packageName(source: string): string {
  return (
    source.match(
      /^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m
    )?.[1] ?? ""
  );
}

function imports(source: string): Map<string, string> {
  const result = new Map<string, string>();
  const pattern =
    /^\s*import\s+(?!static\b)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*;/gm;

  for (const match of source.matchAll(pattern)) {
    const fqn = match[1];
    const simple = fqn.slice(fqn.lastIndexOf(".") + 1);
    result.set(simple, fqn);
  }

  return result;
}

function typeFqn(packageValue: string, name: string): string {
  return packageValue ? `${packageValue}.${name}` : name;
}

function implementedTypeNames(
  node: SyntaxNode,
  source: string
): string[] {
  const superInterfaces = directChild(
    node,
    "SuperInterfaces"
  );
  if (!superInterfaces) return [];

  const interfaceList =
    directChild(
      superInterfaces,
      "InterfaceTypeList"
    ) ??
    firstDescendant(
      superInterfaces,
      "InterfaceTypeList"
    );
  if (!interfaceList) return [];

  return directChildren(interfaceList)
    .filter((child) => child.name === "TypeName")
    .map((child) => sourceText(child, source))
    .filter(Boolean);
}

function resolveTypeName(
  raw: string,
  file: ParsedFile,
  interfacesBySimpleName: Map<string, InterfaceInfo[]>
): string | undefined {
  const clean = raw.replace(/\s+/g, "");

  if (clean.includes(".")) return clean;

  const imported = file.imports.get(clean);
  if (imported) return imported;

  const samePackage = typeFqn(file.packageName, clean);
  const samePackageInterface =
    interfacesBySimpleName
      .get(clean)
      ?.find((item) => item.fqn === samePackage);
  if (samePackageInterface) return samePackage;

  const candidates = interfacesBySimpleName.get(clean) ?? [];
  return candidates.length === 1 ? candidates[0].fqn : undefined;
}

function collectMethodNodes(
  typeNode: SyntaxNode,
  source: string
): Map<string, SyntaxNode> {
  const body =
    directChild(typeNode, "ClassBody") ??
    directChild(typeNode, "InterfaceBody");
  const result = new Map<string, SyntaxNode>();
  if (!body) return result;

  for (const child of directChildren(body)) {
    if (child.name !== "MethodDeclaration") continue;
    const name = methodName(child, source);
    if (name) {
      result.set(
        methodSignature(
          name,
          methodArity(child)
        ),
        child
      );
    }
  }

  return result;
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
      root: tree.topNode,
      packageName: packageName(source),
      imports: imports(source)
    });
  }

  const interfaces = new Map<string, InterfaceInfo>();
  const interfacesBySimpleName = new Map<
    string,
    InterfaceInfo[]
  >();
  const classes: ClassInfo[] = [];

  for (const file of parsedFiles) {
    for (const type of topLevelTypes(file)) {
      const name = definitionName(type.node, file.source);
      const fqn = typeFqn(file.packageName, name);

      if (type.kind === "interface") {
        const info: InterfaceInfo = {
          name,
          fqn,
          file,
          endpoints: directEndpoints(type.node, file.source)
        };
        interfaces.set(fqn, info);
        const byName = interfacesBySimpleName.get(name) ?? [];
        byName.push(info);
        interfacesBySimpleName.set(name, byName);
        continue;
      }

      classes.push({
        name,
        fqn,
        file,
        node: type.node,
        methods: collectMethodNodes(type.node, file.source),
        implementedInterfaces: implementedTypeNames(
          type.node,
          file.source
        ),
        directEndpoints: directEndpoints(type.node, file.source)
      });
    }
  }

  const facts: Fact[] = [];

  for (const info of classes) {
    const inheritedEndpoints: EndpointDraft[] = [];

    for (const rawInterface of info.implementedInterfaces) {
      const resolved = resolveTypeName(
        rawInterface,
        info.file,
        interfacesBySimpleName
      );
      if (!resolved) continue;

      const interfaceInfo = interfaces.get(resolved);
      if (!interfaceInfo) continue;

      for (const endpoint of interfaceInfo.endpoints) {
        const implementationMethod = info.methods.get(
          methodSignature(
            endpoint.methodName,
            endpoint.arity
          )
        );
        if (!implementationMethod) continue;

        options.onImplementationResolution?.({
          repositoryId: repository.id,
          implementationSourceFile: relativeToRoot(
            info.file.file,
            repository.root
          ),
          implementationLine: lineAt(
            lineStarts(info.file.source),
            implementationMethod.from
          ),
          implementationClassName: info.name,
          implementationMethodName: endpoint.methodName,
          implementationArity: endpoint.arity,
          interfaceSourceFile: relativeToRoot(
            interfaceInfo.file.file,
            repository.root
          ),
          interfaceName: interfaceInfo.name,
          interfaceFqn: interfaceInfo.fqn,
          interfaceMethodName: endpoint.methodName,
          interfaceArity: endpoint.arity
        });

        inheritedEndpoints.push({
          ...endpoint,
          className: info.name,
          offset: implementationMethod.from
        });
      }
    }

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

  const evidenceFailures = [
    ...sourceDirFailures,
    ...parseFailures
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

import { readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { operationKey } from "../core/routes.js";
import type {
  AnalysisResult,
  Fact,
  FactEvidence,
  ResolvedTypeScriptRepository
} from "../core/model.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options"
]);

interface TransportBinding {
  module: string;
  importedName?: string;
}

interface HttpCallRecord {
  fact: Fact;
  sourceFile: string;
  sourceAbsolute: string;
}

function isInside(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isInsideAny(file: string, directories: string[]): boolean {
  return directories.some((directory) => isInside(file, directory));
}

function relativeToRoot(file: string, root: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }

    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolute)));
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name))
    ) {
      files.push(absolute);
    }
  }

  return files;
}

function compilerOptions(repository: ResolvedTypeScriptRepository): ts.CompilerOptions {
  const configFile = ts.findConfigFile(
    repository.root,
    ts.sys.fileExists,
    "tsconfig.json"
  );

  if (configFile) {
    const read = ts.readConfigFile(configFile, ts.sys.readFile);
    if (!read.error) {
      const parsed = ts.parseJsonConfigFileContent(
        read.config,
        ts.sys,
        path.dirname(configFile)
      );
      return parsed.options;
    }
  }

  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true
  };
}

function location(sourceFile: ts.SourceFile, node: ts.Node): string {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile)
  );
  return `${line + 1}:${character + 1}`;
}

function transportBindings(
  sourceFile: ts.SourceFile,
  modules: string[]
): Map<string, TransportBinding> {
  const bindings = new Map<string, TransportBinding>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const moduleName = statement.moduleSpecifier.text;
    if (!modules.includes(moduleName)) continue;

    const clause = statement.importClause;
    if (!clause) continue;

    if (clause.name) {
      bindings.set(clause.name.text, { module: moduleName, importedName: "default" });
    }

    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      bindings.set(named.name.text, { module: moduleName, importedName: "*" });
    }

    if (named && ts.isNamedImports(named)) {
      for (const item of named.elements) {
        bindings.set(item.name.text, {
          module: moduleName,
          importedName: item.propertyName?.text ?? item.name.text
        });
      }
    }
  }

  return bindings;
}

function rootIdentifier(expression: ts.Expression): ts.Identifier | undefined {
  if (ts.isIdentifier(expression)) return expression;
  if (ts.isPropertyAccessExpression(expression)) {
    return rootIdentifier(expression.expression);
  }
  if (ts.isElementAccessExpression(expression)) {
    return rootIdentifier(expression.expression);
  }
  return undefined;
}

function isRepositoryLocalIdentifier(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
  repository: ResolvedTypeScriptRepository
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  return (
    symbol?.declarations?.some((declaration) =>
      isInside(declaration.getSourceFile().fileName, repository.root)
    ) ?? false
  );
}

function staticPath(expression: ts.Expression | undefined): string | undefined {
  if (!expression) return undefined;

  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }

  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans) {
      value += "{}";
      value += span.literal.text;
    }
    return value;
  }

  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticPath(expression.left);
    const right = staticPath(expression.right);
    if (left !== undefined && right !== undefined) return left + right;
    if (left !== undefined) return left + "{}";
    if (right !== undefined) return "{}" + right;
  }

  return undefined;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName =
      ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text
        : undefined;
    if (propertyName === name) return property.initializer;
  }
  return undefined;
}

function stringValue(expression: ts.Expression | undefined): string | undefined {
  if (
    expression &&
    (ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression))
  ) {
    return expression.text;
  }
  return undefined;
}

function fetchMethod(call: ts.CallExpression): string {
  const options = call.arguments[1];
  if (options && ts.isObjectLiteralExpression(options)) {
    return (stringValue(objectProperty(options, "method")) ?? "GET").toUpperCase();
  }
  return "GET";
}

function resolveModule(
  specifier: string,
  sourceFile: string,
  options: ts.CompilerOptions
): string | undefined {
  const resolved = ts.resolveModuleName(
    specifier,
    sourceFile,
    options,
    ts.sys
  ).resolvedModule?.resolvedFileName;

  if (resolved) return resolved;

  if (!specifier.startsWith(".")) return undefined;

  const base = path.resolve(path.dirname(sourceFile), specifier);
  const withoutJs = base.replace(/\.(mjs|cjs|js)$/, "");
  const candidates = [
    base,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    `${withoutJs}.mts`,
    `${withoutJs}.cts`,
    path.join(withoutJs, "index.ts"),
    path.join(withoutJs, "index.tsx")
  ];

  return candidates.find((candidate) => ts.sys.fileExists(candidate));
}

function declarationKind(
  node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration
): string {
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  return "class";
}

function aliasDefinesShape(node: ts.TypeAliasDeclaration): boolean {
  return !(
    ts.isTypeReferenceNode(node.type) ||
    ts.isTypeQueryNode(node.type) ||
    ts.isImportTypeNode(node.type)
  );
}

function symbolDeclarationFiles(
  type: ts.Type
): string[] {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  return (
    symbol?.declarations?.map((declaration) => declaration.getSourceFile().fileName) ??
    []
  );
}

function typeName(type: ts.Type, checker: ts.TypeChecker): string {
  return type.aliasSymbol?.getName() ??
    type.getSymbol()?.getName() ??
    checker.typeToString(type);
}

function typeNodeReferencesGenerated(
  node: ts.TypeNode,
  checker: ts.TypeChecker,
  generatedDirs: string[]
): boolean {
  if (ts.isTypeReferenceNode(node)) {
    const symbol = checker.getSymbolAtLocation(node.typeName);
    const target =
      symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0
        ? checker.getAliasedSymbol(symbol)
        : symbol;
    if (
      target?.declarations?.some((declaration) =>
        isInsideAny(declaration.getSourceFile().fileName, generatedDirs)
      )
    ) {
      return true;
    }
  }

  let found = false;
  node.forEachChild((child) => {
    if (!found && ts.isTypeNode(child)) {
      found = typeNodeReferencesGenerated(child, checker, generatedDirs);
    }
  });
  return found;
}

function argumentHasContractProvenance(
  argument: ts.Expression,
  checker: ts.TypeChecker,
  generatedDirs: string[]
): boolean {
  if (ts.isObjectLiteralExpression(argument)) {
    return true;
  }

  const actualType = checker.getTypeAtLocation(argument);
  if (
    symbolDeclarationFiles(actualType).some((file) =>
      isInsideAny(file, generatedDirs)
    )
  ) {
    return true;
  }

  if (ts.isIdentifier(argument)) {
    const symbol = checker.getSymbolAtLocation(argument);
    for (const declaration of symbol?.declarations ?? []) {
      if (
        ts.isVariableDeclaration(declaration) &&
        declaration.type &&
        typeNodeReferencesGenerated(declaration.type, checker, generatedDirs)
      ) {
        return true;
      }
    }
  }

  return false;
}

function sourceAllowedDirectHttp(
  file: string,
  repository: ResolvedTypeScriptRepository
): boolean {
  return (
    isInsideAny(file, repository.generatedRuntimeDirs) ||
    isInsideAny(file, repository.allowDirectHttpDirs)
  );
}

export async function analyzeTypeScriptRepository(
  repository: ResolvedTypeScriptRepository
): Promise<AnalysisResult> {
  const files = await walk(repository.sourceDir);
  const fileSet = new Set(files.map((file) => path.resolve(file)));
  const options = compilerOptions(repository);
  const program = ts.createProgram({
    rootNames: files,
    options: { ...options, noEmit: true }
  });
  const checker = program.getTypeChecker();

  const facts: Fact[] = [];
  const httpCalls: HttpCallRecord[] = [];
  const adjacency = new Map<string, Set<string>>();
  let unresolvedInternalImports = 0;

  for (const absoluteFile of files) {
    const sourceFile = program.getSourceFile(absoluteFile);
    if (!sourceFile) continue;

    const sourceRelative = relativeToRoot(absoluteFile, repository.root);
    const generated = isInsideAny(
      absoluteFile,
      repository.generatedRuntimeDirs
    );
    const directHttpAllowed = sourceAllowedDirectHttp(
      absoluteFile,
      repository
    );
    const bindings = transportBindings(
      sourceFile,
      repository.httpModules
    );

    adjacency.set(sourceRelative, new Set());

    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }

      const specifier = statement.moduleSpecifier.text;
      const targetAbsolute = resolveModule(specifier, absoluteFile, options);
      const internal =
        !!targetAbsolute && isInside(targetAbsolute, repository.root);
      const targetFile =
        targetAbsolute && internal
          ? relativeToRoot(targetAbsolute, repository.root)
          : undefined;

      if (specifier.startsWith(".") && !targetAbsolute) {
        unresolvedInternalImports += 1;
      }

      facts.push({
        kind: "module-dependency",
        repositoryId: repository.id,
        source: `${sourceRelative}:${location(sourceFile, statement)}`,
        sourceFile: sourceRelative,
        specifier,
        targetFile: targetFile ?? "",
        resolved: !!targetAbsolute,
        internal
      });

      if (
        targetAbsolute &&
        internal &&
        fileSet.has(path.resolve(targetAbsolute))
      ) {
        adjacency.get(sourceRelative)?.add(
          relativeToRoot(targetAbsolute, repository.root)
        );
      }
    }

    const visit = (node: ts.Node): void => {
      const source = `${sourceRelative}:${location(sourceFile, node)}`;

      if (
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isClassDeclaration(node)
      ) {
        const name = node.name?.text;
        if (name) {
          facts.push({
            kind: "type-declaration",
            repositoryId: repository.id,
            source,
            sourceFile: sourceRelative,
            name,
            declarationKind: declarationKind(node),
            definesShape: ts.isTypeAliasDeclaration(node)
              ? aliasDefinesShape(node)
              : true,
            sourceGenerated: generated
          });
        }
      }

      if (ts.isCallExpression(node)) {
        let transport: string | undefined;
        let method: string | undefined;
        let requestPath: string | undefined;

        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === "fetch" &&
          !isRepositoryLocalIdentifier(
            node.expression,
            checker,
            repository
          )
        ) {
          transport = "fetch";
          method = fetchMethod(node);
          requestPath = staticPath(node.arguments[0]);
        } else {
          const root = rootIdentifier(node.expression);
          const binding = root ? bindings.get(root.text) : undefined;

          if (binding) {
            transport = binding.module;

            if (ts.isPropertyAccessExpression(node.expression)) {
              const candidate = node.expression.name.text.toLowerCase();
              if (HTTP_METHODS.has(candidate)) {
                method = candidate.toUpperCase();
                requestPath = staticPath(node.arguments[0]);
              }
            } else if (
              ts.isIdentifier(node.expression) &&
              binding.importedName &&
              HTTP_METHODS.has(binding.importedName.toLowerCase())
            ) {
              method = binding.importedName.toUpperCase();
              requestPath = staticPath(node.arguments[0]);
            } else if (
              ts.isIdentifier(node.expression) &&
              node.arguments[0] &&
              ts.isObjectLiteralExpression(node.arguments[0])
            ) {
              const config = node.arguments[0];
              method = (
                stringValue(objectProperty(config, "method")) ?? "GET"
              ).toUpperCase();
              requestPath = staticPath(objectProperty(config, "url"));
            }
          }
        }

        if (transport) {
          const knownOperation = !!method && requestPath !== undefined;
          const fact: Fact = {
            kind: "http-call",
            repositoryId: repository.id,
            source,
            sourceFile: sourceRelative,
            transport,
            method: method ?? "",
            path: requestPath ?? "",
            operationKey: knownOperation
              ? operationKey(method!, requestPath!)
              : "",
            operationKeyKnown: knownOperation,
            sourceGenerated: generated,
            directHttpAllowed
          };
          facts.push(fact);
          httpCalls.push({
            fact,
            sourceFile: sourceRelative,
            sourceAbsolute: absoluteFile
          });
        }

        const signature = checker.getResolvedSignature(node);
        const declaration = signature?.declaration;
        if (signature && declaration) {
          const targetAbsolute = declaration.getSourceFile().fileName;
          if (
            isInsideAny(targetAbsolute, repository.generatedRuntimeDirs)
          ) {
            const parameters = signature.getParameters();
            for (
              let index = 0;
              index < node.arguments.length &&
              index < parameters.length;
              index += 1
            ) {
              const parameter = parameters[index]!;
              const expectedType = checker.getTypeOfSymbolAtLocation(
                parameter,
                declaration
              );
              const expectedGenerated = symbolDeclarationFiles(
                expectedType
              ).some((file) =>
                isInsideAny(file, repository.generatedRuntimeDirs)
              );

              if (!expectedGenerated) continue;

              const argument = node.arguments[index]!;
              const actualType = checker.getTypeAtLocation(argument);

              facts.push({
                kind: "api-boundary-type",
                repositoryId: repository.id,
                source,
                sourceFile: sourceRelative,
                targetFile: relativeToRoot(
                  targetAbsolute,
                  repository.root
                ),
                argumentIndex: index,
                expectedType: typeName(expectedType, checker),
                actualType: typeName(actualType, checker),
                contractTypeProvenance: argumentHasContractProvenance(
                  argument,
                  checker,
                  repository.generatedRuntimeDirs
                )
              });
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  const callsByFile = new Map<string, HttpCallRecord[]>();
  for (const call of httpCalls) {
    const current = callsByFile.get(call.sourceFile) ?? [];
    current.push(call);
    callsByFile.set(call.sourceFile, current);
  }

  for (const sourceAbsolute of files) {
    const sourceFile = relativeToRoot(sourceAbsolute, repository.root);
    const sourceDirectHttpAllowed = sourceAllowedDirectHttp(
      sourceAbsolute,
      repository
    );
    const sourceGenerated = isInsideAny(
      sourceAbsolute,
      repository.generatedRuntimeDirs
    );

    const queue: Array<{
      file: string;
      path: string[];
      generated: boolean;
    }> = [
      {
        file: sourceFile,
        path: [sourceFile],
        generated: sourceGenerated
      }
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      const stateKey = `${current.file}|${current.generated}`;
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);

      for (const call of callsByFile.get(current.file) ?? []) {
        facts.push({
          kind: "http-reach",
          repositoryId: repository.id,
          source: sourceFile,
          sourceFile,
          terminalFile: current.file,
          transport: String(call.fact.transport),
          operationKey: String(call.fact.operationKey),
          operationKeyKnown: Boolean(call.fact.operationKeyKnown),
          throughGeneratedRuntime: current.generated,
          sourceDirectHttpAllowed,
          path: current.path.join(" -> ")
        });
      }

      for (const target of adjacency.get(current.file) ?? []) {
        const targetAbsolute = path.resolve(repository.root, target);
        queue.push({
          file: target,
          path: [...current.path, target],
          generated:
            current.generated ||
            isInsideAny(
              targetAbsolute,
              repository.generatedRuntimeDirs
            )
        });
      }
    }
  }

  const resolutionStatus =
    unresolvedInternalImports === 0 ? "complete" : "partial";
  const resolutionMessage =
    unresolvedInternalImports === 0
      ? undefined
      : `${unresolvedInternalImports} relative import(s) could not be resolved; transitive facts may be incomplete.`;

  const evidence: FactEvidence[] = [
    {
      repositoryId: repository.id,
      producer: "typescript",
      factKind: "http-call",
      status: "complete"
    },
    {
      repositoryId: repository.id,
      producer: "typescript",
      factKind: "type-declaration",
      status: "complete"
    },
    {
      repositoryId: repository.id,
      producer: "typescript",
      factKind: "module-dependency",
      status: resolutionStatus,
      message: resolutionMessage
    },
    {
      repositoryId: repository.id,
      producer: "typescript",
      factKind: "http-reach",
      status: resolutionStatus,
      message: resolutionMessage
    },
    {
      repositoryId: repository.id,
      producer: "typescript",
      factKind: "api-boundary-type",
      status: resolutionStatus,
      message: resolutionMessage
    }
  ];

  return { facts, evidence };
}

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { Fact, ResolvedTypeScriptRepository } from "../core/model.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

function isInside(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isInsideAny(file: string, directories: string[]): boolean {
  return directories.some((directory) => isInside(file, directory));
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;

    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
  }

  return files;
}

function location(sourceFile: ts.SourceFile, node: ts.Node): string {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${line + 1}:${character + 1}`;
}

function relativeToRoot(file: string, root: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function declarationKind(
  node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration
): string {
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  return "class";
}

export async function analyzeTypeScriptRepository(
  repository: ResolvedTypeScriptRepository
): Promise<Fact[]> {
  const files = await walk(repository.sourceDir);
  const facts: Fact[] = [];

  for (const file of files) {
    const generated = isInsideAny(file, repository.generatedRuntimeDirs);
    const directHttpAllowed = generated || isInsideAny(file, repository.allowDirectHttpDirs);
    const manualContractTypeAllowed =
      generated || isInsideAny(file, repository.allowManualContractTypeDirs);

    const source = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const relativeFile = relativeToRoot(file, repository.root);

    const visit = (node: ts.Node): void => {
      const sourceLocation = `${relativeFile}:${location(sourceFile, node)}`;

      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const moduleName = node.moduleSpecifier.text;
        if (repository.httpModules.includes(moduleName)) {
          facts.push({
            kind: "http-usage",
            repositoryId: repository.id,
            source: sourceLocation,
            target: moduleName,
            transportKind: "module-import",
            directHttpAllowed
          });
        }
      }

      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
        facts.push({
          kind: "http-usage",
          repositoryId: repository.id,
          source: sourceLocation,
          target: "fetch",
          transportKind: "fetch",
          directHttpAllowed
        });
      }

      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "XMLHttpRequest") {
        facts.push({
          kind: "http-usage",
          repositoryId: repository.id,
          source: sourceLocation,
          target: "XMLHttpRequest",
          transportKind: "xml-http-request",
          directHttpAllowed
        });
      }

      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node)) {
        const name = node.name?.text;
        if (name) {
          facts.push({
            kind: "declared-type",
            repositoryId: repository.id,
            source: sourceLocation,
            name,
            declarationKind: declarationKind(node),
            manualContractTypeAllowed
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return facts;
}

import {
  mkdtemp,
  readdir,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  create,
  toBinary
} from "@bufbuild/protobuf";
import {
  IndexSchema
} from "@scip-code/scip";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts"
]);

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    withFileTypes: true
  });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = path.join(
      directory,
      entry.name
    );

    if (entry.isDirectory()) {
      files.push(...(await walk(absolute)));
      continue;
    }

    if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(
        path.extname(entry.name)
      )
    ) {
      files.push(absolute);
    }
  }

  return files;
}

function relativeToRoot(
  file: string,
  root: string
): string {
  return path
    .relative(root, file)
    .split(path.sep)
    .join("/");
}

function compilerOptions(
  root: string
): ts.CompilerOptions {
  const configFile = ts.findConfigFile(
    root,
    ts.sys.fileExists,
    "tsconfig.json"
  );

  if (configFile) {
    const read = ts.readConfigFile(
      configFile,
      ts.sys.readFile
    );

    if (!read.error) {
      return ts.parseJsonConfigFileContent(
        read.config,
        ts.sys,
        path.dirname(configFile)
      ).options;
    }
  }

  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution:
      ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true
  };
}

const AXIOS_DEFAULT_SYMBOL =
  "scip-typescript npm axios 1.7.9 `index.d.ts`/axios.";
const TYPESCRIPT_FETCH_SYMBOL =
  "scip-typescript npm typescript 5.9.3 lib/`lib.dom.d.ts`/fetch().";

function occurrenceRange(
  source: ts.SourceFile,
  node: ts.Node
): [number, number, number] | undefined {
  const start =
    source.getLineAndCharacterOfPosition(
      node.getStart(source)
    );
  const end =
    source.getLineAndCharacterOfPosition(
      node.getEnd()
    );

  if (start.line !== end.line) {
    return undefined;
  }

  return [
    start.line,
    start.character,
    end.character
  ];
}

function moduleSymbol(
  relativePath: string
): string {
  return (
    "scip-typescript npm test-fixture 1.0.0 " +
    `${relativePath.replace(
      /([^/]+)$/,
      "`$1`"
    )}/`
  );
}

export async function writeSyntheticTypeScriptScipIndex(
  root: string
): Promise<string> {
  const files = await walk(
    path.join(root, "src")
  );
  const options = compilerOptions(root);

  const symbolByFile = new Map(
    files.map((file) => {
      const relative = relativeToRoot(
        file,
        root
      );
      return [
        path.resolve(file),
        moduleSymbol(relative)
      ] as const;
    })
  );

  const documents = [];

  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      ts.sys.readFile(file) ?? "",
      ts.ScriptTarget.Latest,
      true
    );
    const relative = relativeToRoot(
      file,
      root
    );
    const occurrences: Array<{
      range: number[];
      symbol: string;
    }> = [];

    const addOccurrence = (
      node: ts.Node,
      symbol: string
    ): void => {
      const range = occurrenceRange(
        source,
        node
      );
      if (range) {
        occurrences.push({
          range,
          symbol
        });
      }
    };

    const visitTransportRoots = (
      node: ts.Node
    ): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(
          node.moduleSpecifier
        ) &&
        node.moduleSpecifier.text === "axios" &&
        node.importClause?.name
      ) {
        addOccurrence(
          node.importClause.name,
          AXIOS_DEFAULT_SYMBOL
        );
      }

      if (
        ts.isIdentifier(node) &&
        node.text === "fetch" &&
        !(
          ts.isPropertyAccessExpression(
            node.parent
          ) &&
          node.parent.name === node
        )
      ) {
        addOccurrence(
          node,
          TYPESCRIPT_FETCH_SYMBOL
        );
      }

      ts.forEachChild(
        node,
        visitTransportRoots
      );
    };

    visitTransportRoots(source);

    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(
          statement.moduleSpecifier
        )
      ) {
        continue;
      }

      const resolved = ts.resolveModuleName(
        statement.moduleSpecifier.text,
        file,
        options,
        ts.sys
      ).resolvedModule?.resolvedFileName;

      const targetSymbol = resolved
        ? symbolByFile.get(
            path.resolve(resolved)
          )
        : undefined;

      if (!targetSymbol) {
        continue;
      }

      const start =
        source.getLineAndCharacterOfPosition(
          statement.moduleSpecifier.getStart(
            source
          )
        );
      const end =
        source.getLineAndCharacterOfPosition(
          statement.moduleSpecifier.getEnd()
        );

      if (start.line !== end.line) {
        continue;
      }

      occurrences.push({
        range: [
          start.line,
          start.character,
          end.character
        ],
        symbol: targetSymbol
      });
    }

    documents.push({
      relativePath: relative,
      occurrences,
      symbols: [
        {
          symbol:
            symbolByFile.get(
              path.resolve(file)
            )!,
          displayName: path.basename(file)
        }
      ]
    });
  }

  const directory = await mkdtemp(
    path.join(
      os.tmpdir(),
      "arch-gate-test-scip-"
    )
  );
  const indexFile = path.join(
    directory,
    "index.scip"
  );

  await writeFile(
    indexFile,
    toBinary(
      IndexSchema,
      create(IndexSchema, {
        documents
      })
    )
  );

  return indexFile;
}

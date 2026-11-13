# arch-gate

Small project-specific architecture gate for a multi-repository system:

```text
pl (TypeScript) <-> api-contracts (OpenAPI) <-> bh (Java)
```

The goal is not to replace ESLint, FSD rules or Java analyzers. The first PoC protects two cross-repository invariants that language-specific linters do not own:

1. PL must not bypass the runtime API generated from `api-contracts` when calling BH.
2. PL wire DTOs are owned by `api-contracts`; manually recreated transport DTOs are rejected.

## Commands

Install dependencies and build:

```bash
npm install
npm run build
```

Check existing PL code:

```bash
npm run arch-gate -- check --config ./arch-gate.config.json
```

Machine-readable output:

```bash
npm run arch-gate -- check --config ./arch-gate.config.json --format json
```

Preflight an implementation plan before code is written:

```bash
npm run arch-gate -- plan ./architecture-intent.json --config ./arch-gate.config.json
```

The intended OpenSpec flow is:

```text
proposal/design/tasks
        |
        v
agent creates architecture-intent.json
        |
        v
arch-gate plan
        |
      PASS
        |
        v
openspec apply
        |
        v
arch-gate check
```

## Configuration

Copy `arch-gate.config.example.json` and point it to the three sibling repositories.

`generatedRuntimeDirs` defines where direct HTTP transport is allowed in PL. Any `fetch`, `XMLHttpRequest`, or configured HTTP-module import outside those directories is `ARCH001`.

`ARCH002` currently catches manually declared `interface`, `type`, or `class` names that duplicate OpenAPI schema names outside generated/allowed directories.

## Plan mode

`plan` validates architecture intent without source code. The first intent model contains:

- `apiCalls`: planned PL -> BH operations and the transport path used;
- `wireTypes`: planned wire DTOs and their source of truth.

Current plan rules:

- `PLAN001`: operation must exist in `api-contracts`;
- `PLAN002`: PL -> BH call must use `generated-runtime`;
- `PLAN003`: wire schema must exist in `api-contracts`;
- `PLAN004`: PL wire DTO source must be `api-contracts`.

## Scope and deliberate limitations

This is intentionally a narrow PoC, not a general architecture framework.

- It does not duplicate FSD/layer/public-API checks that belong in ESLint tooling.
- Java/BH source analysis is not implemented yet; `bh` is reserved in config for the next cross-repository rule when there is a concrete need.
- `ARCH002` is deliberately conservative and name-based; proving that an arbitrary PL domain type structurally duplicates a wire DTO requires richer data-flow/type analysis and should only be added if the project needs it.
- YAML OpenAPI files are supported through the `yaml` package; JSON works without YAML parsing.
- No baseline, graph visualization, plugin system or generic rule DSL is included.

The project should grow only when a real architecture invariant appears that existing language-specific quality gates cannot reliably enforce.

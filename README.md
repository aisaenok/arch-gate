# arch-gate

Small project-specific architecture gate for multi-repository systems.

The engine does not know repository names such as `pl`, `bh` or `api-contracts`. Repository names are configuration data; source-language handling belongs to analyzers; architectural meaning is expressed through roles.

For example, the same engine can model:

```text
frontend  --role api-consumer
contracts --role api-contract
backend   --role api-provider
```

and the actual directories can still point to repositories named `pl`, `api-contracts` and `bh`.

## Design

```text
                    config
                      |
          repositories + roles
                      |
        +-------------+-------------+
        |                           |
 TypeScript analyzer         OpenAPI analyzer
        |                           |
        +---------- facts ----------+
                      |
              architecture model
                      |
             project rules
                      |
                 violations
```

The current PoC protects two cross-repository invariants:

1. Repositories with the configured API-consumer role must not bypass their generated runtime boundary when using HTTP transport.
2. Wire DTOs used by configured API consumers are owned by repositories with the configured contract role rather than recreated manually.

This tool does not replace ESLint, FSD rules or Java analyzers.

## Commands

Install dependencies and build:

```bash
npm install
npm run build
```

Check existing code:

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

Intended OpenSpec flow:

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

## Configuration model

Repositories are keyed by arbitrary ids and have three independent properties:

- `type` selects a source analyzer such as `typescript`, `openapi` or `java`;
- `root` locates the repository;
- `roles` describe architectural meaning such as `api-consumer`, `api-contract` and `api-provider`.

Rules reference roles instead of repository names.

Example:

```json
{
  "repositories": {
    "frontend": {
      "type": "typescript",
      "root": "../pl",
      "roles": ["api-consumer"],
      "generatedRuntimeDirs": ["src/shared/api/generated"]
    },
    "contracts": {
      "type": "openapi",
      "root": "../api-contracts",
      "roles": ["api-contract"],
      "openapi": "openapi.yaml"
    },
    "backend": {
      "type": "java",
      "root": "../bh",
      "roles": ["api-provider"]
    }
  },
  "rules": {
    "apiThroughGenerated": {
      "consumerRole": "api-consumer",
      "providerRole": "api-provider",
      "contractRole": "api-contract"
    }
  }
}
```

Adding a second TypeScript consumer or another Java provider therefore changes configuration, not the core engine.

## Internal boundaries

`src/analyzers/*` extract language/source-specific facts only.

`src/core/*` contains the shared repository/fact model and has no project repository names.

`src/rules/*` evaluate architectural invariants over the shared model and select repositories by roles.

`src/engine.ts` orchestrates analyzers and rules.

`src/plan.ts` evaluates proposed architecture intent using repository ids and configured roles before implementation starts.

## Current rules

Runtime:

- `ARCH001`: a configured API consumer uses direct HTTP transport outside generated/explicitly allowed directories;
- `ARCH002`: a configured API consumer manually declares a type whose name is owned by a configured contract repository.

Plan:

- `PLAN000`: intent references an unknown repository id;
- `PLAN001`: planned operation is absent from configured contract repositories;
- `PLAN002`: planned consumer -> provider access bypasses generated runtime;
- `PLAN003`: planned wire schema is absent from its contract repository;
- `PLAN004`: planned wire DTO source does not have the configured contract role.

## Scope and deliberate limitations

This remains intentionally narrow rather than a generic framework.

- No FSD/layer/public-API checks that belong in ESLint tooling.
- Java repositories can have architectural roles, but Java source analysis is not implemented until a concrete rule needs Java facts.
- `ARCH002` is deliberately conservative and name-based.
- YAML OpenAPI files are supported through the `yaml` package.
- No baseline, graph visualization, plugin API or generic rule DSL.

The project should grow only when a real cross-repository invariant appears that existing language-specific quality gates cannot reliably enforce.

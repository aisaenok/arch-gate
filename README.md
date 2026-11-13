# arch-gate

Architecture gate with project policy in YAML and semantic facts extracted from source code.

The project is intentionally split into four layers:

```text
source / contracts / intent
          |
       analyzers
          |
 semantic facts + evidence
          |
 declarative rule engine
          |
 PASS / FAIL / PARTIAL
```

## Why evidence matters

A green result is meaningful only when the tool had enough evidence to judge the rule.

`arch-gate` therefore distinguishes:

- `PASS` — the required fact kinds were covered and no assertion failed;
- `FAIL` — one or more assertions failed;
- `PARTIAL` — the policy could not be fully evaluated because an analyzer is missing or resolution is incomplete.

CLI exit codes are:

- `0` PASS
- `1` FAIL
- `2` configuration/internal error
- `3` PARTIAL

Unknown fact kinds and unknown fields in YAML are configuration errors rather than vacuous passes.

## Current fact model

TypeScript currently produces:

- `http-call` — an actual call to `fetch` or a configured HTTP module, not merely an import;
- `module-dependency` — resolved source-module dependency facts;
- `http-reach` — transitive reachability from a source file to an HTTP call, including whether the path crosses generated runtime;
- `type-declaration` — type declarations with basic declaration provenance;
- `api-boundary-type` — argument types that cross into generated runtime, with contract/generated provenance.

OpenAPI produces:

- `contract-operation`
- `contract-schema`

Intent produces:

- `intent-api-call`
- `intent-wire-type`

Java endpoint facts are registered but currently reported as unavailable evidence. A rule that requires `backend-endpoint` therefore produces `PARTIAL`, never a false `PASS`.

## TypeScript semantics

The TypeScript analyzer now uses a `Program` and `TypeChecker`, not isolated AST files.

This enables:

- import resolution;
- transitive module reachability;
- resolving calls into generated runtime;
- checking actual argument type provenance at that boundary;
- distinguishing an unused `axios` import from an HTTP call.

The tool deliberately does not flag arbitrary local types just because their shape resembles an OpenAPI schema. A local DTO becomes relevant when it actually crosses a contract/generated boundary.

## Project policy

See `arch-gate.example.yml`.

A typical policy can now express:

- consumer HTTP must be reachable only through generated runtime;
- request types crossing the generated client boundary need contract provenance;
- every statically identified HTTP operation inside generated runtime must exist in OpenAPI;
- planned API operations and wire types must be contract-backed.

## Commands

```bash
npm install
npm test

npm run arch-gate -- check --config ./arch-gate.yml
npm run arch-gate -- plan ./architecture-intent.json --config ./arch-gate.yml
npm run arch-gate -- check --config ./arch-gate.yml --format json
```

## Deliberate limits

This is still a PoC.

- TypeScript resolution is compiler-based but not SCIP-based.
- Cross-function value/data-flow is intentionally limited.
- Java endpoint extraction is not implemented yet and is surfaced as PARTIAL evidence.
- No baseline/diff/impact/why graph tooling yet.
- The YAML DSL stays intentionally small; semantic complexity belongs in analyzers/facts, not in increasingly programmable YAML.

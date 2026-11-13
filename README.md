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

Java repositories configured with `frameworks: [jax-rs]` produce `backend-endpoint` facts from parsed Java syntax trees. The analyzer combines class/method `@Path` values with `@GET/@POST/@PUT/@PATCH/@DELETE/@HEAD/@OPTIONS` and normalizes them to the same `METHOD + path` key used by OpenAPI. If Java syntax cannot be parsed, endpoint evidence becomes `PARTIAL` rather than producing a false green result.

## TypeScript semantics

The TypeScript analyzer now uses a `Program` and `TypeChecker`, not isolated AST files.

This enables:

- import resolution;
- transitive module reachability;
- resolving calls into generated runtime;
- checking actual argument type provenance at that boundary;
- distinguishing an unused `axios` import from an HTTP call.

The tool deliberately does not flag arbitrary local types just because their shape resembles an OpenAPI schema. A local DTO becomes relevant when it actually crosses a contract/generated boundary.

## Repository topology

Roles classify repositories; relations describe which repositories belong together.

```yaml
relations:
  - type: implemented-by
    from: contracts-orders
    to: backend-orders

  - type: generated-for
    from: contracts-orders
    to: frontend-orders
```

Relation names are project-defined. The engine only understands directed edges.

A `memberOf` assertion can scope candidate facts through a relation:

```yaml
repositoryRelation:
  type: implemented-by
  currentField: repositoryId
  candidateField: repositoryId
  direction: outgoing
```

This prevents a contract operation from being accepted merely because some unrelated
repository with role `api-provider` implements the same endpoint.

If a relation-scoped rule has no matching topology edge, or the related repository
does not have sufficient analyzer evidence, the result is `PARTIAL` rather than a
guessed PASS/FAIL.

## Project policy

See `arch-gate.example.yml`.

A typical policy can now express:

- consumer HTTP must be reachable only through generated runtime;
- request types crossing the generated client boundary need contract provenance;
- generated frontend operations must exist in OpenAPI;
- backend JAX-RS endpoints must exist in OpenAPI;
- every OpenAPI operation must also be implemented by the backend;
- every OpenAPI operation must also be present in the generated frontend runtime;
- planned API operations and wire types must be contract-backed.

That lets a project enforce bidirectional contract completeness instead of only checking that implementation code does not drift outside the contract:

```text
generated frontend runtime  <->  OpenAPI  <->  backend endpoints
```

The reverse checks do not need engine-specific rule code. They are expressed with the same generic `memberOf` primitive used by the forward checks.

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
- Java endpoint extraction currently supports explicitly configured JAX-RS repositories; Spring MVC is not implemented yet.
- Repository relations scope multi-contract/multi-provider topologies; richer graph queries beyond direct edges are not implemented yet.
- No baseline/diff/impact/why graph tooling yet.
- The YAML DSL stays intentionally small; semantic complexity belongs in analyzers/facts, not in increasingly programmable YAML.

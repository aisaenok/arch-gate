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
- `http-reach` — transitive call reachability from a source file to an HTTP call, including whether the call path crosses generated runtime;
- `type-declaration` — type declarations with basic declaration provenance;
- `api-boundary-type` — argument types that cross into generated runtime, with contract/generated provenance.

OpenAPI produces:

- `contract-operation`
- `contract-schema`

Intent produces:

- `intent-api-call`
- `intent-wire-type`

Java repositories configured with `frameworks: [jax-rs]` produce `backend-endpoint` facts from parsed Java syntax trees. The analyzer combines class/method `@Path` values with `@GET/@POST/@PUT/@PATCH/@DELETE/@HEAD/@OPTIONS` and normalizes them to the same `METHOD + path` key used by OpenAPI.

Annotated interfaces are treated as endpoint metadata declarations, not implementations. A `backend-endpoint` is emitted for an interface-declared endpoint only when a repository-local class actually `implements` that interface and declares the matching method. The fact source and `className` point to the concrete class, while HTTP/path/operation metadata is inherited from the interface.

Interface method matching currently uses method name + arity rather than a full Java symbol/type solver. Same-name/same-arity overloads that differ only by parameter types remain a deliberate limitation.

If Java syntax cannot be parsed, endpoint evidence becomes `PARTIAL` rather than producing a false green result.

## TypeScript semantics

The TypeScript analyzer now uses a `Program` and `TypeChecker`, not isolated AST files.

This enables:

- import resolution and separate `module-dependency` facts;
- resolving actual call targets with the TypeChecker;
- transitive call reachability through local functions, wrappers and generated runtime;
- checking actual argument type provenance at the generated boundary;
- distinguishing symbol availability from execution.

`http-reach` is deliberately not built from the module dependency graph anymore. An
unused imported wrapper does not imply HTTP reachability, and calling one safe
function from a module does not make unrelated HTTP functions in that module
reachable.

Imports still contribute one execution edge into the imported module's top-level
scope, because ES module initialization can have side effects. Therefore a top-level
`fetch()` in an imported module remains reachable even when no imported function is
called.

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
  quantifier: all
```

This prevents a contract operation from being accepted merely because some unrelated
repository with role `api-provider` implements the same endpoint.

The quantifier controls multi-repository semantics:

- `any` — at least one related repository must contain the matching fact;
- `all` — every related repository must contain the matching fact.

The default is `any` for backward compatibility.

Evidence is evaluated against the quantifier rather than blindly against every related
repository. For example, `any` becomes PASS as soon as one related repository proves
the match, even if another alternative is unavailable. Conversely, `all` is FAIL
when a completely analyzed related repository is known to miss the fact, and PARTIAL
when the only missing repositories have incomplete evidence.

If a relation-scoped rule has no matching topology edge, the result is `PARTIAL`
rather than a guessed PASS/FAIL.

For topologies where the fact-bearing repository is not directly adjacent to the
current repository, use an explicit bounded path:

```yaml
repositoryRelation:
  currentField: providerRepositoryId
  candidateField: repositoryId
  path:
    - type: forwards-to
      direction: outgoing
    - type: implemented-by
      direction: incoming
  quantifier: any
```

This example traverses:

```text
bff --forwards-to--> backend <--implemented-by-- contract
```

The path is exact and finite. `arch-gate` does not perform unrestricted graph
reachability, wildcard relation matching, or depth-based searches. This keeps the
topology language deterministic and reviewable.

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
- Call reachability follows statically resolved call targets; higher-order value flow, dynamic dispatch and arbitrary function-value propagation are intentionally limited.
- Java endpoint extraction supports explicitly configured JAX-RS repositories, including repository-local interface metadata inheritance. Full Java type resolution, external interface inheritance, and Spring MVC are not implemented yet.
- Repository relations support direct edges and explicit bounded paths; unrestricted graph reachability and wildcard graph queries are intentionally not implemented.
- No baseline/diff/impact/why graph tooling yet.
- The YAML DSL stays intentionally small; semantic complexity belongs in analyzers/facts, not in increasingly programmable YAML.

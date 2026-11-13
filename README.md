# arch-gate

Small architecture gate with a generic fact engine and project-specific declarative policy.

The engine does not contain project rules. A project defines repositories, roles and rules in YAML; analyzers only extract facts from source formats.

## Design

```text
TypeScript / OpenAPI / intent
           |
        analyzers
           |
          facts
           |
   generic rule engine
   selectors + conditions
           |
      arch-gate.yml
           |
       violations
```

There is deliberately no `src/rules/` directory.

Adding a normal architecture rule should mean changing `arch-gate.yml`, not adding a TypeScript module.

## Configuration

See `arch-gate.example.yml`.

Repositories are arbitrary ids with:

- `type`: selects an analyzer;
- `root`: locates the repository;
- `roles`: gives the repository architectural meaning;
- analyzer-specific settings such as `generatedRuntimeDirs` or `openapi`.

Rules are an array of declarations.

A rule has:

- `id` and `description`;
- `scope`: `check`, `plan` or `both`;
- `select.fact`: the fact kind to evaluate;
- optional `select.repositoryRoles` and `select.where`;
- one or more `assert` conditions;
- optional `sourceField` / `targetField` for diagnostics.

## DSL primitives

Selectors:

```yaml
select:
  fact: http-usage
  repositoryRoles:
    - field: repositoryId
      role: api-consumer
  where:
    - field: manualContractTypeAllowed
      equals: false
```

Assertions currently support four generic operators.

Equality:

```yaml
- field: directHttpAllowed
  equals: true
```

Repository role:

```yaml
- field: sourceRepositoryId
  hasRole: api-contract
```

Repository existence:

```yaml
- field: consumerRepositoryId
  repositoryExists: true
```

Membership in another fact set:

```yaml
- field: operationId
  memberOf:
    fact: contract-operation
    field: operationId
    repositoryRoles:
      - field: repositoryId
        role: api-contract
```

Any assertion can be inverted with `not: true`.

`memberOf.repositoryMatch` can correlate the selected fact with another repository id, for example to require a schema to exist specifically in the repository named by `sourceRepositoryId`.

## Current project policy example

The example YAML expresses the original cross-repository invariants without TypeScript rule modules:

- consumers may use direct HTTP only in generated/explicitly allowed runtime locations;
- consumers must not recreate contract-owned wire schema names;
- a planned operation must exist in the contract;
- a planned API call must use generated runtime;
- a planned wire type must exist in its declared source contract;
- the declared wire source must have the contract role.

These are examples, not engine behavior.

## Commands

```bash
npm install
npm run build

npm run arch-gate -- check --config ./arch-gate.yml
npm run arch-gate -- plan ./architecture-intent.json --config ./arch-gate.yml
npm run arch-gate -- check --config ./arch-gate.yml --format json
```

## OpenSpec preflight

```text
proposal/design/tasks
        |
        v
architecture-intent.json
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

The preflight and post-implementation check use the same generic rule engine; only the fact source and rule `scope` differ.

## Boundaries

`src/analyzers/*` knows source formats and emits generic facts.

`src/core/selectors.ts` selects facts.

`src/core/conditions.ts` implements the small reusable predicate vocabulary.

`src/core/engine.ts` evaluates declarative rules.

`src/engine.ts` orchestrates analyzers and the rule engine.

The engine should only gain a new predicate when a needed invariant cannot be expressed by composing the existing generic predicates. Project-specific invariants should not become TypeScript modules.

## Deliberate limitations

- This is not intended to become a full programming language in YAML.
- There is no plugin API or project-specific `rules/*.ts`.
- Java source analysis remains absent until a real rule requires Java facts.
- TypeScript DTO detection is still conservative and name-based.
- No FSD/layer rules, baseline, visualization or graph database.

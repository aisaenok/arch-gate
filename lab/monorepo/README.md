# Architecture Gate monorepo lab

A small polyglot monorepo used to exercise the architecture gate against something closer to a real project than isolated fixtures.

## Layout

```text
apps/
  frontend/
    src/                         valid TypeScript API consumer
    scenarios/
      invalid-http/              direct axios usage
      invalid-dto/               hand-written contract DTO

packages/
  api-contracts/                 OpenAPI source of truth

services/
  backend/                       Java API provider

plans/
  valid.json
  invalid-custom-http.json
  invalid-wire-source.json
  invalid-operation.json

arch-gate.yml
arch-gate.invalid-http.yml
arch-gate.invalid-dto.yml
```

The intended dependency flow is:

```text
frontend
   |
generated runtime
   |
api-contracts
   |
backend
```

The frontend has a separate domain model and mapper; only the wire model is generated/owned by the API contract.

## Runtime checks

From repository root:

```bash
npm install
npm test

# expected PASS
npm run arch-gate -- check --config ./lab/monorepo/arch-gate.yml

# expected FAIL: API001
npm run arch-gate -- check --config ./lab/monorepo/arch-gate.invalid-http.yml

# expected FAIL: API002
npm run arch-gate -- check --config ./lab/monorepo/arch-gate.invalid-dto.yml
```

## Plan checks

```bash
# expected PASS
npm run arch-gate -- plan ./lab/monorepo/plans/valid.json \
  --config ./lab/monorepo/arch-gate.yml

# expected FAIL: PLAN002
npm run arch-gate -- plan ./lab/monorepo/plans/invalid-custom-http.json \
  --config ./lab/monorepo/arch-gate.yml

# expected FAIL: PLAN003 + PLAN004
npm run arch-gate -- plan ./lab/monorepo/plans/invalid-wire-source.json \
  --config ./lab/monorepo/arch-gate.yml

# expected FAIL: PLAN001
npm run arch-gate -- plan ./lab/monorepo/plans/invalid-operation.json \
  --config ./lab/monorepo/arch-gate.yml
```

The lab is intentionally small and mutable: its purpose is to expose weak spots in the analyzer/fact model/DSL quickly, not to simulate a full production system.

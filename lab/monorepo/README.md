# Architecture Gate monorepo lab

A small polyglot monorepo used to exercise the architecture gate against something closer to a real project than isolated fixtures.

## Layout

```text
apps/
  frontend/              TypeScript API consumer
packages/
  api-contracts/         OpenAPI source of truth
services/
  backend/               Java API provider
plans/
  valid.json
  invalid-custom-http.json
  invalid-wire-source.json
  invalid-operation.json
arch-gate.yml
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

## Run from repository root

```bash
npm install
npm test

npm run arch-gate -- check --config ./lab/monorepo/arch-gate.yml

npm run arch-gate -- plan ./lab/monorepo/plans/valid.json \
  --config ./lab/monorepo/arch-gate.yml

npm run arch-gate -- plan ./lab/monorepo/plans/invalid-custom-http.json \
  --config ./lab/monorepo/arch-gate.yml

npm run arch-gate -- plan ./lab/monorepo/plans/invalid-wire-source.json \
  --config ./lab/monorepo/arch-gate.yml

npm run arch-gate -- plan ./lab/monorepo/plans/invalid-operation.json \
  --config ./lab/monorepo/arch-gate.yml
```

Expected results:

- `check` passes on the current code;
- `valid.json` passes;
- `invalid-custom-http.json` fails `PLAN002`;
- `invalid-wire-source.json` fails `PLAN003` and `PLAN004`;
- `invalid-operation.json` fails `PLAN001`.

This lab is intentionally kept small so we can mutate it while developing the DSL and immediately see whether a rule is expressive enough or produces useful diagnostics.

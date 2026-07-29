# Contributing

Thank you for improving TiCity. Start with [AGENTS.md](AGENTS.md), especially
the accuracy boundary between an educational model and observed TiDB behavior.

## Development

```bash
npm install
npm run dev
```

Before opening a pull request:

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

For architecture corrections, link to primary TiDB documentation or source and
explain which model invariant changes. For visible work, include before/after
screenshots in both day and night themes. Keep Japanese and English catalog keys
in sync and preserve Apache-2.0 attribution.

Do not submit telemetry, live-cluster credentials, SQL execution, copied brand
assets, or generated result data.

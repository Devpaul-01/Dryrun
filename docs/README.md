# Documentation

Longer-form documentation for DryRun. Start with the [root README](../README.md) for what the product is and how to run it.

| Document | Read it when you want to... |
|---|---|
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | understand the system design: the AI validation pipeline, the sequence-index race, billing reconciliation, caching and invalidation, and the trade-offs behind them |
| [`../PRODUCT_OVERVIEW.md`](../PRODUCT_OVERVIEW.md) | see the product workflows and the reasoning behind them |
| [`BACKGROUND_JOBS.md`](./BACKGROUND_JOBS.md) | work on queues, workers or the scheduler: the 21 handlers, 7 cron schedules, Redis usage, failure behavior, how to add a job, and known limitations |
| [`CONFIGURATION.md`](./CONFIGURATION.md) | find an environment variable, its default, and what happens when it is missing |
| [`FRONTEND_ARCHITECTURE.md`](./FRONTEND_ARCHITECTURE.md) | read the design the mobile client was built from (API surface, data models, navigation, design system) |
| [`backend-takeover/AUDIT.md`](./backend-takeover/AUDIT.md) | follow the dated log of audit passes and the fixes they led to |

Package-level guides:

- [`../backend/README.md`](../backend/README.md) — setup, entry points, database, Supabase Auth
- [`../backend/src/db/migrations/README.md`](../backend/src/db/migrations/README.md) — applying and ordering the migrations
- [`../backend/test/README.md`](../backend/test/README.md) — backend test suites
- [`../frontend/README.md`](../frontend/README.md) — mobile client setup, layout and testing
- [`../frontend/.maestro/README.md`](../frontend/.maestro/README.md) — device smoke flows

## Which document wins?

When prose and code disagree, the code does. `backend/src/config/env.ts` is the source of truth for configuration and `backend/src/db/migrations/` for the schema. Please fix the document in the same change that makes it wrong.

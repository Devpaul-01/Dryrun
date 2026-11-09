# DryRun Mobile

Expo / React Native / TypeScript client for DryRun, consuming the API in `../backend`.

See [`../docs/FRONTEND_ARCHITECTURE.md`](../docs/FRONTEND_ARCHITECTURE.md) for the full architecture (API surface, data models, navigation, design system, implementation milestones).

## Setup

```bash
cd frontend
npm install
cp .env.example .env   # fill in your local API base URL / Supabase anon key
npm start
```

## Stack

- Expo (managed) + React Native + TypeScript (strict)
- `expo-router` for file-based navigation
- TanStack Query for server state
- Zustand for client/UI state
- `react-hook-form` + `zod` for forms
- `axios` for HTTP

## Scripts

- `npm start` — Expo dev server
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint
- `npm test` — Jest

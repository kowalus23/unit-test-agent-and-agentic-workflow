# Taskly App Node

Two independent npm projects (no workspaces). Always run commands inside the right one.

| | `backend/` | `frontend/` |
|---|---|---|
| Stack | Node.js + TypeScript + Express 5, Prisma 7 (PostgreSQL, `@prisma/adapter-pg`), zod | React 19 + TypeScript, Vite 6, React Query 5, styled-components |
| Tests | Vitest + Supertest, flat in `backend/tests/<module>.test.ts` | Vitest + Testing Library (jsdom), colocated `X.test.tsx` next to `X.tsx` |
| Commands | `npm run typecheck`, `npm test`, `npm run test:coverage`, `npm run db:generate` | `npm run typecheck`, `npm test`, `npm run test:coverage`, `npm run format:check`, `npm run storybook` |

- Node.js 24 (`.nvmrc`); `engines` floor is 22.12.
- The backend Prisma client is generated into `backend/src/generated/` (git-ignored): run `npm run db:generate` after install.
- Unit tests never need a database: Prisma delegates are mocked.
- `scripts/` holds repository tooling (TypeScript run by Node type stripping, tested with `node --test`).

## Unit-test agent

- Agent: `.claude/agents/unit-test-engineer.md`. Skills: `.claude/skills/*` (analyzing-test-impact, writing-backend-unit-tests, writing-frontend-unit-tests, running-unit-tests, reviewing-test-quality, reporting-test-results).
- What the agent may change is defined once in `.claude/policy/test-policy.json` and enforced by `.claude/hooks/guard-tool-use.ts` and `.claude/lib/patch-guard.ts`.
- Run it locally like CI does: `node scripts/agent/plan.ts --mode sweep --targets <files> --out /tmp/plan.json` then `node scripts/agent/run-agent.ts --plan /tmp/plan.json --out /tmp/agent`.

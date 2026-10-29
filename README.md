# BuildTrack

Construction site progress and quality assurance for **Valencia Construction Services**. Engineers, foremen and clients work from one record: pins on uploaded blueprints, progress that only counts once an engineer verifies it, inspections and defect reports (NCR), daily site logs, and a client portal in plain language.

> Capstone project. Working notes for AI assistants are in [CLAUDE.md](CLAUDE.md); this file is for people.

## What it does

| Role | Workspace | Main jobs |
|---|---|---|
| Admin / Super Admin | Control center | Company administration: all projects (create, archive, assign Project Managers), users and access, invitations, approvals, ID checks, biometrics, audit log, QA template library, settings, full backups |
| Project Manager | Project office | Assigned projects only: dashboard, details, team and blueprint access, work assignment, plans and revisions, schedule, QA monitoring (read-only), attendance concerns, reports and project export, project audit log |
| Engineer | Engineering office | Plans and pins, assignments, review inbox (inspect, decide NCR corrections, accept work items), QA register, progress and S-curve, reports |
| Foreman | Field operations | My work, report progress with photos, daily reports, QA requests, corrections in one form (progress works offline) |
| Client | Client portal | Honest progress (only verified work), plans, site logs, report a problem, ask the team |
| Basic user | My account | Profile, ID verification, ask for a role |

The Project office is exclusive to Project Manager accounts. Admins use the Control center to create/archive projects and assign their managers; direct Project office links return Admins to their dashboard.

Core ideas: **reported vs verified progress**, **evidence that cannot be deleted** once work is submitted, **role-based access enforced in the database**, **data privacy** (RA 10173) built in. Details and the reasoning are in `docs/`.

## Stack

React 19, TypeScript, Vite 8, Tailwind CSS v4, `@supabase/supabase-js`. Backend is Supabase: Auth, Postgres with Row Level Security, Storage, Realtime, and Edge Functions (Deno). Email through Brevo. No router library (custom `pushState` routing in `src/App.tsx`).

## Run it

Requirements: Node 22.18 or newer, [pnpm](https://pnpm.io) 10.

```bash
pnpm install
cp .env.example .env.local        # then fill in the two values below
pnpm dev                          # http://localhost:8443
```

`.env.local` needs only the **public** values of the BuildTrack Supabase project (ask the project owner):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon / publishable key>
```

Never put the service-role key, the Brevo key or the Google secret in `src/` or in any file that is committed. They live only in `.env.secrets` (gitignored) and in Supabase secrets.

## Check your work

| Command | What it does |
|---|---|
| `pnpm check` | Everything below plus the production build. Run before every push (CI runs it too). |
| `npx tsc --noEmit` | Type-check |
| `pnpm test:lib` | Pure logic tests (geometry, progress, QA rules, paging, S-curve ...) |
| `pnpm test:sql` | Applies every migration to an in-memory Postgres (PGlite) and tests Row Level Security and triggers as each role |
| `pnpm test:load` | Load test: 50 sheets, 5,000 pins, 500 NCRs; prints how long the app's queries take per role |
| `pnpm build` | Production build |

## Project layout

```
src/
  App.tsx                 routing and page shells
  pages/{Admin,Engineer,Foreman,Client,User,Auth,Public}/   one folder per role
  components/             shared UI (shell/, editor/, qa/, identity/, ui/ ...)
  lib/                    data hooks and pure logic (tested in scripts/test-lib.mjs)
supabase/
  migrations/             numbered SQL, the source of truth for the database
  functions/              Edge Functions: admin-users, impersonate, oauth-gate, send-notifications
  tests/                  SQL test cases (NN-name.cases.mjs) + harness
docs/                     design notes, setup guides, roadmaps; docs/audits/ = change log
scripts/                  test runners, load test, migration runner, CSS pruner
```

## Working on it

Read **[CONTRIBUTING.md](CONTRIBUTING.md)** first: branches and pull requests, how to add a page, a table, a policy or a notification, and the rules every change follows. **[docs/HANDOVER.md](docs/HANDOVER.md)** explains how the pieces connect and what is still open.

## Documentation map

| File | Read it for |
|---|---|
| `docs/HANDOVER.md` | How the system fits together, status, open items |
| `docs/BUILDTRACK_PRODUCT_ROADMAP.md` | What is live and what is still sample data |
| `docs/BUILDTRACK_AUTH_SETUP.md`, `docs/BUILDTRACK_EMAIL_SETUP.md` | Supabase Auth, Brevo, notification emails |
| `docs/BUILDTRACK_BACKUP_RESTORE.md` | Backups and restore |
| `docs/BUILDTRACK_QA_BASIS.md` | Where the QA rules come from |
| `docs/BUILDTRACK_INTEGRITY_NOTES.md`, `docs/BUILDTRACK_PANEL_FEATURES.md` | Loopholes, anti-fraud ideas, feature plan |
| `docs/audits/` | One note per change, and the list of every database migration |

## Still sample data

Admin **Biometrics registration** and Foreman **Biometric attendance** show example data (each page says so). Everything else reads and writes the real database.

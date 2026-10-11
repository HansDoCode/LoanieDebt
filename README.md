# Loanie's Debt

Phone-first private debt ledger for one lender. It is built with React, TypeScript, Vite, and Supabase Auth/Postgres. Without Supabase environment variables it runs in a local-demo mode so the workflows can be tested safely before connecting a project.

## Run it

```bash
npm install
npm run dev
```

In local-demo mode, create an owner PIN on first launch. Local data stays in this browser and is not a substitute for a protected production account.

## Supabase setup

1. Create a Supabase project and enable email/password Auth.
2. Run `supabase/migrations/001_app_state.sql` in the SQL editor.
3. Copy `.env.example` to `.env.local` and fill in the project URL and anon key.
4. Restart Vite.

The client only uses the anon key. Row-level security limits the single `app_state` row to the signed-in owner. Never put a service-role key in `.env.local` or the browser bundle.

## Checks

```bash
npm test
npm run build
```

The MVP includes borrower and loan history, release confirmation, ledger payments and reversals, renewal links, guarantor rewards, backup/restore, CSV export, local date-based due labels, and responsive accessible forms.

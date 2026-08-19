@AGENTS.md

# CLAUDE.md

Guidance for Claude when working in this repository.

## Commit and PR rules

**No AI attribution anywhere.** Applies to every artifact that leaves this machine:

- Never add `Co-Authored-By: Claude <noreply@anthropic.com>` or any `Co-Authored-By` trailer naming an AI tool.
- Never add "Generated with Claude Code", "Made with AI", or any similar footer, badge, or sign-off.
- Never mention Claude, Anthropic, ChatGPT, Copilot, "AI-generated", "LLM", or "assistant" in: commit messages, branch names, PR titles, PR descriptions, issue titles or comments, release notes, changelog entries, or code comments.
- Write every commit as the repo author would. Imperative subject, `scope(area): resumen` prefix, no emoji, no filler.
- **Commit language: Spanish**, matching existing history (`fix(canales): dejar de simular en silencio los canales sin configurar`).

Exception: naming OpenAI/Anthropic as a *product dependency* is fine when it is factually part of the system — a model ID, a provider name in `lib/`, a doc explaining the transcription pipeline. The ban is on attribution, not on the API.

## Sensitive data — never commit

**This repo handles protected health information.** Treat every leak as a reportable incident, not a cleanup task.

**Never stage:**
- `.env` and every variant except `.env.example` (`.gitignore` already enforces `.env*` — do not weaken it).
- Supabase service-role keys, JWT secrets, OpenAI keys, Daily.co API keys, webhook signing secrets, SMTP credentials.
- Production dumps or any fixture containing real patient names, emails, phones, national IDs, dates of birth, or addresses.
- **Clinical content of any kind**: consultation notes, transcripts, diarization output, PHQ-9 or other psychometric scores, risk flags, clinical state, referral letters, generated PDFs.
- **Identity verification documents** or anything derived from them. `tests/verification-documents-purge.test.ts` exists because these must not persist — they must certainly not be committed.
- Real doctor, clinic, or patient records in `docs/`, screenshots, or issue comments. Not even "just one example."
- Logs or error payloads captured from production.

**Migrations (`supabase/migrations/`):**
- Schema, RLS policies, grants, triggers and functions are fine and belong in git.
- Never hardcode a service-role key, a real clinic UUID, or seed rows with real people.
- RLS is the primary safeguard for patient isolation — `tests/rls.test.ts` must stay green. Never add a policy that widens access without a test proving the boundary still holds.
- Migrations are applied to production **automatically by CI** on merge to `main` (`deploy` job in `.github/workflows/ci.yml`), in this order: migrate → deploy without alias → verify → promote. Production is never swapped for something unverified, and code never runs against an un-migrated schema. Never apply migrations by hand and never bypass that order. Two rules that job depends on, both learned the hard way on 2026-08-19: **CI must not build the app** (every Vercel env var is marked Sensitive, so `vercel pull` cannot read their values and a `--prebuilt` build bakes in an empty `NEXT_PUBLIC_SUPABASE_URL`), and **verification must happen before promoting**. `deploy/production-migration.sql` is obsolete and kept only as a no-op note.
- Keep migrations **additive** whenever possible. The deploy order tolerates "new schema + old code" (old code ignores what it doesn't know) but not the reverse. A destructive change (drop/rename of something in use) must be split across two deploys.

**Tests:** fixtures must use obviously synthetic patients (`Paciente Demo`, `paciente@example.com`, DOB `1990-01-01`). Never seed a test from a production row. `tests/providers-live.test.ts` touches real services — it must never carry real credentials in the file.

**Rules of thumb:**
- Every example value must be obviously fake: `user@example.com`, `sk_test_xxx`, `Paciente Demo`, `+10000000000`.
- If a doc needs a real payload to be useful, keep the shape and redact the values.
- Never run `git add -A` or `git add .`. Stage explicit paths so nothing rides along.
- If unsure whether a file is sensitive, do not stage it — ask first.

## Commands

```bash
npm run dev          # Next dev server
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
npm run test:watch   # vitest
npm run test:e2e     # playwright
```

Run `typecheck` and `test` before every commit. `rls.test.ts`, `retention.test.ts` and `verification-documents-purge.test.ts` guard legal obligations — treat a failure there as a blocker, never as flaky.

## Architecture

**e-irene** is a telehealth platform for mental-health clinics: doctors run video consultations with patients, the system captures and transcribes them, scores psychometric instruments, and raises risk alerts.

- **Stack:** Next.js App Router (root `app/`), Supabase (Postgres + Auth + Storage + RLS), Daily.co for video, `@react-pdf/renderer` for reports, Tailwind + shadcn/base-ui, Vercel.

### Layout

```
app/(auth)/          # login, signup
app/(app)/           # authed clinician app
  patients/          appointments/     consultations/
  verificacion/      reports/          settings/    dashboard/
app/admin/           # platform admin
  clinicas/  doctores/  planes/  citas/  canales/
  verificaciones/    configuracion/
app/join/[token]     # patient entry into a consultation
app/enlace/[token]   # tokenised patient link
app/api/webhooks/    # billing + provider callbacks
app/api/cron/        # retention purges, reconciliation
app/seguridad/ terminos/ privacidad/   # public policy pages
lib/video/           # Daily.co session lifecycle
types/database.ts    # generated Supabase types
deploy/              # obsolete: see the note inside production-migration.sql
```

### Domains to be careful with

- **Retention** (`retention.test.ts`, `verification-documents-purge.test.ts`) — documents and clinical artifacts have mandated lifetimes. Changing a purge path changes a legal commitment.
- **Risk evaluation** (`risk-eval/`, `risk-flags`, `phq9-risk-alerts`) — this pipeline decides when a clinician is alerted about a patient at risk. Never silence, batch, or lossily refactor an alert path.
- **Consent** (`consent-age`, `policy-acceptance`) — gates whether a patient may be onboarded at all.
- **RLS** (`rls.test.ts`) — the tenant boundary between clinics.
- **Billing** (`billing-checkout`, `billing-reconcile`, `plans`) — reconciliation is idempotent by design; keep it that way.

### Conventions

- Patient-facing routes are Spanish (`verificacion`, `citas`, `enlace`); code identifiers are English.
- All date handling goes through `lib` helpers covered by `dates.test.ts`.
- Channels that are not configured must fail loudly, not simulate — see commit `978ed9b`.

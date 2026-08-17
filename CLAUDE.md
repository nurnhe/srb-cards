# Serbian Cards — project context

A personal Serbian↔Russian vocabulary flashcard app. Kira is learning Serbian;
this app stores her vocabulary and quizzes her on it.

## Stack

- React (single-file component tree in `src/App.jsx`), built with Vite
- Styling: inline styles + Tailwind utility classes (no custom Tailwind config)
- Data: Supabase (Postgres + REST via `@supabase/supabase-js`), client created in
  `src/supabaseClient.js` from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- Hosting: Netlify, connected to a GitHub repo — pushes to `main` auto-deploy
- No auth. The `anon` key + fully open RLS policies (`using (true) with check
  (true)`) mean anyone with the key can read/write. Acceptable trade-off for a
  personal low-stakes app; flagged, not fixed.

## Local dev

```
npm install
cp .env.example .env   # fill in real Supabase URL + anon key
npm run dev             # http://localhost:5173
```

`.env` is gitignored. **Local dev hits the real production Supabase
database** — there is no separate dev/test project. Test data really gets
saved; clean it up manually if needed.

Deploy flow: commit + push to `main` → Netlify auto-builds (`npm run build`,
publish dir `dist`) → live. Netlify env vars (Site configuration →
Environment variables) must mirror `.env` — a stale value there is a common
source of "works locally, broken in prod" bugs. Netlify build settings must
have Build command `npm run build` and Publish directory `dist`, or it
silently serves unbuilt source instead of running Vite.

## Database schema (Supabase, all in `public` schema)

- **words**: `id uuid pk`, `sr text`, `ru text` (comma-separated accepted
  translation variants), `example text` (nullable, Serbian-only usage
  example), `correct_count int default 0`, `wrong_count int default 0`,
  `created_at timestamptz`
- **word_links**: `word_id`, `related_word_id` (both fk → words, cascade
  delete) — symmetric relation for linking same-root words (e.g. verb ↔
  noun); both directions are inserted on link
- **tags** / **word_tags**: many-to-many tagging, same cascade-delete pattern
- Any new table needs RLS enabled + a `using (true) with check (true)` policy
  to match the existing open-access pattern, unless deliberately changing
  that trade-off

Schema changes ship as raw SQL Kira runs herself in Supabase's SQL Editor —
there's no migration tool/history. When adding a column or table, give her
the exact SQL, prefer `if not exists` so it's safe to re-run.

## Key conventions in `App.jsx`

- **Serbian script**: stored in whichever script was typed; the *other*
  script is derived on the fly via `cyrillicToLatin`/`latinToCyrillic`
  (deterministic, not stored). `otherScript(sr)` picks the right direction.
  Answer-checking accepts either script for sr answers.
- **Case**: `sr` and `ru` are lowercased on save so e.g. "Blag"/"blag" collapse
  to one entry. `example` is *not* lowercased (it's a full sentence) —
  known inconsistency, tracked in the Notion backlog, not yet fixed.
  Existing rows were not retroactively migrated when this was added.
- **Translation variants**: `ru` is a comma-separated list; any variant
  matching the input (normalized: trimmed, lowercased, punctuation
  stripped) counts as correct. `VariantsEditor` component manages this as
  chips in the UI.
- **Practice deck**: `Practice` draws from a shuffled "deck" (Fisher–Yates)
  that guarantees every word in the current pool appears once before any
  repeat, rather than pure `Math.random()` each draw. The pool can be
  narrowed by tag via `TagScopeBar`.
- **Design tokens**: dark navy background `#12192E`, card surface `#1B2440`,
  borders `#2A3355`, accent red `#C41E3A`, gold accent `#D4A54A`. Fonts: PT
  Serif (display), Inter (body), JetBrains Mono (labels/stats), loaded via a
  Google Fonts `<link>` injected at runtime (`useGoogleFonts`).

## External APIs in use (all best-effort, client-side, no server)

- **MyMemory** (`api.mymemory.translated.net`) — free, CORS-enabled,
  translation suggestions for the "Предложи" button. Machine-translated,
  quality varies; presented as suggestions to review, not auto-accepted.
- **Tatoeba** + **Glosbe** (fallback) — best-effort Serbian example
  sentence lookup. Coverage for Serbian is thin; frequently finds nothing,
  and that's expected, not a bug. Manual entry is the reliable fallback.

## Where the backlog lives

Feature ideas and bugs are tracked in Notion, not GitHub Issues: **[Serbian
Cards — project](https://app.notion.com/p/3b75f960e5ab8131a87ac47707d44d87)**,
database "Tasks". Fields: Task, Status (Not started / In progress / Done),
Priority (low/medium/high), Notes.

**Only mark a task Done when Kira explicitly confirms it's deployed and
working.** Finishing the code is not enough — she tests and deploys herself.

## Workflow expectations

- Kira is not a developer. Explanations, commit messages, and any
  user-facing copy should stay plain and jargon-free.
- She deploys and runs Supabase SQL herself — don't assume either happened
  without her confirming it.
- Prefer small, reviewable changes over large rewrites; she reads diffs.

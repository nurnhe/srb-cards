# Serbian Cards — project context

A personal Serbian↔Russian vocabulary flashcard app. Kira is learning Serbian;
this app stores her vocabulary and quizzes her on it.

## Stack

- React (single-file component tree in `src/App.jsx`), built with Vite
- Styling: inline styles + Tailwind utility classes (no custom Tailwind config)
- Backend: Node + Express in `backend/`, talks to Supabase with
  `@supabase/supabase-js`. The browser never touches the database — it calls
  `/api/*` through `src/api.js`.
- Data: Supabase (Postgres). Credentials come from `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY`, read only by the backend (`backend/src/supabase.js`).
- Hosting: **`main` only.** Netlify auto-deploys pushes to `main`, which still
  has the old browser-talks-to-Supabase code and still works.

### Branch state — read this first

The backend lives on `refactor/add_backend` and is **deliberately not merged**.
No host has been chosen for it yet, so merging it to `main` would deploy a
frontend with no backend to call, i.e. a broken site. Merge only after picking a
place to run `backend/` and pointing `VITE_API_URL` at it.

Consequences while that is true:
- There is one `Dockerfile`, at the repo root, and it covers both ways of
  running the app: `--target dev` builds the development image (what
  `run_dev.sh` uses), and the plain build produces the release image — built
  site plus API in one container, see "Running the release version in Docker"
  below. The old `dev/` folder is gone; run `./run_dev.sh --rebuild` once after
  this change. What is still missing is only the hosting decision itself: where
  that container runs, and the login that has to sit in front of it.
- `recordAnswer` used to leave the error banner stuck after one failed save (it
  never cleared `storageError` on success). Rewriting it for the API fixed that
  as a side effect.

### Security — the service_role key

The backend uses Supabase's `service_role` key, which **bypasses RLS entirely**,
and the backend itself has no login. That is fine bound to localhost in Docker,
which is why `run_dev.sh` publishes the ports on `127.0.0.1` only.

Do not expose this backend to the internet until it has auth in front of it. And
never rename the key to anything starting with `VITE_` — Vite bakes `VITE_*`
variables into the JavaScript, which would publish it to every visitor.

## Local dev

Everything runs in one Docker container — the Vite dev server and the API side
by side, with this folder mounted inside so edits are live:

```
cp .env.example .env   # fill in the Supabase URL + service_role key
./run_dev.sh           # http://localhost:5173
```

`./run_dev.sh` builds the image if it is missing, then creates the container if
it does not exist or starts it if it does. Other flags:

- `--rebuild` — rebuild the image. **Needed after any change to a
  `package.json`**, because dependencies are installed into the image, not into
  the mounted folder.
- `--recreate` — throw the container away and make a fresh one. **Needed after
  editing `.env`**, since Docker only reads it when the container is created.
- `--stop` — stop it.

`.env` is gitignored. Write values **without quotes** — Docker reads the file
itself and treats quotes as part of the value.

**Local dev hits the real production Supabase database** — there is no separate
dev/test project. Test data really gets saved; clean it up manually if needed.

Running without Docker also works (`npm install && npm run dev` plus
`cd backend && npm install && npm start`), but the backend **requires Node 22+** —
`@supabase/supabase-js` crashes on boot under Node 20 for want of a native
`WebSocket`. The container pins `node:22-alpine`, so `./run_dev.sh` is the path
that always works.

Deploy flow (for `main` as it stands today): commit + push to `main` → Netlify
auto-builds (`npm run build`, publish dir `dist`) → live. Netlify env vars (Site
configuration → Environment variables) must mirror `.env` — a stale value there
is a common source of "works locally, broken in prod" bugs. Netlify build
settings must have Build command `npm run build` and Publish directory `dist`,
or it silently serves unbuilt source instead of running Vite.

## The API

`src/api.js` (browser) → `/api/*` → `backend/src/routes/*` → Supabase. In dev
the frontend uses relative URLs and Vite proxies `/api` to port 3000
(`vite.config.js`); `VITE_API_URL` overrides the base once the backend is hosted
somewhere.

| Endpoint | Does |
| --- | --- |
| `GET /api/vocabulary` | Everything on startup: words (each with `relatedIds` + `tagIds` already attached) and tags, in one request |
| `POST /api/words` | Add a word; returns the saved row |
| `PATCH /api/words/:id` | Edit a word; returns the saved row |
| `POST /api/words/:id/answer` | Record a practice answer (`{correct}`); returns the new counts |
| `DELETE /api/words/:id` | Delete a word (links and tags go with it via DB cascade) |
| `POST /api/links` | Link two words (writes both directions) |
| `DELETE /api/links?a=&b=` | Unlink two words |
| `POST /api/words/:id/tags` | Tag by name, creating the tag if needed; returns the tag |
| `DELETE /api/words/:wordId/tags/:tagId` | Remove a tag from a word |
| `GET /api/health` | Liveness check |

Conventions worth keeping:
- Each `src/api.js` function resolves to `{ data, error }` — the same shape
  supabase-js used, which is why the call sites in `App.jsx` barely changed. The
  wrapper catches network failures too, so nothing throws at a call site.
- `sr`/`ru` are lowercased **on the server** (`backend/src/http.js`), so that
  rule lives in one place. Routes return the saved row and the browser patches
  its state from that rather than re-deriving it.
- Link and tag writes are idempotent upserts on purpose — re-importing a backup
  re-links pairs that already exist and that has to be a no-op.
- Supabase errors are logged server-side with the route name. The UI only has
  one generic "не могу да сачувам" banner, so **the server log is the only real
  diagnostic** — check `docker logs srb-cards-dev` when something will not save.
- Import (`importWords` in `App.jsx`) still runs its three passes in the
  browser, calling the API per word. Fine because imports are rare; a bulk
  `POST /api/import` is the obvious follow-up if it ever feels slow.

## Running the release version in Docker

The root `Dockerfile`'s last stage builds one image that contains everything:
Vite builds the site, and the Express backend serves those files itself, next to
`/api`. So the site and the API answer on the same port, and the browser keeps
calling `/api` with relative addresses — `VITE_API_URL` is not needed.

Nothing is baked in at build time. All settings are handed to the container when
it starts:

```
docker build -t srb-cards .
docker run --rm --name srb-cards-prod \
  --env-file .env -p 127.0.0.1:3000:3000 srb-cards
# http://localhost:3000
```

- **The port is 3000 everywhere** — that is what `.env` says and what the
  backend defaults to, so `--env-file .env` on its own is enough and there is
  nothing to override. The image deliberately does *not* set its own `PORT`: a
  `PORT` coming from the environment always wins over one set in the Dockerfile,
  so a different default there would leave the app listening on a port nothing
  talks to. That mismatch is what makes a proxy in front of the container answer
  `502 Bad Gateway`.
- A host that supplies its own `PORT` is honoured automatically — the backend
  reads it and binds `0.0.0.0`.
- The ports are published on **`127.0.0.1` only**, for the same reason as in
  development: this container holds the `service_role` key and has no login, so
  it must not be reachable from outside the machine. Do not publish it on a
  public address until there is auth in front of it.
- Logs: `docker logs srb-cards-prod`.

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
  that trade-off. Note the backend's `service_role` key bypasses RLS entirely,
  so those policies now only matter to `main` (which still uses the anon key
  from the browser) — keep them until this branch is merged and hosted.

Schema changes ship as raw SQL Kira runs herself in Supabase's SQL Editor —
there's no migration tool/history. When adding a column or table, give her
the exact SQL, prefer `if not exists` so it's safe to re-run.

## Key conventions in `App.jsx`

- **Serbian script**: stored in whichever script was typed; the *other*
  script is derived on the fly via `cyrillicToLatin`/`latinToCyrillic`
  (deterministic, not stored). `otherScript(sr)` picks the right direction.
  Answer-checking accepts either script for sr answers.
- **Case**: `sr` and `ru` are lowercased on save so e.g. "Blag"/"blag" collapse
  to one entry — this now happens on the server (`cleanWordFields` in
  `backend/src/http.js`), not in the browser. `example` is *not* lowercased
  (it's a full sentence) —
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

## External APIs in use (all best-effort, still called from the browser)

These deliberately did **not** move behind the backend: they have nothing to do
with the database, and the two Wiktionary helpers parse HTML with `DOMParser`,
which needs a browser. Worth revisiting later — Tatoeba and Glosbe are
unofficial endpoints that may be CORS-blocked in the browser today, and a server
would not be.

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

# Serbian Cards — project context

A personal Serbian↔Russian vocabulary flashcard app. Kira is learning Serbian;
this app stores her vocabulary and quizzes her on it.

## Stack

- React (single-file component tree in `src/App.jsx`), built with Vite
- Styling: inline styles + Tailwind utility classes (no custom Tailwind config)
- Backend: Node + Express in `backend/`, talks to Supabase with
  `@supabase/supabase-js`. The browser never touches the database directly for
  data — it calls `/api/*` through `src/api.js`. It does talk to Supabase Auth
  directly, for sign-in only (`src/supabaseClient.js`).
- Data: Supabase (Postgres), with row-level security enforcing per-user
  isolation — see "Auth and per-user data" below.
- Hosting: production is **https://srb.cloudopen.space/** — the backend
  refactor is merged into `main` and that's what's running there. Deploy is
  **manual**: pushing to `main` does not auto-deploy anything. There is no
  Netlify deploy anymore.

There is one `Dockerfile`, at the repo root, covering both ways of running the
app: `--target dev` builds the development image (what `run_dev.sh` uses), and
the plain build produces the release image — built site plus API in one
container, see "Running the release version in Docker" below.

### Auth and per-user data

Real accounts now, via Supabase Auth (email + password) — not the old single
shared household password. Each user's words/tags are their own, enforced at
the database level by row-level security (RLS), not just by app-code
filtering (see "Database schema" below for the actual policies).

- **Invite-only, no self-service sign-up.** Kira creates every account herself
  in the Supabase Dashboard (Authentication → Users → Add User, auto-confirm
  checked) and relays the initial password to that person directly — there's
  no sign-up UI. Locked-out users use "Заборављена лозинка?" on the login
  form: Supabase's built-in email sender mails a link (`resetPasswordForEmail`,
  `redirectTo` = the site's own address, which must be listed under Supabase →
  Authentication → URL Configuration → Redirect URLs), and following it lands
  on `NewPasswordGate` in `App.jsx` (flagged by the `PASSWORD_RECOVERY` event
  or `type=recovery` in the address) to pick a new password. The built-in
  sender only allows a few emails per hour.
- **`backend/src/auth.js`**'s `requireAuth` middleware reads the
  `Authorization: Bearer <token>` header the frontend sends, and builds a
  **fresh Supabase client per request** using the `anon` key with that token
  attached (`req.supabase`). That's what makes RLS evaluate as *that specific
  user* rather than as an admin key — every route handler queries through
  `req.supabase`, not a shared client, and needs no manual `.eq('user_id', …)`
  filtering because RLS already scopes what's visible. `req.userId` is also
  set, for the few inserts that must stamp `user_id` explicitly (see schema
  section — it's not a DB default).
  - Gotcha worth knowing if this code gets touched again: verifying the token
    requires `userClient.auth.getUser(token)` with the token passed
    explicitly. Calling `getUser()` with no argument reads the client's own
    internal session state, which a freshly-built per-request client never
    has — every request would 401.
- **`src/supabaseClient.js`** builds a browser Supabase client (`getSupabase()`,
  created once after fetching the URL and anon key from `/api/config`) used
  *only* for auth (`signInWithPassword`, `signOut`, `getSession`,
  `onAuthStateChange`) — not for data. The app still calls its own Express
  backend for every data operation via `src/api.js`, which reads
  `supabase.auth.getSession()` fresh on every request and sends the
  session's access token as the `Authorization` header.
- The `anon` key (`SUPABASE_ANON_KEY`, also served to the browser through
  `GET /api/config`) is the one Supabase key that's *designed* to be public —
  RLS is what actually protects the data, not secrecy of this key. There is
  no `service_role` key anywhere in this app anymore (it bypassed RLS
  entirely, which is exactly the opposite of what per-user isolation needs);
  don't reintroduce one.

Keep the ports bound to localhost in Docker regardless — which is why
`run_dev.sh` publishes them on `127.0.0.1` only — this app still has no
public-facing rate-limiting or abuse protection.

## Local dev

Everything runs in one Docker container — the Vite dev server and the API side
by side, with this folder mounted inside so edits are live:

```
cp .env.example .env   # fill in the Supabase URL + anon key
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

**By default, local dev hits the real production Supabase database** — test
data really gets saved there. For anything risky (isolation tests, imports,
schema experiments) use the separate test project instead:

```
./run_dev.sh --test    # uses .env.test (a second Supabase project) — prints a TEST banner
./run_dev.sh           # back to the real one (.env); the two never run together
```

`.env.test` has the same five settings as `.env`, pointing at the test project
(both files are gitignored). `supabase/schema.sql` builds the whole schema in a
fresh project — **keep it in step with any schema change to production**, and
run each schema change in both projects. Test accounts are created by hand in
the test project's dashboard, like real ones.

Running without Docker also works (`npm install && npm run dev` plus
`cd backend && npm install && npm start`), but the backend **requires Node 22+** —
`@supabase/supabase-js` crashes on boot under Node 20 for want of a native
`WebSocket`. The container pins `node:22-alpine`, so `./run_dev.sh` is the path
that always works.

Deploy to production (https://srb.cloudopen.space/) is a **manual step Kira
does herself** — pushing to `main` does not trigger anything automatically.
Don't tell her a merge is "live"; it's live once she's deployed it. See
"Running the release version in Docker" below for the release build itself —
that's the image that ends up running in production.

## The API

`src/api.js` (browser) → `/api/*` → `backend/src/routes/*` → Supabase. In dev
the frontend uses relative URLs and Vite proxies `/api` to port 3000
(`vite.config.js`). The production build doesn't need `VITE_API_URL` either —
the release container serves the site and the API from the same origin (see
"Running the release version in Docker" below) — it exists only for the case
of running the frontend and backend on genuinely separate hosts.

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
| `GET /api/config` | Public Supabase URL + anon key for the browser's sign-in (no login needed) |

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

Nothing is configured at build time. All settings are handed to the container
when it starts. The browser gets the public Supabase URL and anon key from the
backend's `/api/config` route at run time (`src/supabaseClient.js`), so no
`VITE_SUPABASE_*` values or build arguments are needed — an earlier version
baked them in through build args, and the hosting panel's build failed:

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
  development: there's no rate-limiting or abuse protection in front of
  Supabase Auth yet, so it must not be reachable from outside the machine.
  Do not publish it on a public address without adding that first.
- Logs: `docker logs srb-cards-prod`.

## Database schema (Supabase, all in `public` schema)

- **words**: `id uuid pk`, `user_id uuid` (fk → `auth.users`, cascade delete —
  owner; **not null**, but see the migration note below if this ever needs
  touching again), `sr text`, `ru text` (comma-separated accepted translation
  variants), `example text` (nullable, Serbian-only usage example),
  `correct_count int default 0`, `wrong_count int default 0`,
  `created_at timestamptz`
- **word_links**: `word_id`, `related_word_id` (both fk → words, cascade
  delete) — symmetric relation for linking same-root words (e.g. verb ↔
  noun); both directions are inserted on link. No `user_id` column here —
  ownership is derived from the `words` rows it references (see RLS below).
- **tags** / **word_tags**: many-to-many tagging, same cascade-delete pattern.
  `tags` also has `user_id` (same shape as `words`). Its unique index is on
  `(user_id, lower(name))`, not just `lower(name))` — tags are per-user now, so
  two users can each have their own "храна" tag. `ensureTag`
  (`backend/src/tags.js`) relies on this to make its select-then-insert-
  with-retry-on-conflict race-free, scoped to the caller's own tags via
  `req.supabase`. `word_tags` has no `user_id` column either, same reasoning
  as `word_links`.
- **`increment_word_answer(p_word_id uuid, p_field text)`**: Postgres function,
  atomically increments `correct_count` or `wrong_count` and returns the new
  values — used by `POST /api/words/:id/answer` instead of a read-then-write,
  which could lose an increment between two rapid requests for the same word.
  It's `SECURITY INVOKER` (Postgres's default), so RLS on `words` applies to
  its internal `UPDATE` automatically — calling it for someone else's word id
  affects 0 rows rather than needing its own ownership check.
- **Row-level security is what actually enforces per-user isolation** — the
  backend has no `service_role` key to bypass it with anymore, so these
  policies are load-bearing, not just a floor:
  - `words` / `tags`: `for all using (user_id = auth.uid()) with check
    (user_id = auth.uid())` — straightforward own-row-only.
  - `word_links` / `word_tags`: ownership is checked via an `exists` subquery
    against the row(s) they reference (`words`/`tags`), *not* a `user_id`
    column on the join table itself — a naive `user_id = auth.uid()` policy on
    a join table only validates the join row's own owner, not that the
    `word_id`/`tag_id` it points at actually belongs to that user, which
    would let someone link/tag using another user's id.
  - The original open policies (each named `public access`, `using (true)`)
    must be **dropped** on all four tables. Postgres ORs permissive policies
    together, so leaving one in place makes every user see everyone's data —
    this happened during the first local test.
  - Any new table needs RLS enabled with a real per-owner policy following
    one of these two patterns — never the old open `using (true)` pattern,
    that only made sense back when a bypassing `service_role` key was the
    only thing touching the tables.
- **Inserts set `user_id` explicitly in application code** (`backend/src/routes/words.js`'s
  `POST /`, `backend/src/tags.js`'s `ensureTag`) — there is deliberately no
  `default auth.uid()` on the column. A default would resolve to `NULL` for
  any request not carrying a real user JWT, and during the migration to this
  auth model the still-live old app *was* such a request (it inserted via
  `service_role`, which has no `sub` claim) — a `NOT NULL` column with that
  default would have broken it instantly. Keep setting `user_id` explicitly on
  insert rather than reintroducing a default.

Schema changes ship as raw SQL Kira runs herself in Supabase's SQL Editor —
there's no migration tool/history. When adding a column or table, give her
the exact SQL, prefer `if not exists` so it's safe to re-run, and update
`supabase/schema.sql` (the from-scratch version used for the test database)
in the same change.

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

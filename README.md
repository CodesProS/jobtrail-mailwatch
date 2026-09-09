# JobTrail Mailwatch 📬

A standalone sidecar for [JobTrail](../JobTrail). It watches your Gmail for
application updates (rejections, interview invites, OAs, offers), guesses which
application each email is about, and drops it into a **review queue**. You
approve each one; only then does it call JobTrail's API to change the status.

**JobTrail itself is never modified.** This service only talks to JobTrail over
its public API (`POST /auth/login`, `GET /jobs`, `PATCH /jobs/:id`).

```
Gmail  ──▶  /sync (cron)  ──▶  classify (Groq)  ──▶  match to your apps
                                                        │
                                                        ▼
                                              mw_detections  (queue)
                                                        │
                                          you click "Confirm" in /review
                                                        │
                                                        ▼
                                        JobTrail  PATCH /jobs/:id  { status }
```

## What it does / doesn't do

- ✅ Read-only Gmail access (`gmail.readonly`).
- ✅ Nothing hits JobTrail until you confirm it in the UI.
- ✅ Shared DB safe — every table is prefixed `mw_`, so `DATABASE_URL` can point
  at the same Supabase database JobTrail uses.
- ❌ No auto-apply, no write-back to Gmail, no labels.

---

## Setup

### 1. Database

Point `DATABASE_URL` at any Postgres (a new Supabase project, or JobTrail's
existing one — the `mw_` prefix keeps them separate). Then:

```bash
npm install
cp .env.example .env      # fill it in (see below)
npm run db:migrate
```

### 2. Google OAuth client (free, no verification)

1. [console.cloud.google.com](https://console.cloud.google.com) → new project.
2. **APIs & Services → Enable APIs → Gmail API** → Enable.
3. **OAuth consent screen** → External → fill required fields → **Add yourself
   as a Test user**. Leave it in "Testing" mode (no verification, no fee).
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   - Authorised redirect URI: `<PUBLIC_URL>/oauth/callback`
     (e.g. `https://jobtrail-mailwatch.onrender.com/oauth/callback`, and
     `http://localhost:3000/oauth/callback` for local dev).
5. Copy the client ID + secret into `.env`.

`gmail.readonly` is a *restricted* scope. In Testing mode with you as a test
user it works forever, for free. Publishing to other users would require an
annual third-party security assessment — not needed for personal use.

### 3. Fill `.env`

| var | what |
|---|---|
| `PUBLIC_URL` | the deployed origin (no trailing slash) |
| `DATABASE_URL` | Postgres connection string |
| `ENC_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GROQ_API_KEY` | reuse JobTrail's, or make another (free) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from step 2 |
| `JOBTRAIL_API_URL` | `https://jobtrail-en88.onrender.com` |
| `SYNC_SECRET` | random string — gates `POST /sync` |
| `REVIEW_KEY` | random string — gates the `/review` page + setup |
| `GMAIL_QUERY` | Gmail search filter; narrow to `label:jobs` once you have one |

### 4. Run it

```bash
npm run dev          # http://localhost:3000/review?key=<REVIEW_KEY>
```

Then, in the review page:

1. **Connect JobTrail** — enter your JobTrail email + password. Stored
   AES-256-GCM encrypted; used only to mint a login token and read/patch jobs.
2. **Connect Gmail** — click through Google sign-in (you'll see an "unverified
   app" warning — that's expected for a Testing-mode app; continue).
3. **Sync now** — pulls recent mail and populates the queue.

### 5. Deploy (Render, same as JobTrail)

- New **Web Service** from this repo, Docker runtime.
- Add every `.env` var in the Render dashboard. Set `PUBLIC_URL` to the Render
  URL and `NODE_ENV=production`.
- Add that same URL + `/oauth/callback` to the Google client's redirect URIs.
- Run `npm run db:migrate` once (Render Shell, or locally against the prod DB).

### 6. Schedule the sync (free)

GitHub Actions cron is already wired in [`.github/workflows/sync.yml`](.github/workflows/sync.yml).
In the repo settings → **Secrets and variables → Actions**, add:

- `MAILWATCH_URL` = your deployed origin
- `SYNC_SECRET` = same value as `.env`

It fires `POST /sync` every ~15 min. The curl also wakes the Render free
instance, so no separate keep-warm needed.

Alternatives: cron-job.org / UptimeRobot hitting `POST <url>/sync?key=<SYNC_SECRET>`.

---

## How matching works

For each job-related email the classifier returns `{ company, role, event_type,
confidence }`. `event_type` maps to a JobTrail status:

| event_type | status |
|---|---|
| `rejection` | `rejected` |
| `ghosted` | `ghosted` |
| `phone_screen`, `assessment` | `phone_screen` |
| `interview_invite` | `interview` |
| `offer` | `offer` |
| `application_received`, `other` | *(no change)* |

The matcher scores every one of your applications by normalized company-name
similarity (0.7), sender-domain vs job-URL domain (up to +0.35), and role
token overlap (0.15). Best score ≥ 0.30 → **needs review** with that app
pre-selected; below that → **no match** (still listed, pick the app manually).
A backwards move (e.g. an "applied" ack arriving after you're at "interview")
is flagged but not blocked — you decide.

Idempotent: every Gmail message id is stored once (`mw_detections.gmail_msg_id`
is `UNIQUE`), so overlapping scans are harmless.

---

## Endpoints

| method | path | auth | purpose |
|---|---|---|---|
| GET | `/review?key=` | REVIEW_KEY | the UI |
| GET | `/oauth/start?key=` | REVIEW_KEY | begin Gmail connect |
| GET | `/oauth/callback` | signed state | Google redirect target |
| POST | `/sync` | `X-Sync-Secret` | run one poll (cron) |
| POST | `/review/setup/jobtrail` | REVIEW_KEY | store JobTrail creds |
| POST | `/review/api/detections/:id/confirm` | REVIEW_KEY | push status to JobTrail |
| POST | `/review/api/detections/:id/dismiss` | REVIEW_KEY | drop a detection |

## Files

```
server.js
scripts/migrate.js          mw_config + mw_detections
scripts/sync-once.js         `npm run sync` — one pass from the CLI
src/services/gmail.js        OAuth + message fetch/parse (raw REST)
src/services/classifier.js   Groq classification + status map
src/services/matcher.js      email ↔ application scoring
src/services/jobtrail.js     JobTrail API client (login/list/patch)
src/core/sync.js             the pipeline
src/routes/{oauth,sync,review}.js
src/routes/reviewPage.js     the review UI (one HTML string)
```

## Security notes

- `ENC_KEY` encrypts the Gmail refresh token and your JobTrail password at rest.
  Lose it → reconnect both. Rotate → re-enter both.
- Storing a JobTrail password is a personal-use shortcut (JobTrail has no API
  keys). If this ever goes multi-user, add token-based auth to JobTrail instead.
- Email subject + snippet + classifier JSON are stored; full bodies are not.
- Email text is sent to Groq for classification.

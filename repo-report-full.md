# galaxymap_ytp_v2 Repository Report

Generated: 2026-06-10 07:52 KST  
Scope: full repository, local `main`, operational readiness  
Evidence standard: repository files, Git history, automated checks, local HTTP/runtime probes

## 1. Executive Conclusion

`galaxymap_ytp_v2` is a coherent Phase 2 application with the intended topology already reflected in code:

- Next.js runs the authenticated web UI and API routes.
- Supabase provides DB, Auth, RLS, and job state.
- Mac Studio workers own yt-dlp, ffmpeg, and Remotion processing.
- Cloudflare R2 is the canonical store for ingested source video.

The current code baseline is healthy: 78 TypeScript tests, 13 Python worker tests, type-check, and production build all pass. Authentication, UID-based ownership checks, worker reliability primitives, and R2 source integration have targeted test coverage.

The repository is not operationally release-ready yet. The primary blocker is confirmed R2 authorization failure (`403 AccessDenied`). End-to-end acceptance for ingest, presigned playback, cross-user isolation, worker reaping, and render completion is therefore incomplete. Code quality is ahead of infrastructure readiness.

The local `main` branch is clean before this report, two commits ahead of `origin/main`, and has no release tags. No CI workflow exists, so the passing verification state is not automatically enforced after push.

## 2. Repository State

| Item | Current state |
|---|---|
| Repository | `galaxymap_ytp_v2` |
| Root | `/Users/issacbae/Desktop/vc/galaxymap_ytp_v2` |
| Branch | `main` |
| Remote | `https://github.com/kebeesoul/galaxymap_ytp_v2.git` |
| Local/remote relation | 2 commits ahead, 0 behind |
| Latest commit | `51bcefb7b2e1e0b677b3f30219cfbad0d412243d` |
| Latest commit date | 2026-06-09 00:52:00 KST |
| Latest commit subject | `feat: migrate source storage to Cloudflare R2` |
| Commit count | 124 |
| Tracked files | 186 |
| Tags/releases | None |
| Package manager | pnpm 10.x |
| Node target | Node.js 20 |
| Working tree before report | Clean |
| Working tree after report | New untracked `repo-report-full.md` only |

### Maintenance signal

Development is active and concentrated around authentication, workflow restructuring, worker reliability, navigation cleanup, and R2 migration. The latest two commits are substantial infrastructure changes rather than isolated UI work.

There is no formal release boundary. The absence of tags, CI, and operational acceptance records makes commit hashes the only reliable deployment reference.

## 3. Product Purpose and Direction

### Verified purpose

The product turns a YouTube source into curated or summarized short-form video:

1. A curator reviews recommended tracks.
2. A user selects a YouTube source and creates an import project.
3. A local ingest worker downloads and stores the source.
4. The editor applies subtitles, comments, BGM, black bars, and free-text overlays.
5. A local render worker produces the final video.
6. The user reviews and exports results from History.

The primary menu is:

- Curation
- Select
- Editor
- History

### User and ownership model

The repository implements multiple independent authenticated operators. Each user owns separate projects and R2 objects through Supabase Auth UID and RLS. Simultaneous collaborative editing of the same project is explicitly out of scope.

### Product direction

The current direction is operational hardening rather than feature expansion:

- replace legacy Supabase source storage with R2;
- make long-running local workers observable and recoverable;
- preserve per-user ownership through every storage boundary;
- keep heavy media workloads off Railway;
- align editor preview and Remotion output.

## 4. Architecture

### System topology

| Boundary | Responsibility | Runtime |
|---|---|---|
| Next.js application | Authenticated UI, API routes, job creation, status display, presigned URL issuance | Railway / local dev |
| Supabase | Postgres, Auth, RLS, project and job state | Managed external service |
| Ingest worker | Claim imports, yt-dlp download, source upload, heartbeat, self-heal | Mac Studio, Python |
| Render worker | Claim render jobs, fetch source, invoke Remotion, upload output | Mac Studio, Node |
| Cloudflare R2 | Canonical ingested source objects | Managed external service |
| Local storage | Temporary media-processing scratch space | Mac Studio |
| Supabase Storage | BGM and rendered output during the current partial migration | Managed external service |

### Core boundaries

The topology is intentionally split:

- Railway must not execute yt-dlp, ffmpeg, Remotion, or large media transformations.
- Workers read and update queue state through Supabase.
- File bytes do not belong in Postgres.
- Source objects use `{owner_uid}/` as their mandatory R2 key prefix.
- Browser access to source media is mediated by a short-lived server-generated URL.
- Local paths are environment-driven through `STORAGE_ROOT`; public code must not contain user-specific absolute paths.

### Primary entry points

| Area | Important paths |
|---|---|
| Root application | `app/layout.tsx`, `app/page.tsx` |
| Authentication | `middleware.ts`, `app/login`, `lib/supabase/server.ts`, `lib/supabase/client.ts` |
| Navigation | `components/AppNav.tsx` |
| Curation | `app/curation` |
| Project selection/import | `app/select`, `app/api/import/route.ts` |
| Editor | `app/editor`, `components/video-editor` |
| Render API | `app/api/render/route.ts` |
| Browser source URL | `app/api/source-url/route.ts` |
| Ingest worker | `workers/ingest/worker.py` |
| Render worker | `workers/render` |
| Remotion composition | `remotion` |
| Database baseline | `supabase/migrations/00000000000000_init_baseline.sql` |
| Canonical specification | `PROJECT_SPEC.md` |
| Operations | `OPERATIONS.md` |
| UI rules | `DESIGN.md` |

## 5. Main Data and Job Flows

### Import flow

1. The authenticated user creates a `projects` row with `import_status='pending'`.
2. The ingest worker atomically claims a pending row and records `processing_started_at`.
3. yt-dlp downloads the selected source into local scratch storage.
4. The worker uploads the source to R2 using a key shaped like `{owner_uid}/sources/...`.
5. Only the relative object key is stored in `projects.yt_source_path`.
6. The worker removes the local source after successful upload.
7. The project transitions to a terminal success or failure state.

The Python R2 client uses:

- `region_name="auto"`
- `request_checksum_calculation="when_required"`
- `response_checksum_validation="when_required"`

These settings are required for current boto3/botocore compatibility with R2.

### Browser preview flow

1. The editor requests `GET /api/source-url?project_id=<uuid>`.
2. Zod validates the project ID.
3. Supabase validates the session and retrieves the project through RLS.
4. The route checks both `owner_uid` and the R2 key UID prefix.
5. A one-hour presigned GET URL is returned.

The explicit key-prefix check is a second authorization boundary in addition to RLS.

### Render flow

1. The user queues a clip for rendering.
2. The render worker claims the job.
3. The source object is downloaded directly from R2 to local scratch storage.
4. Remotion renders the final composition.
5. The current implementation uploads rendered output to Supabase Storage.
6. Job status and output path are written back to Supabase.

This is a partial R2 migration: source is on R2, while BGM and final render output remain on Supabase Storage.

### Worker reliability flow

The ingest worker implements:

- atomic pending-to-processing claims;
- `processing_started_at` recording;
- a heartbeat upsert to `worker_health` every 30 seconds;
- startup self-healing for stale processing jobs;
- compatibility with the database-side stale-job reaper.

The UI exposes failed state, detailed error state, retry controls, queued progress, and worker-offline status.

## 6. Technical Implementation

### Main stack

| Layer | Technology |
|---|---|
| Web | Next.js 14.2.x, React, TypeScript strict mode |
| Styling | Tailwind CSS 3.4 |
| Database/Auth | Supabase |
| Source object storage | Cloudflare R2, S3-compatible API |
| Browser signing | AWS SDK v3 S3 client and presigner |
| Ingest | Python 3.11, yt-dlp, boto3 |
| Rendering | Remotion, ffmpeg, Node worker |
| Validation | Zod at selected external boundaries |
| Tests | Vitest and Python unittest |
| Deployment | Railway for web, Mac Studio for workers |

### Repository composition

| Directory | Tracked files | Purpose |
|---|---:|---|
| `app` | 39 | Next.js pages and API routes |
| `lib` | 30 | Shared clients, validation, storage, and domain helpers |
| `supabase` | 28 | Baseline and archived migrations |
| `__tests__` | 17 | TypeScript regression tests |
| `components` | 16 | Shared and editor UI |
| `workers` | 16 | Ingest and render workers |
| `remotion` | 13 | Render composition and visual layers |
| `public` | 4 | Static assets |
| `docs` | 2 | Reliability and R2 migration specifications |

Language distribution is dominated by TypeScript, followed by SQL and Python. This matches the web/control-plane plus local-worker architecture.

### Database model

The repository uses one active baseline migration:

- `supabase/migrations/00000000000000_init_baseline.sql`

Legacy migrations are retained under:

- `supabase/migrations/_archived_legacy/`

Key model areas include projects, clips, templates, tone presets, overlays, render state, worker health, ownership, and job timestamps. RLS and `owner_uid` are central invariants.

### Authentication and authorization

Verified controls include:

- email/password login without public signup UI;
- cookie-backed server sessions;
- protected workflow routes through middleware;
- service-role code separated from browser clients;
- RLS-oriented queries;
- explicit project ownership checks;
- explicit R2 object-prefix ownership checks;
- server-only R2 credentials;
- no production secrets committed in source.

### UI implementation

The root layout owns the single `AppNav`. Pages do not duplicate it. Protected pages use the four-item workflow structure, and the worker-offline banner is mounted globally.

The editor includes Remotion-backed preview behavior, subtitle editing, comments, free-text overlays, waveform-related controls, black-bar support, and render queue controls. UI and render layers share important overlay definitions to reduce preview/output drift.

## 7. Verification Results

All commands below were run on local `main` on June 10, 2026.

| Check | Result |
|---|---|
| `pnpm test` | Passed: 17 files, 78 tests |
| `pnpm type-check` | Passed |
| `pyenv exec python -m unittest test_worker.py test_storage.py` | Passed: 13 tests |
| `pnpm build` | Passed |
| `/api/health` | HTTP 200, `{"ok":true}` |
| `/login` | HTTP 200 |
| Protected routes unauthenticated | HTTP 307 to `/login` |
| Invalid source URL project ID | HTTP 400 |
| Valid source URL request without auth | HTTP 401 |

### Build warnings

The production build passes with non-blocking warnings:

1. Direct `<img>` usage in export, project-list, and video-preview components.
2. An effect cleanup reference warning in `ClipEditor.tsx`.
3. A missing effect dependency warning in `WaveformEditor.tsx`.
4. The Curator provider migration was pending at report generation time; it was subsequently completed with Gemini 2.5 Flash Lite.

These warnings do not currently break compilation, but the React effect warnings are plausible sources of stale state or cleanup defects.

### Local server state

Port 3000 was occupied by a different repository (`g-ytp-v1`). This repository was therefore verified at:

- `http://127.0.0.1:3001`

The server remained running after the probes. No server-side errors appeared in the inspected logs.

Current visual browser automation was unavailable, so this report does not claim a fresh pixel-level or interaction-level editor verification.

## 8. Latest Commit Analysis

### `51bcefb7` - `feat: migrate source storage to Cloudflare R2`

The latest commit changes 20 files with 932 insertions and 144 deletions. Its main behavior:

- replaces Supabase Storage source uploads with boto3 R2 uploads;
- changes render-source reads to direct R2 downloads;
- introduces `/api/source-url` for one-hour presigned browser reads;
- enforces session UID and object-key prefix isolation;
- applies required R2 checksum compatibility settings;
- updates tests, dependencies, and project documentation.

This commit is architecturally aligned with the repository specification. Its unresolved risk is environmental rather than an observed unit-level code failure: the configured R2 credentials currently receive `403 AccessDenied`.

### `afcc852e` - Lane B reliability

The preceding commit implements:

- processing start timestamps;
- worker heartbeat upserts;
- startup self-healing;
- failed-state and retry UI;
- worker-offline UI;
- related specification synchronization.

Together, the two commits form the current Gate 2 reliability and source-storage baseline. Both are local-only because `main` is two commits ahead of `origin/main`.

## 9. Recent Development Direction

Recent Git history shows six connected workstreams:

1. Baseline database and authenticated ownership model.
2. Four-stage workflow navigation.
3. Curation-to-selection handoff and YouTube source accuracy.
4. Ingest state visibility and error classification.
5. Editor/render overlay features and preview parity.
6. Worker reliability and R2 source migration.

The repository has moved from feature assembly toward production constraints: ownership, recovery, worker observability, storage isolation, and operational topology.

## 10. GitHub Status

GitHub issue and pull-request state could not be verified.

Evidence:

- GitHub CLI authentication reports an invalid token for the configured account.
- GitHub API access failed during collection.

Therefore:

| Area | Status |
|---|---|
| Open issues | Not verified |
| Open pull requests | Not verified |
| Draft pull requests | Not verified |
| CI status | No local workflow definitions found |
| Remote branch contents | Local Git reports `main` ahead by 2, behind by 0 |

No issue or PR conclusions should be drawn until `gh auth login -h github.com` succeeds and the remote is queried again.

## 11. Confirmed Risks and Gaps

### Critical: R2 authorization blocks the source pipeline

Current R2 probes return `403 AccessDenied`, including bucket access. Until bucket, account ID, endpoint, and token permissions are corrected, the source ingest and preview flow cannot complete end to end.

Impact:

- new source uploads fail;
- presigned URLs may be generated but cannot serve an absent or inaccessible object;
- render workers cannot retrieve new source objects;
- Gate 2 operational acceptance cannot complete.

### High: operational acceptance remains incomplete

The following scenarios have code and targeted tests but still require live verification:

- ingesting a 1080p source larger than 50 MB;
- confirming the R2 object and database key;
- authenticated editor playback through a presigned URL;
- cross-UID source access returning 403;
- worker kill, heartbeat expiry, database reaper, and startup self-heal;
- complete render from an R2 source.

### High: source deletion can leave R2 orphan objects

Source creation and reads have migrated to R2, but deletion and orphan cleanup are not yet fully migrated. Project deletion may remove the database row without deleting the corresponding R2 source.

This area is especially sensitive because project/render deletion has a history of regressions and must be handled with a regression-first change.

### Medium: storage topology is intentionally incomplete

Current storage is split:

- source: R2;
- BGM: Supabase Storage;
- render output: Supabase Storage;
- scratch: local Mac storage.

This is valid as an intermediate stage but increases operational complexity and cleanup surface.

### Medium: operational documentation has drift

At report generation time, `OPERATIONS.md` contained stale Supabase Storage source assumptions. This was corrected in the subsequent documentation synchronization.

The specification filename is now consistently referenced as the tracked `PROJECT_SPEC.md`.

### Medium: no automated CI gate

There are strong local checks but no committed CI workflow. A push can regress tests, type safety, build output, or Python workers without an automatic block.

### Medium: selected API boundaries do not consistently use Zod

The source URL route validates with Zod, but some import/render request parsing still relies on TypeScript casts. This conflicts with the repository convention that external boundaries use runtime schemas.

### Low: build warnings remain

The React effect warnings deserve targeted review because they concern dependency and cleanup semantics. The direct image warnings are primarily optimization debt.

### Low: curator provider drift

Resolved after report generation: the Curator now uses Gemini 2.5 Flash Lite exclusively, and Anthropic dependencies and key checks have been removed.

### Low: no release tags

Without tags, there is no stable mapping between a deployed environment and a named release.

## 12. Inferred or Unverified Areas

The following are not confirmed defects:

- editor WYSIWYG pixel parity under every overlay combination;
- actual Railway environment-variable completeness;
- Mac Studio architecture and ffmpeg consistency;
- production RLS behavior beyond the tested query paths;
- browser memory behavior on long high-resolution previews;
- whether legacy render helpers are still required;
- current remote GitHub issue and PR priorities.

These require runtime, deployment, or ownership context not available from local static inspection alone.

## 13. Decision Points

### R2 recovery

A option - correct the current bucket/token/account permissions.

- Advantage: preserves the approved architecture and existing code.
- Risk: requires Cloudflare dashboard access and careful token scope verification.

B option - temporarily restore source storage to Supabase.

- Advantage: may restore a previously working path quickly.
- Risk: reverses the current architecture, duplicates migration work, and creates specification drift.

Recommendation: A. The code and specification consistently select R2; the failure is currently an external authorization problem.

### Remaining storage migration

A option - stabilize source R2 acceptance first, then migrate BGM/output/deletion separately.

- Advantage: smaller blast radius and clearer fault isolation.
- Risk: temporary dual-storage operations continue.

B option - immediately move every media object and deletion path to R2.

- Advantage: reaches the final topology sooner.
- Risk: combines ingest, render, cleanup, and deletion regressions in one change.

Recommendation: A. Complete and record source acceptance before expanding the migration.

### CI enforcement

A option - continue manual local verification.

- Advantage: no setup work.
- Risk: passing checks are not enforced on every push or pull request.

B option - add a minimal pnpm and Python GitHub Actions workflow.

- Advantage: protects the current 91-test baseline, type-check, and build.
- Risk: requires GitHub authentication and runner/environment decisions.

Recommendation: B after GitHub access is restored.

## 14. Recommended Execution Order

### Immediate

1. Fix Cloudflare R2 credentials and bucket permissions.
2. Re-run `HeadBucket`, upload, download, and delete probes using a disposable UID-prefixed object.
3. Execute one complete ingest and confirm DB state, R2 key, local scratch cleanup, and editor playback.
4. Verify cross-UID access is rejected by `/api/source-url`.
5. Push the two local commits only after the operational evidence is recorded.

### Next

1. Run worker heartbeat, forced termination, reaper, and restart self-heal acceptance.
2. Render one clip from an R2 source and confirm output/history behavior.
3. Synchronize `OPERATIONS.md` with the actual source R2 topology.
4. Add regression coverage before implementing R2 source deletion and orphan cleanup.
5. Resolve the two React effect warnings.

### Later

1. Decide and execute the BGM/render-output R2 migration as a separate change.
2. Add CI for pnpm tests, type-check, build, and Python tests.
3. Complete the Gemini curator migration or remove stale provider code.
4. Add release tags and a deployment-to-commit record.

## 15. Delivery Assessment

| Dimension | Assessment |
|---|---|
| Product structure | Strong |
| Architectural consistency | Strong in current code |
| Automated local verification | Strong |
| Authentication and ownership | Strong, with live cross-user acceptance pending |
| Worker reliability | Implemented, live failure recovery pending |
| Storage readiness | Blocked by R2 authorization |
| Operational documentation | Partially stale |
| CI/release discipline | Weak |
| Production readiness | Not ready until R2 and Gate 2 acceptance pass |

## 16. Evidence Inventory

### Files reviewed

- `AGENTS.md`
- `CLAUDE.md`
- `PROJECT_SPEC.md`
- `OPERATIONS.md`
- `DESIGN.md`
- `docs/specs/GV2_ROADMAP_R2_RELIABILITY_PHASE7.md`
- `docs/specs/R2_MIGRATION_SPEC.md`
- `package.json`
- `railway.json`
- `docker-compose.yml`
- authentication, import, render, source URL, navigation, worker, editor, Remotion, and test files

### Commands and probes

- repository context collector in full mode;
- Git status, branch divergence, recent log, commit statistics, and tag inspection;
- `pnpm test`;
- `pnpm type-check`;
- `pnpm build`;
- Python worker unit tests;
- local HTTP checks for login, protected routes, health, and source URL validation;
- R2 bucket-access probe;
- GitHub CLI authentication and issue/PR access checks.

### Verification boundary

This report distinguishes:

- **verified**: directly observed in code, Git, tests, build, or HTTP output;
- **inferred**: supported by architecture and implementation but not exercised end to end;
- **unverified**: requires external credentials, browser state, deployed infrastructure, or GitHub access.

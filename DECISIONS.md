# Decisions

Choices made without asking, with the reason. Newest concerns last.

## Naming and scope

- **Renamed "LocalHook AI" to "Callback Forensics"** mid-build (per instruction): binary `cbf` (alias `callback-forensics`), packages `@cbf/*`, config `~/.cbf`, env `CBF_*`, relay path `/cb/:id/*`. Done as its own commit before the demo/dashboard work.
- **Scope is any inbound callback** (webhooks, OAuth redirects, payment return URLs). The relay and CLI already forward any method; the diagnosis is tuned for JSON webhooks, with four explicit OAuth rules (see README).
- **Repo location:** built in `C:\Users\ADMIN\localhook-ai` (a standalone git repo), not inside the OneDrive-synced `StemHackathon` monorepo. OneDrive syncing `node_modules` and SQLite files is slow and fragile, an earlier commit in that repo moved another project out for the same reason, and the instruction was to `git init` a clean repo. The folder name is a leftover from the first name; the repo can live under any folder name (renaming it was blocked by a file lock during the session).

## Architecture

- **ESM + TypeScript run with tsx**; workspace packages point `main` at `src/index.ts` (no build step). `node --import tsx` is used for child processes and the Docker CMD.
- **`util.parseArgs` instead of commander**: Node built-in, one fewer dependency.
- **Dashboard is one static HTML file** with vanilla JS/CSS, served by the CLI on `127.0.0.1` only. A Host/Origin check blocks cross-site and DNS-rebinding requests to the replay endpoints.
- **Relay semantics:**
  - `delivered=1` means the CLI sent a response; a 25s timeout records status 504 and is not re-flushed; "queued" events (status NULL) are flushed in order on connect.
  - If the socket drops while a request is waiting, the caller gets `202 {queued:true}` and the event is flushed when the CLI reconnects (at-least-once delivery; duplicates are possible and normal for webhooks).
  - Newer WebSocket replaces the older one (close code 4000).
  - `TRUST_PROXY` defaults to `1` for the per-IP tunnel limit; the right value on App Platform is unverified.
- **Raw bytes:** `express.raw({type: () => true})` on the public route; the CLI forwards `Buffer` bodies and rewrites only `Host` and recomputes `Content-Length`.
- **Diagnosis triggers on status >= 400** (the spec said both "4xx/5xx" and ">= 500"; the superset keeps 4xx covered, and the AI step is serialized so a burst of failures cannot hammer the model).
- **Connection failures skip the model** (there is nothing to explain; the rule-based note says the app was unreachable).
- **The AI cache is shared** (`~/.cbf/ai-cache.db`, `CBF_CACHE` overrides) so `demo:warm` can warm it for later runs. It stores only text returned by a model server; failures are never cached. Tests that use a stand-in model server write only to in-memory databases.
- **Prompt determinism:** stack frames are rendered relative to the source root and limited to application frames, so the same failure produces the same prompt (and therefore the same cache key) whether the app runs under `tsx watch` or `tsx`.
- **Local store keeps the last 1000 events**, pruned at startup.

## Demo and eval

- Handlers live in `packages/demo/handlers/` (not `app/`) so the fixed versions in `packages/demo/fixes/` use identical relative imports and can be copied over verbatim. Pristine broken copies are in `packages/demo/broken/` for `npm run demo:reset`.
- The demo app verifies HMAC signatures over the raw body (GitHub/HubSpot-style `X-Hub-Signature-256`, Stripe-style `Stripe-Signature`) but ignores signature timestamps, so replay works at any time. Real Stripe libraries enforce a tolerance (documented as a replay limitation).
- `truth.json` keyword groups were written before any model was run. Groups require the field name and the problem type; synonyms for the problem type (e.g. "missing", "undefined", "absent") are listed up front. They must not be edited to make a model pass.
- Rule-based scoring uses the diff findings plus the parsed error line; it often passes by itself because the diff names the field. That is reported, not hidden.
- `demo:warm` runs the real pipeline in-process (relay, CLI agent, demo app, model) and leaves real answers in the cache. It is a no-op for caching if no model server is running.
- `dev:all` uses a separate `CBF_HOME` (`.cbf-dev/`) and relay database so it never touches a real tunnel configured with `cbf init`. The sender prefers that dev tunnel when its relay is up.

## Optional work

- **`oauth-redirect` scenario: done.** Core rules in `packages/core/src/oauth.ts` (four rules, GET only), a handler, fix, payloads and `truth.json`, unit tests, and README documentation of exactly which rules exist.
- **Graphify:** the `graphify` skill is not installed in this environment, so `/graphify .` was skipped and no `graphify-out/` was committed. The README has a hand-written "Codebase map" instead.

## Things deliberately not done

- No real DigitalOcean deploy, Docker build, GitHub webhook, or `llama-server` run happened in this environment (none was available), so those paths are unverified. See the final summary.
- No pushing: no remote was added and nothing was pushed.

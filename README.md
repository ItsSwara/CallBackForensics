# Callback Forensics

An open-source **callback debugger**. A cloud relay gives you one stable public URL. A small local agent (`cbf`) receives callbacks over a WebSocket tunnel and forwards them to your `localhost` app. A local dashboard shows every request, replays it in one click, and when your app answers 4xx/5xx it explains the bug in plain English, using a **local open-weight model** (llama.cpp's `llama-server`) that reads the real evidence: the payload, a diff against the last good payload, your app's stack trace, and your own source lines around the failure.

> Tunneling is solved. We add a private, local AI that reads the failed request plus your own source code and explains the bug.

**Scope.** Works with any inbound callback. The MVP diagnosis is tuned for JSON webhooks; OAuth diagnosis is limited to the rules listed below.

**Honest privacy statement.** AI analysis runs locally. The relay stores events for 24h with token auth. (Callbacks do pass through the relay to reach your machine, so do not point production secrets at a relay you do not control.)

- Repo: <https://github.com/ItsSwara/CallBackForensics>
- Docs: [WALKTHROUGH.md](WALKTHROUGH.md) (one request, hop by hop) · [DEMO.md](DEMO.md) (3-minute script and judge Q&A) · [DEPLOY.md](DEPLOY.md) · [DECISIONS.md](DECISIONS.md)
- Codebase map: see graphify-out/GRAPH_REPORT.md

## How it compares (honestly)

| Tool | What it does better | What Callback Forensics adds |
|---|---|---|
| **ngrok** | Mature, fast, polished tunnels; custom domains, auth, and a request inspector with replay. | A diagnosis step: it correlates the failed request with your app's stderr and source, and explains the bug with a local model. It is open source and self-hostable, but far less battle-tested. |
| **Cloudflare Tunnel** | Free, very reliable, runs on your own domain, great for exposing real services. | Webhook-specific tooling: event history, one-click replay, payload diff, explanations. Cloudflare Tunnel does none of the inspection. |
| **Hookdeck** | Production-grade hosted webhook infrastructure: retries, queues, filtering, transformations, observability, alerting. | A local-first debugging loop with a model that never leaves your machine, and a code-aware explanation. We do not replace Hookdeck for production delivery guarantees. |
| **Stripe CLI** | First-party, understands Stripe events, signing secrets, and `stripe trigger`. | Works with any sender (GitHub, HubSpot, your own) and explains failures from your code. It does not know provider-specific semantics the way the Stripe CLI does. |

## Architecture

```
 [Sender: GitHub / Stripe / HubSpot / browser redirect / demo sender]
          | POST|GET https://RELAY/cb/:tunnelId/<any path>
          v
 [ Relay  (packages/relay): Express + ws + SQLite ]
          | stores the event, forwards over WebSocket, waits up to 25s for a response
          |   (if the CLI is offline: stores it, answers 202 {queued:true}, flushes on reconnect)
          v   ws://RELAY/tunnel?id=...&token=...
 [ CLI  `cbf start`  (packages/cli) ]  ---- raw bytes, same headers ---->  [ Your app on localhost:PORT ]
          |                                                                   |
          | <------------- status, headers, body, stderr stack trace ----------+
          |
          |  on 4xx/5xx or connection failure:
          |    parseStackTrace -> readSourceContext -> diffPayloads   (core, instant, rule-based)
          |    buildPrompt -> llama-server :8080 /v1/chat/completions (core, async, local model)
          v
 [ Dashboard  http://127.0.0.1:4000 : events, replay, diff, code, explanation (SSE live updates) ]
```

Bodies are forwarded as **raw bytes** (`express.raw`, never re-serialized), so HMAC signature checks (Stripe/GitHub style) still pass.

## Quick start

Requirements: Node 20+. Nothing else, apart from an optional model server.

```bash
git clone https://github.com/ItsSwara/CallBackForensics.git
cd CallBackForensics
npm install
```

### 1. (Optional but recommended) start a local model

```bash
llama-server -m /path/model.gguf --port 8080 -c 4096
```

Without it everything still works; you get the instant rule-based findings and the dashboard says "AI unavailable, showing rule-based findings".

### 2. Run the whole stack locally

```bash
npm run dev:all
```

This starts, with a separate dev tunnel in `.cbf-dev/`:

| Port | What |
|---|---|
| `8090` | local relay (8080 is left free for `llama-server`) |
| `3000` | demo app, run under `tsx watch` so edits hot-reload |
| `4000` | dashboard (`http://127.0.0.1:4000`, loopback only) |
| `8080` | your `llama-server` (started separately) |

In another terminal:

```bash
npm run demo:send -- hubspot-phone good     # 200 through relay -> CLI -> demo app
npm run demo:send -- hubspot-phone bad      # 500, then diagnosis appears in the dashboard
```

### 3. Use it with your own app

```bash
npm run cbf -- init --relay https://YOUR-RELAY          # once: prints your stable public URL
npm run cbf -- start --port 3000 --src . -- npm run dev # run your app under the agent
```

Point the sender at `https://YOUR-RELAY/cb/<id>/your/path`. The URL never changes after `init`. Running your app after `--` lets the agent capture its stderr (stack traces). You can also run your app yourself and use `cbf start --port 3000` for forward-only mode (no stack traces, the dashboard says so).

## CLI

```
cbf init --relay <url> [--force]
cbf start [--port 3000] [--ai-url http://localhost:8080] [--src .] [--dashboard-port 4000] [--no-relay] [-- <app command>]
cbf doctor [--port 3000] [--ai-url http://localhost:8080]
```

`callback-forensics` is installed as an alias of `cbf`. From this repo use `npm run cbf -- <args>`.

| Env var | Used by | Meaning |
|---|---|---|
| `PORT`, `DB_PATH`, `TRUST_PROXY` | relay | listen port, SQLite file (default `./relay.db`), proxy hops |
| `CBF_RELAY` | cli | default for `init --relay` |
| `CBF_AI_URL` | cli, demo | model server (default `http://localhost:8080`) |
| `CBF_HOME` | cli | config + event store dir (default `~/.cbf`) |
| `CBF_CACHE` | cli, demo | AI cache file (default `~/.cbf/ai-cache.db`) |
| `CBF_URL`, `DEMO_SECRET` | demo | public relay URL for the sender; HMAC secret |

Relay limits: 1MB body (413), 60 requests/minute per tunnel (429), 20 tunnels per IP per day, 25s response wait (504), events kept 24h.

## What the diagnosis uses

For every 4xx/5xx or connection failure the agent waits 400ms, takes the app's stderr lines from the request window, and builds:

1. **Rule-based findings (instant):** payload diff against the last 2xx for the same method and path (missing keys, new keys, type changes, fields that became null, empty arrays, with JSON paths; with no earlier success there is nothing to compare, so only empty arrays are flagged and nulls are not listed), the parsed error line, the first non-`node_modules` frame, and the source lines around it (path-traversal safe: it will not read outside `--src`).
2. **AI explanation (local model):** a compact prompt (about 1,500 tokens max) with PAYLOAD, PAYLOAD DIFF, ERROR and FAILING CODE (failing line marked `>>`). Answers are cached in SQLite by `sha256(prompt)`; the cache only ever holds real model output.

Model calls run one at a time. If the model is down or slow, the rule-based part is already on screen.

**Routing problems skip the model.** If the app answers 404 or 405, or a failure leaves no stderr and no stack frame (while the CLI is capturing the app's stderr), the finding is "No route matched <METHOD> <path> on the local app (HTTP <status>). This is a routing problem, not a payload problem. Check the path your provider is calling." and the model is not called. In forward-only mode (no app command) empty stderr proves nothing, so that second condition does not fire.

### OAuth rules (exactly these four)

Applied to GET requests whose query has `error`, `error_description`, `code` or `state`, or whose path contains `oauth`, `callback`, `redirect` or `auth`:

1. `error=<code>` is reported, with a plain-English meaning for the standard codes (`access_denied`, `invalid_request`, `unauthorized_client`, `unsupported_response_type`, `invalid_scope`, `server_error`, `temporarily_unavailable`).
2. `error_description=<text>` is echoed as the provider's explanation; if it mentions a `redirect_uri` mismatch, that is called out.
3. A missing `code` parameter is reported.
4. A missing `state` parameter is reported.

Nothing else about OAuth is checked: no token validation, no PKCE verification, no provider-specific behavior.

## Demo scenarios

Each has a `good.json`, `bad.json` and `truth.json` in `packages/demo/scenarios/<name>/`, a deliberately buggy handler in `packages/demo/handlers/`, and a fixed version in `packages/demo/fixes/`.

| Scenario | Bug |
|---|---|
| `hubspot-phone` | handler requires `phone_number` to be an integer; payload sends `"+91 98765 43210"` |
| `github-pr` | reads `payload.pull_request.user.login` on an `issues` event |
| `stripe-customer` | reads `customer.email` when `customer` is `null` (guest checkout) |
| `hubspot-email` | calls `email.toLowerCase()` when `email` is absent |
| `order-items` | reads `items[0].price` when `items` is `[]` |
| `oauth-redirect` | GET redirect with `error=access_denied&error_description=redirect_uri+mismatch`; handler calls `code.trim()` |

```bash
npm run demo:send -- <scenario> good|bad [--url <public url>]
npm run demo:play -- <scenario> [--url <public url>]    # good, good, bad, 1s apart
npm run demo:fix -- <scenario|all>                       # copy the fix over the broken handler (tsx watch hot-reloads)
npm run demo:reset -- <scenario|all>                     # restore the broken handler
npm run demo:warm                                        # push every scenario through the real pipeline to fill the AI cache
npm run eval -- --ai-url http://localhost:8080 --label 3b
```

See [DEMO.md](DEMO.md) for the 3-minute script.

## Tests

```bash
npm test            # vitest: core units, OAuth rules, model client + cache (stub server), relay -> CLI -> app integration
npm run typecheck
```

The integration test starts the relay, a fake local app and the CLI forwarder in one process, sends a binary body to `/cb/:id/x`, and asserts the app received identical raw bytes and headers and the caller got the app's response. It also covers offline queueing and flush order, 404/413/401 handling, and a failing request being diagnosed with the model down.

## Eval results

`npm run eval` sends each scenario's good then bad payload straight to the demo app, captures stderr, runs the diagnosis and scores the output against `truth.json` (keyword groups fixed in advance, never tuned to a model). "Pass" means the output mentions every keyword group; it does not judge whether the suggested fix is good. Each run appends to [eval/results.md](eval/results.md) with the answers.

| Model | Rule-based only | AI | Notes |
|---|---|---|---|
| 1B | _not run yet_ | _not run yet_ | run `npm run eval -- --label 1b` |
| 3B | _not run yet_ | _not run yet_ | run `npm run eval -- --label 3b` |

No real-model numbers are published here because none have been measured yet. A smoke test with a stand-in server confirmed the scoring harness works. Expect the rule-based column to do well on these scenarios, since the payload diff names the field directly; the model's job is to explain why and suggest a fix.

## Limitations

- Stack trace parsing is **Node-only** (`at fn (file:line:col)`). Python/Go traces are not parsed, so you would get the payload diff and the model without code context.
- Replaying a signed callback re-sends the **original headers**. If the provider's signature includes a timestamp that your app rejects when old, the replay will fail for that reason.
- **Small models can be wrong.** That is why the rule-based diff is shown next to the AI text. Always check the highlighted code.
- The relay buffer is **ephemeral on App Platform** (tunnels are in the same file; see DEPLOY.md).
- Local model latency on CPU can be **10-30s** per explanation (cached answers are instant).
- The OAuth support is limited to the four rules above.
- Dashboard "Copy as curl" builds the command from the stored text body; binary bodies are not reproduced.

## Codebase map

```
packages/
  core/    pure logic: stack parsing, source context, payload diff, OAuth rules, prompt, model client, AI cache, diagnose()
  relay/   Express + ws + SQLite relay (server.ts), Dockerfile at repo root
  cli/     `cbf`: agent.ts (engine + dashboard server), tunnel.ts, forward.ts, store.ts, stderr.ts, dashboard/index.html
  demo/    demo app + handlers + fixes, scenarios, sender, eval, warm
scripts/   dev-all.ts
```

## License

MIT

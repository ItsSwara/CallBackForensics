# Callback Forensics

**Tunneling is solved. We add a private, local AI that reads the failed request plus your own source code and explains the bug.**

Works with any inbound callback. The MVP diagnosis is tuned for JSON webhooks; OAuth diagnosis is limited to the rules listed below.

AI analysis runs locally. The relay stores events for 24h with token auth.

- Repo: <https://github.com/ItsSwara/CallBackForensics>
- More docs: [WALKTHROUGH.md](WALKTHROUGH.md) (one request, hop by hop) · [DEMO.md](DEMO.md) (3-minute script, judge Q&A) · [DEPLOY.md](DEPLOY.md) · [DECISIONS.md](DECISIONS.md) · [eval/results.md](eval/results.md)

## The problem

A third-party callback fails on your machine. The sender shows a bare `500`, the stack trace is buried in your terminal, and you cannot easily tell whether the payload changed, your handler is wrong, or the provider is calling the wrong path. Tunnels (ngrok, Cloudflare Tunnel) get the request to you, but nothing connects the failed request to your code and says why it failed.

## What it does

1. A small cloud **relay** gives you one stable public URL: `https://RELAY/cb/<id>/...`.
2. The local **`cbf`** agent receives callbacks over a WebSocket tunnel and forwards them to your `localhost` app, byte for byte (so HMAC signature checks still pass).
3. A local **dashboard** (`http://127.0.0.1:4000`) lists every request, replays any of them in one click, and shows the response.
4. When your app answers 4xx/5xx, the agent builds evidence: the payload, a diff against the last successful payload, your app's stack trace, and the source lines around the failing line.
   - **Rule-based findings** appear instantly.
   - A **local model** (llama.cpp's `llama-server`) turns the same evidence into a plain-English `ROOT CAUSE` / `FIX` a few seconds later.

If the model is not running you still get the rule-based findings. If the app returns 404/405 the model is skipped and you get a routing finding instead (see Limitations).

## Architecture

```
 [Sender: GitHub / Stripe / HubSpot / browser redirect / demo sender]
          | POST|GET https://RELAY/cb/:tunnelId/<any path>
          v
 [ Relay  (packages/relay): Express + ws + SQLite ]
          | stores the event, forwards over WebSocket, waits up to 25s for a response
          |   (CLI offline: stores it, answers 202 {queued:true}, flushes on reconnect)
          v   ws://RELAY/tunnel?id=...&token=...
 [ CLI  `cbf start`  (packages/cli) ]  --- raw bytes, same headers --->  [ Your app on localhost:PORT ]
          |                                                                   |
          | <------------ status, headers, body, stderr stack trace ----------+
          |
          |  on 4xx/5xx or connection failure:
          |    parseStackTrace -> readSourceContext -> diffPayloads    (core, instant, rule-based)
          |    buildPrompt -> llama-server :8080 /v1/chat/completions  (core, async, local model)
          v
 [ Dashboard  http://127.0.0.1:4000 : events, replay, diff, code, explanation (live via SSE) ]
```

## Quick start

Requires Node 20+. A model server is optional but recommended.

```bash
git clone https://github.com/ItsSwara/CallBackForensics.git && cd CallBackForensics
npm install
npm run dev:all
```

`dev:all` starts a local relay (`:8090`), the demo app under `tsx watch` (`:3000`), and the agent with its dashboard (`:4000`). For the AI explanation, start a model server separately:

```bash
llama-server -m /path/model.gguf --port 8080 -c 4096
```

Then, in another terminal, send a good and a bad webhook and open <http://127.0.0.1:4000>:

```bash
npm run demo:send -- hubspot-phone good     # 200 through relay -> CLI -> demo app
npm run demo:send -- hubspot-phone bad      # 500; the diagnosis appears in the dashboard
```

## Usage

**With your own app and a deployed relay**

```bash
npm run cbf -- init --relay https://YOUR-RELAY            # once: prints your stable public URL
npm run cbf -- start --port 3000 --src . -- npm run dev   # run your app under the agent
```

Point the sender at `https://YOUR-RELAY/cb/<id>/your/path`. Running your app after `--` lets the agent capture its stderr. Without it the agent still forwards and replays, but there is no stack trace.

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
| `CBF_HOME` | cli | config and event store directory (default `~/.cbf`) |
| `CBF_CACHE` | cli, demo | AI answer cache file (default `~/.cbf/ai-cache.db`) |
| `CBF_URL`, `DEMO_SECRET` | demo | public relay URL for the sender; HMAC secret |

Relay limits: 1MB body (413), 60 requests/minute per tunnel (429), 20 tunnels per IP per day, 25s response wait (504), events kept 24h.

**What the diagnosis uses.** The agent waits 400ms after a failure, takes the app's stderr for that request, and builds:

1. *Rule-based findings (instant):* a payload diff against the last 2xx for the same method and path (missing keys, new keys, type changes, fields that became null, empty arrays, with JSON paths), the parsed error line, the first non-`node_modules` stack frame, and the source around it. It never reads files outside `--src`. With no earlier successful payload there is nothing to compare, so only empty arrays are flagged.
2. *AI explanation (local model):* a compact prompt (about 1,500 tokens max): PAYLOAD, PAYLOAD DIFF, ERROR, FAILING CODE (failing line marked `>>`). Answers are cached in SQLite by the hash of the prompt; the cache only holds real model output. Model calls run one at a time.

### OAuth rules (exactly these four)

Applied to GET requests whose query has `error`, `error_description`, `code` or `state`, or whose path contains `oauth`, `callback`, `redirect` or `auth`:

1. `error=<code>` is reported, with a plain-English meaning for the standard codes (`access_denied`, `invalid_request`, `unauthorized_client`, `unsupported_response_type`, `invalid_scope`, `server_error`, `temporarily_unavailable`).
2. `error_description=<text>` is echoed as the provider's explanation; a `redirect_uri` mismatch is called out.
3. A missing `code` parameter is reported.
4. A missing `state` parameter is reported.

Nothing else about OAuth is checked: no token validation, no PKCE verification, no provider-specific behavior.

### Demo scenarios

Each has `good.json`, `bad.json` and `truth.json` in `packages/demo/scenarios/<name>/`, a deliberately buggy handler in `packages/demo/handlers/`, and a fixed version in `packages/demo/fixes/`.

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
npm run demo:fix -- <scenario|all>                       # copy the fix over the handler (tsx watch hot-reloads)
npm run demo:reset -- <scenario|all>                     # restore the broken handler
npm run demo:warm                                        # run every scenario through the real pipeline to fill the AI cache
npm run eval -- --ai-url http://localhost:8080 --label 3b --note "Llama 3.2 3B Q4_K_M, CPU"
```

### Tests

```bash
npm test            # vitest: core units, OAuth rules, model client and cache (stub server), relay -> CLI -> app integration
npm run typecheck
```

The integration test starts the relay, a fake local app and the CLI forwarder in one process, sends a binary body through `/cb/:id/x`, and asserts the app received identical raw bytes and headers and the caller got the app's response. It also covers offline queueing, 404/413/401 handling, and a failing request being diagnosed with the model down.

## Eval results

Measured with `npm run eval` on **Llama 3.2 3B Instruct, Q4_K_M quantization, CPU-only inference** (llama.cpp `llama-server`), 22 Oct 2026. Full answers are in [eval/results.md](eval/results.md).

| Scenario | Rule-based | AI explanation | Seconds |
|---|---|---|---|
| hubspot-phone | pass | pass | 5.4 |
| github-pr | pass | pass | 2.5 |
| stripe-customer | pass | pass | 2.6 |
| hubspot-email | pass | pass | 2.6 |
| order-items | pass | pass | 2.5 |
| oauth-redirect | pass | **miss** | 3.9 |
| **Total** | **6/6** | **5/6** | 2.5 to 5.4 per answer |

How to read this:

- **Scoring is a keyword match.** An answer passes if it mentions every keyword group in the scenario's `truth.json` (the field name and the kind of problem). The keywords were fixed before any model ran. It does not check that the suggested fix is correct.
- **The sample is small:** 6 scenarios, one bad payload each, one run, one model. Treat it as a smoke test, not a benchmark.
- The one miss: for `oauth-redirect` the model blamed the missing `state` and never mentioned the provider's `access_denied` / `redirect_uri` error or the missing `code`.
- Rule-based findings pass on all six because the diff and error line already name the field. The model's added value is the plain-English reason and the suggested fix.
- A 1B model was **not run**.
- Latency is for CPU inference; cached answers are instant.

## Deployment

The relay ships with a `Dockerfile` and a DigitalOcean App Platform spec (`.do/app.yaml`). It was deployed to App Platform and tested end to end with a real GitHub ping on 22 Oct 2026: one 512MB container (`basic-xxs`), healthy, autodeploy off. The demo instance will be taken down after judging, so the README intentionally contains no live URL; deploy your own with [DEPLOY.md](DEPLOY.md). App Platform disk is ephemeral: a redeploy resets the SQLite file, which holds both the 24h event buffer and the tunnels.

## Honest comparison

| Tool | What it does better | What Callback Forensics adds |
|---|---|---|
| **ngrok** | Mature, fast, polished tunnels; custom domains, auth, and a request inspector with replay. | A diagnosis step: it ties the failed request to your app's stderr and source and explains the bug with a local model. It is open source and self-hostable, but far less battle-tested. |
| **Cloudflare Tunnel** | Free, very reliable, runs on your own domain, great for exposing real services. | Callback-specific tooling: event history, one-click replay, payload diff, explanations. Cloudflare Tunnel does none of the inspection. |
| **Hookdeck** | Production-grade hosted webhook infrastructure: retries, queues, filtering, transformations, observability, alerting. | A local-first debugging loop with a model that runs on your machine, and a code-aware explanation. It does not replace Hookdeck for production delivery guarantees. |
| **Stripe CLI** | First-party, understands Stripe events, signing secrets and `stripe trigger`. | Works with any sender (GitHub, HubSpot, your own) and explains failures from your code. It does not know provider-specific semantics the way the Stripe CLI does. |

## Limitations

- **Stack trace parsing is Node-only** (`at fn (file:line:col)`). For other languages you get the payload diff and the model, without code context.
- **Replaying a signed callback re-sends the original headers.** If the provider's signature includes a timestamp your app rejects when old, the replay fails for that reason.
- **Small models can be wrong.** That is why the rule-based findings are shown next to the AI text; check the highlighted code.
- **404/405 skips the model.** On HTTP 404 or 405, or when a failure leaves no stderr and no stack frame (while the agent is capturing stderr), the finding is "No route matched <METHOD> <path> on the local app (HTTP <status>). This is a routing problem, not a payload problem. Check the path your provider is calling." No model call is made. In forward-only mode (no app command) empty stderr proves nothing, so the second condition does not apply.
- **OAuth diagnosis covers only the four rules above.**
- **Relay storage is ephemeral on App Platform:** a redeploy loses buffered events and tunnels.
- Callbacks pass through the relay to reach your machine; only the AI analysis is local. Do not point production secrets at a relay you do not control.
- Local model latency on CPU can be 10 to 30 seconds on slower machines (2.5 to 5.4 s measured above).
- "Copy as curl" is built from the stored text body; binary bodies are not reproduced.

## Codebase map

```
packages/
  core/    pure logic: stack parsing, source context, payload diff, OAuth rules, prompt, model client, AI cache, diagnose()
  relay/   Express + ws + SQLite relay (server.ts); Dockerfile at repo root
  cli/     `cbf`: agent.ts (engine and dashboard server), tunnel.ts, forward.ts, store.ts, stderr.ts, dashboard/index.html
  demo/    demo app, handlers, fixes, scenarios, sender, eval, warm
scripts/   dev-all.ts
graphify-out/   generated knowledge graph of the codebase (GRAPH_REPORT.md is the readable summary)
```

## License

MIT, see [LICENSE](LICENSE).

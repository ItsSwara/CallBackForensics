# Demo script (about 3 minutes)

## Pre-flight checklist (do this 10 minutes before)

- [ ] `llama-server` is up: `llama-server -m /path/model.gguf --port 8080 -c 4096`. Check: `curl http://localhost:8080/health`
- [ ] Model is warm (it answered at least one request, so the weights are paged in).
- [ ] Handlers are in their broken state: `npm run demo:reset -- all`
- [ ] Ports are free: **3000** (demo app), **4000** (dashboard), **8090** (local relay), **8080** (model). On Windows: `netstat -ano | findstr ":3000 :4000 :8090"`
- [ ] Stack is running: `npm run dev:all` (leave it running; note the printed public URL)
- [ ] Cache is warm: `npm run demo:warm` (real model answers only; it runs every scenario through the real pipeline and prints `cached now` or `cached` per scenario)
- [ ] Dashboard open on a projector-sized window: <http://127.0.0.1:4000>
- [ ] If using the deployed relay: `npm run cbf -- doctor` shows relay reachable, and a test `demo:send ... good` returns 200.
- [ ] Do **not** redeploy the relay on the day (tunnels reset, see DEPLOY.md).

## The script

**0:00, the problem (20s).** "When a webhook fails, you get a 500 on the sender's side and a stack trace buried in your terminal. Tunnels like ngrok solved *getting* the request. Nobody explains *why it failed*."

**0:20, send traffic (30s).**
```bash
npm run demo:play -- hubspot-phone
```
"Two good webhooks, then one bad one, through a public URL, a WebSocket tunnel and into my local app." In the dashboard: two green rows, one red.

**0:50, the red one (60s).** Click the red row.
- "Instantly, before any AI: the rule-based findings. `phone_number` was a number in the last good payload and is now a string. No model involved."
- "The error and my actual source line, highlighted: the check that threw."
- "And the explanation from a model running on this laptop. It only sees the payload, the diff, the trace and these lines." (If it says *cached*: "these were pre-computed with `demo:warm` to save time; Re-analyze runs it live, it takes a few seconds on CPU." Click **Re-analyze** if there is time.)

**1:50, fix it live (45s).**
```bash
npm run demo:fix -- hubspot-phone
```
"The demo app runs under `tsx watch`, so it hot-reloads." Click **Replay**. The banner turns green: **Fixed! 500 -> 200**. "Same stored bytes and headers, so even the signature check passes."

**2:35, close (25s).** "Tunneling is solved. We add a private, local AI that reads the failed request plus your own source and explains the bug. AI analysis runs locally; the relay stores events for 24 hours with token auth. It's open source."

Reset for the next run: `npm run demo:reset -- all`.

### Optional extras (pick one if time allows)

- `npm run demo:play -- github-pr` (an `issues` event hits a pull-request handler: missing key).
- `npm run demo:play -- oauth-redirect` (an OAuth `access_denied` / redirect_uri mismatch: shows the OAuth rules, and the "AI skipped / AI offline" fallback if you stop `llama-server`).
- Stop `llama-server` and send a bad payload: rule-based findings still appear, with "AI unavailable, showing rule-based findings".

## Using the deployed relay instead of local

```bash
npm run cbf -- init --relay https://<app>.ondigitalocean.app
npm run cbf -- start --port 3000 --src . -- npm run -s demo:app
npm run demo:play -- hubspot-phone --url https://<app>.ondigitalocean.app/cb/<id>/
```

## Backup plan: Wi-Fi or the deploy fails

Run everything on the laptop. No internet is needed except for installing packages beforehand:

```bash
npm run dev:all
npm run demo:play -- hubspot-phone     # the sender auto-detects the local dev tunnel
```

If the model server will not start, the demo still works end to end with rule-based findings; say so openly and point at the "AI offline" indicator.

## Judge Q&A cheat sheet

**Why not ngrok or Hookdeck?** Use them for what they are great at: ngrok for polished tunnels and inspection, Hookdeck for production delivery guarantees. Neither connects a failed request to your app's stderr and source code and explains the bug with a model that runs on your machine. We are the debugging layer, not a replacement for production infrastructure.

**Why a small local model?** Cost (free), latency control, and because the prompt contains your source code and payloads. AI analysis runs locally, so that evidence is not sent to an AI provider. The honest caveat: callbacks still pass through the relay to reach you, and the relay stores them for 24 hours with token auth.

**Where is the privacy?** In the AI step only: the model server runs on your machine. We do not claim the whole system is private; the relay sees your callbacks.

**How do you know the AI is right?** We don't, which is why we do not rely on it alone. The rule-based findings are deterministic and shown next to the model text, the code line is highlighted so you can check it, and `npm run eval` scores model output against fixed ground-truth keywords per scenario (we report failures as they are).

**What does the AI do that a script can't?** A script can say "`phone_number` changed from number to string". It cannot connect that to the `Number.isInteger` check three lines up, say what the handler expects, and propose a change in plain English. In our eval the rule-based output often already names the field; the model adds the *why* and the *fix*. (See eval/results.md for measured numbers.)

**Does it support Python or Go?** The tunnel, replay, diff and dashboard work for any app. Stack trace and source parsing are Node-only today; for other languages you get the payload diff and the model without code context. Adding a parser per language is the natural next step.

**Who would use this?** Developers integrating third-party webhooks and OAuth redirects on localhost: SaaS integration engineers, indie hackers wiring Stripe/GitHub/HubSpot, and teams onboarding to a new provider.

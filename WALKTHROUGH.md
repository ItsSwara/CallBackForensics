# Walkthrough: one request, start to finish

We follow a single failing callback: a HubSpot-style webhook whose `phone_number` is the string `"+91 98765 43210"` where the app expects an integer. Everything below is a real function you can open.

**The one-sentence version:** the relay hands the request to your laptop; the CLI passes it to your app; when your app crashes, the CLI reads the crash text and your code, builds a small fact sheet, and asks a local model to explain it, while a plain script has already shown the obvious facts.

---

## 1. The sender hits the public URL

`packages/demo/sender/send.ts` (`sendScenario`) POSTs to `https://RELAY/cb/<tunnelId>/webhooks/hubspot-phone` with the file's exact bytes and a signature header computed over those bytes (`packages/demo/signing.ts`, `hubSignature`). A real sender (GitHub, Stripe, HubSpot) does the same thing.

## 2. The relay receives it

`packages/relay/src/server.ts`

- The route `app.all(/^\/cb\/([^/]+)(\/.*)?$/, ...)` uses `express.raw(...)`, so the body stays as **raw bytes** (this is why signature checks still work later). Over 1MB it fails with 413.
- `publicHandler` looks up the tunnel, applies the 60/min rate limit (`allow`), and saves an event row (`q.addEvent`) with method, path, query, headers and the body as a BLOB.

## 3. The relay pushes it down the WebSocket

Still in `publicHandler`: if the tunnel's socket is connected, it builds a message with `toMessage` (`{type:"request", eventId, method, path, query, headers, bodyBase64}`), sends it, and waits (`waitFor`, up to 25 seconds) for a matching `{type:"response"}`. If the CLI is offline it answers `202 {queued:true}` and `flush()` replays queued events when the CLI reconnects.

The socket itself was opened earlier by `server.on('upgrade', ...)`, which checks the token against its stored sha256 hash.

## 4. The CLI receives it and forwards it to your app

`packages/cli/src/tunnel.ts` (`TunnelClient.connect`) gets the message and calls `onRequest`, which is `handleRelayRequest` in `packages/cli/src/agent.ts`. That calls `processRequest`, which calls `forwardToLocal` in `packages/cli/src/forward.ts`: same method, path, query, headers and raw bytes (only `Host` is rewritten) sent to `localhost:3000`. If nothing is listening it returns a 502 saying "your app is not running on :3000".

## 5. Your app crashes

`packages/demo/handlers/hubspot-phone.ts` (`handleHubspotPhone`) checks `Number.isInteger(phone)`, fails, and throws. The error handler in `packages/demo/app/server.ts` prints `err.stack` to **stderr** and answers 500.

## 6. The CLI captures stderr

The CLI started your app itself (`cbf start -- <command>`), via `spawnApp` in `packages/cli/src/app-process.ts`. Its stderr is piped through `StderrBuffer.push` (`packages/cli/src/stderr.ts`): lines are timestamped and the last 500 are kept, and everything is still mirrored to your terminal.

## 7. The 500 goes back, then the CLI investigates

`processRequest` stores the event (`EventStore.insert`, `packages/cli/src/store.ts`), returns the 500 to the relay (which returns it to the sender), and, because the status is >= 400, starts `diagnoseEvent` **without blocking the response**:

1. waits 400ms for the stack trace to be flushed,
2. takes the stderr lines between the request's start minus 50ms and now (`StderrBuffer.window`),
3. finds the last 2xx for the same method and path (`EventStore.lastOk`): that is the "last good payload".

## 8. Rule-based analysis (instant): `analyzeRules`

`packages/core/src/diagnose.ts` calls:

- `parseStackTrace` (`stack.ts`): pulls the error line (`TypeError: phone_number must be an integer, received string`) and the first frame that is not in `node_modules` or `node:internal`.
- `readSourceContext` (`source.ts`): reads 10 lines either side of that frame. It refuses any path outside `--src`.
- `diffPayloads` (`diff.ts`): compares the bad payload with the last good one and says `properties.phone_number: was number in last good payload, now string`.

The result is saved (`store.setDiagnosis`) and pushed to the dashboard immediately over SSE (`emitEvent`), marked "AI pending".

## 9. The prompt: `promptFor` / `buildPrompt`

`diagnose.ts` formats the frames with relative paths, then `prompt.ts` builds four sections: PAYLOAD (truncated to about 1500 chars), PAYLOAD DIFF, ERROR (trace, about 800), FAILING CODE (about 1200, failing line marked `>>`). The system prompt tells the model to use only that evidence and to answer as `ROOT CAUSE:` / `FIX:`.

## 10. The model: `runAi` -> `askModel`

`runAi` first checks the cache (`AiCache.get`, keyed by `cacheKey` = sha256 of the prompt). On a miss, `askModel` (`ai.ts`) POSTs to `llama-server`'s `/v1/chat/completions` (temperature 0.1, 250 tokens). Real answers are cached (`AiCache.set`); errors never are. Model calls are queued one at a time (`serial` in `agent.ts`).

## 11. The dashboard updates

`packages/cli/dashboard/index.html` keeps an `EventSource('/api/stream')` open. Each message calls `upsert`, which updates the list and, if that event is selected, `loadDetail` fetches `/api/events/:id` and `renderDetail` draws: AI explanation (spinner, then the text, model name and seconds), rule-based findings, the error with the highlighted source line, then the request and response.

## 12. Replay and the red-to-green flip

"Replay" posts to `/api/replay/:id`, handled by `replay()` in `agent.ts`: it re-sends the stored raw body and original headers to your app and stores the result as a new event with `replayOf` set. After `npm run demo:fix -- hubspot-phone` and a `tsx watch` hot reload, the same payload returns 200 and the dashboard shows "Fixed! 500 -> 200".

---

## What to say to judges in one breath

"The relay is a dumb pipe that keeps raw bytes intact. The CLI is where the intelligence lives: it ties a failed request to the app's stderr and source, runs a deterministic diff first so you always get facts instantly, then asks a small local model to explain it from exactly that evidence."

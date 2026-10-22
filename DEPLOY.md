# Deploying the relay to DigitalOcean App Platform

The relay is the only part that runs in the cloud. It is one small Node service (Express + `ws` + SQLite). It gives you a stable public URL, `https://<app>.ondigitalocean.app/cb/<tunnel id>/`, that forwards to your laptop over a WebSocket.

> Honest notes up front
> - App Platform disk is **ephemeral**. The SQLite file resets on every redeploy or restart. For the 24-hour event buffer that is acceptable: you lose queued-but-undelivered callbacks. But **tunnels live in the same file**, so after a redeploy your tunnel no longer exists: run `cbf init --relay <url> --force` again and update the URL you gave to GitHub/Stripe/etc. If you need a URL that survives redeploys, use a host with a persistent disk (see "Keeping tunnels across redeploys").
> - **Verified:** this Dockerfile and App Platform setup were deployed and tested end to end on 22 Oct 2026 with a real GitHub ping: the app was healthy, running as one 512MB container (`basic-xxs`), with autodeploy off. That demo instance will be taken down after judging; deploy your own.
> - The spec file in this repo has `deploy_on_push: true`. The demo instance ran with autodeploy off so that a push could not redeploy it (and reset its tunnels) mid-demo. Turn autodeploy off in the console, or edit the spec, if you want the same.

## Option A: click path (no CLI)

1. Get the code on GitHub (this project lives at `https://github.com/ItsSwara/CallBackForensics`; use your own fork or copy).
2. DigitalOcean dashboard -> **Create** -> **App Platform**.
3. **Source**: GitHub -> pick `ItsSwara/CallBackForensics`, branch `main`. Turn "Autodeploy" **off** if you will use the relay for a live demo (see the note above).
4. App Platform detects the `Dockerfile`. Keep the detected resource as a **Web Service**.
5. **Edit** the web service:
   - HTTP port: `8080`
   - Instance size: **Basic**, `basic-xxs` (smallest), 1 container
   - Health check: HTTP, path `/health`
   - Environment variables: `PORT=8080`, `DB_PATH=/data/relay.db`, `TRUST_PROXY=1`
6. **Create Resources**. When the build finishes, open the app URL. You should see the landing page, and `https://<app>.ondigitalocean.app/health` should return `{"ok":true}`.

## Option B: from the spec file

Install `doctl`, authenticate (`doctl auth init`), then:

```bash
doctl apps create --spec .do/app.yaml
```

Later changes:

```bash
doctl apps list
doctl apps update <app-id> --spec .do/app.yaml
```

## Connect your laptop

```bash
npm run cbf -- init --relay https://<app>.ondigitalocean.app
npm run cbf -- start --port 3000 --src . -- npm run -s demo:app
```

`init` prints your stable public URL. Send a test callback:

```bash
npm run demo:send -- hubspot-phone good --url https://<app>.ondigitalocean.app/cb/<id>/
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port the relay listens on |
| `DB_PATH` | `./relay.db` | SQLite file for tunnels and the 24h event buffer |
| `TRUST_PROXY` | `1` | Reverse-proxy hops in front of the relay (used for the 20-tunnels-per-IP-per-day limit) |

## Keeping tunnels across redeploys

Tunnels and buffered events share one SQLite file, so an ephemeral disk loses both. Options, in order of effort:

1. Do nothing and re-run `cbf init --force` after a redeploy (fine for a hackathon demo; do **not** redeploy during the demo).
2. Run the same Docker image on a host with a persistent disk (a small Droplet with a mounted volume at `/data`).

## Troubleshooting

- **Build fails compiling `better-sqlite3`**: the image already installs `python3 make g++`; check the build log for the actual error and the Node version (the image pins Node 20).
- **Health check fails**: the app must listen on `$PORT` (8080); confirm the env var and `http_port` match.
- **WebSocket will not connect**: `cbf doctor` checks `/health` only. Connect with `cbf start` and watch for `relay connected`. App Platform supports WebSockets on web services; confirm the URL uses `https`.
- **Per-IP tunnel limits look wrong** (everyone seems to share one IP, or limits never trip): adjust `TRUST_PROXY` to the number of proxies in front of the relay (default `1`).

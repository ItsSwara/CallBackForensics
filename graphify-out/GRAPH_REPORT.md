# Graph Report - localhook-ai  (2026-10-22)

## Corpus Check
- Corpus is ~23,399 words - fits in a single context window. You may not need a graph.

## Summary
- 474 nodes · 836 edges · 52 communities (19 shown, 33 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 47 edges (avg confidence: 0.89)
- Token cost: 104,181 input · 0 output

## Community Hubs (Navigation)
- Relay Agent & Tunnel Process
- AI Diagnosis Cache & Prompting
- Webhook Route Handlers
- Demo Sender & Scenario Builder
- Root Package Dependencies
- App Spec & Demo/Eval Docs
- Config & Path Resolution
- Relay Tunnel Connection
- Diagnosis Pipeline (Rules + AI)
- TypeScript Compiler Config
- Dev-All Process Orchestration
- CLI Package Manifest
- Relay Env Vars & Delivery Rationale
- Diff/Finding Comparison Utility
- Core Package Manifest
- Relay Package Manifest
- Demo Package Manifest
- Model Skip Rules (Diagnosis)
- HMAC Signature Verification
- Why Not Hookdeck/ngrok (Rationale)
- Demo Warm & Preflight Checklist
- Dev:all CBF_HOME Isolation
- Graphify Skill Setup Note
- OAuth Redirect Scenario Rules
- Deploy/Demo Backup Plans
- Judge Q&A Cheat Sheet
- 3-Minute Demo Script
- No-CLI Deploy Option
- Deploy Troubleshooting
- Health Check Endpoint
- Dashboard AI Panel
- Dashboard Analyze Action
- Dashboard Body Block Render
- Dashboard Boot (SSE + Fetch)
- Dashboard Copy-cURL Action
- Dashboard Error Panel
- Dashboard Headers Table
- Dashboard Event List Render
- Dashboard Status Render
- Dashboard Row Selection
- System Architecture Overview
- CBF CLI Commands
- Known Limitations
- Test & Typecheck Setup
- Agent Replay Function

## God Nodes (most connected - your core abstractions)
1. `startAgent()` - 28 edges
2. `express` - 22 edges
3. `analyzeRules()` - 15 edges
4. `scripts` - 13 edges
5. `StderrBuffer` - 13 edges
6. `EventStore` - 12 edges
7. `AiCache` - 11 edges
8. `runAi()` - 11 edges
9. `main()` - 11 edges
10. `compilerOptions` - 10 edges

## Surprising Connections (you probably didn't know these)
- `truth.json keyword groups` --conceptually_related_to--> `3b eval run (2026-10-22)`  [INFERRED]
  DECISIONS.md → eval/results.md
- `Rule-based scoring uses diff + error line` --conceptually_related_to--> `3b eval run (2026-10-22)`  [INFERRED]
  DECISIONS.md → eval/results.md
- `3b eval run (2026-10-22)` --conceptually_related_to--> `github-pr scenario`  [INFERRED]
  eval/results.md → README.md
- `3b eval run (2026-10-22)` --conceptually_related_to--> `stripe-customer scenario`  [INFERRED]
  eval/results.md → README.md
- `3b eval run (2026-10-22)` --conceptually_related_to--> `hubspot-email scenario`  [INFERRED]
  eval/results.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Diagnosis Pipeline (rule-based + AI)** — walkthrough_diagnoseevent, walkthrough_analyzerules, walkthrough_buildprompt, walkthrough_runai, packages_cli_dashboard_index_aipanel [INFERRED 0.85]
- **Demo and Eval Workflow** — demo_doc, readme_demo_scenarios, eval_results_doc, decisions_demo_warm [INFERRED 0.75]
- **Relay Deployment Configuration** — do_app_callback_forensics_relay, deploy_doc, deploy_env_vars, decisions_trust_proxy [INFERRED 0.75]

## Communities (52 total, 33 thin omitted)

### Community 0 - "Relay Agent & Tunnel Process"
Cohesion: 0.05
Nodes (33): Agent, AgentOptions, bodyView(), detail(), failing(), hostOk(), sleep(), startAgent() (+25 more)

### Community 1 - "AI Diagnosis Cache & Prompting"
Cohesion: 0.08
Nodes (41): askModel(), AiCache, CachedAnswer, cacheKey(), openDatabase(), AiOptions, analyzeRules(), asText() (+33 more)

### Community 2 - "Webhook Route Handlers"
Cohesion: 0.08
Nodes (19): analytics, ContactRow, contacts, loginSessions, mailingList, oauthClient, receipts, reviewQueue (+11 more)

### Community 3 - "Demo Sender & Scenario Builder"
Cohesion: 0.11
Nodes (38): isAiOk(), freePort(), main(), matches(), post(), sleep(), buildRequest(), BuiltRequest (+30 more)

### Community 4 - "Root Package Dependencies"
Cohesion: 0.05
Nodes (40): dependencies, better-sqlite3, express, ws, description, devDependencies, tsx, @types/better-sqlite3 (+32 more)

### Community 5 - "App Spec & Demo/Eval Docs"
Cohesion: 0.09
Nodes (20): Rule-based scoring uses diff + error line, Things deliberately not done, truth.json keyword groups, Option B: deploy from spec file (doctl), callback-forensics-relay App Spec, Llama-3.2-3B-Instruct-Q4_K_M.gguf, 3b eval run (2026-10-22), loadDetail (+12 more)

### Community 6 - "Config & Path Resolution"
Cohesion: 0.18
Nodes (20): cachePath(), configPath(), eventsDbPath(), homeDir(), loadConfig(), publicUrl(), saveConfig(), aiDefault() (+12 more)

### Community 7 - "Relay Tunnel Connection"
Cohesion: 0.11
Nodes (13): RAW, Seen, relay, createRelay(), flush(), waitFor(), HOP_BY_HOP, Pending (+5 more)

### Community 8 - "Diagnosis Pipeline (Rules + AI)"
Cohesion: 0.10
Nodes (16): analyzeRules, askModel, buildPrompt / promptFor, diagnoseEvent, diffPayloads, EventStore.insert, forwardToLocal, handleRelayRequest (+8 more)

### Community 9 - "TypeScript Compiler Config"
Cohesion: 0.15
Nodes (12): compilerOptions, esModuleInterop, module, moduleResolution, noEmit, resolveJsonModule, skipLibCheck, strict (+4 more)

### Community 10 - "Dev-All Process Orchestration"
Cohesion: 0.20
Nodes (7): children, cli, env, home, kill(), root, shutdown()

### Community 11 - "CLI Package Manifest"
Cohesion: 0.20
Nodes (9): bin, callback-forensics, cbf, exports, main, name, private, type (+1 more)

### Community 12 - "Relay Env Vars & Delivery Rationale"
Cohesion: 0.22
Nodes (8): Relay delivery semantics, Relay environment variables table, DB_PATH Env Var, TRUST_PROXY Env Var, flush (relay, queued events), publicHandler (relay), toMessage (relay), waitFor (relay, 25s wait)

### Community 13 - "Diff/Finding Comparison Utility"
Cohesion: 0.39
Nodes (7): Finding, join(), Kind, kindOf(), NO_BASELINE, standalone(), walk()

### Community 14 - "Core Package Manifest"
Cohesion: 0.29
Nodes (6): exports, main, name, private, type, version

### Community 15 - "Relay Package Manifest"
Cohesion: 0.29
Nodes (6): exports, main, name, private, type, version

### Community 16 - "Demo Package Manifest"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 18 - "HMAC Signature Verification"
Cohesion: 0.67
Nodes (3): HMAC signature verification over raw body, hubSignature (signing), sendScenario (demo sender)

### Community 19 - "Why Not Hookdeck/ngrok (Rationale)"
Cohesion: 0.67
Nodes (3): Why not Hookdeck (Q&A), Why not ngrok (Q&A), How it compares (ngrok, Cloudflare Tunnel, Hookdeck, Stripe CLI)

## Knowledge Gaps
- **60 isolated node(s):** `@types/better-sqlite3`, `@types/express`, `@types/node`, `@types/ws`, `typescript` (+55 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 214 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **33 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `express` connect `Webhook Route Handlers` to `Relay Agent & Tunnel Process`, `Root Package Dependencies`, `Relay Tunnel Connection`?**
  _High betweenness centrality (0.157) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `startAgent()` (e.g. with `handleRelayRequest()` and `.get()`) actually correct?**
  _`startAgent()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@types/better-sqlite3`, `@types/express`, `@types/node` to the rest of the system?**
  _60 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Relay Agent & Tunnel Process` be split into smaller, more focused modules?**
  _Cohesion score 0.054563492063492064 - nodes in this community are weakly interconnected._
- **Why does `startAgent()` connect `Relay Agent & Tunnel Process` to `AI Diagnosis Cache & Prompting`, `Demo Sender & Scenario Builder`, `Config & Path Resolution`, `Relay Tunnel Connection`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Should `AI Diagnosis Cache & Prompting` be split into smaller, more focused modules?**
  _Cohesion score 0.0768361581920904 - nodes in this community are weakly interconnected._
- **Should `Webhook Route Handlers` be split into smaller, more focused modules?**
  _Cohesion score 0.07767722473604827 - nodes in this community are weakly interconnected._
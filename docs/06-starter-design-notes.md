# 06 · Starter design notes

Status: **brainstorming in progress. Nothing here is approved.** The brainstorming gate (no building until the design is approved) still applies to implementation.

## What the owner said

- Use the SDK as the broker, deployed on Cloudflare.
- Agent: Pi, minimal. Wants to learn about sandboxing and tooling, using local filesystems only.
- The agent communicates back to GitHub.
- Not interested in finishing real tasks, code reviews or development work.
- Reusing the shape of the SDK's Cloudflare example makes sense, but that example is likely too complicated because it tries to prove every feature on Durable Objects. Refer to it, don't copy it.
- After Cloudflare works: other clouds (Azure, AWS) and different sandboxing strategies. Start with Pi.

## Findings from recon

### `pi-durable-chat` (Pi)

- A chat web app: React client over WebSockets, one Durable Object per session.
- The agent core, `src/agent/`, imports nothing from Cloudflare. `ports.ts` lists what a runtime must provide: `Storage`, `Wakeup` (alarm), open connections, `fail`.
- `src/adapters/cloudflare/` maps Durable Object SQLite storage, hibernating WebSockets and alarms onto those ports (about 200 lines).
- **No sandbox, bash, or filesystem tools.** Its tools are mocks: weather, Singapore haze readings, scheduling, search over earlier conversations.
- Model access via OpenRouter; deployed with Wrangler (not Alchemy).
- Described by its authors as a sample, Pi Durable as experimental.

### `effect-channels/examples/alchemy-cloudflare` (SDK reference app)

- Three Durable Objects per issue or PR: DeliveryMailbox, AgentSession, Computer.
- Real workspace: files and git objects in Durable Object SQLite, a just-bash shell, an optional Debian container.
- Uses the Fold agent runtime, not Pi; deployed with Alchemy. About 3,700 lines, including labelling, CI-failure tools and mention access control.
- Useful as a map of the pieces, not as a base to copy.

### Consequence

The sandbox and tooling part of the learning goal is something we add on top of Pi. Pi does not demonstrate it.

## Working guesses (not decisions)

| # | Guess |
|---|---|
| G1 | Broker: Worker + mailbox Durable Object with the GitHub provider and one `onMentioned` callback, following the example's shape |
| G2 | Agent: Pi in its own Durable Object, one per PR, started by the callback, reporting via the delivery API |
| G3 | Tools: two or three tiny ones, such as `write_file`, `read_file`, `list_files` |
| G4 | Task: write a file, read it back, reply "I wrote and read hello.txt" |
| G5 | Keep broker, agent host and sandbox behind clear seams so other clouds and sandboxes can replace them |

## Open questions

1. **Filesystem on Cloudflare.** A Worker has no real disk. Is a virtual filesystem stored inside Durable Objects enough for the starter, or does the starter need a real disk in a container from day one? *(This was the last question asked; unanswered.)*
2. **Driving Pi headlessly.** Pi is built around WebSocket clients; here the broker drives it. Needs a spike to confirm it can run without a client.
3. **Deploy tooling.** Pi's repo uses Wrangler; the SDK example uses Alchemy. Pick one, or keep two.
4. **Model access.** Pi uses OpenRouter. A "simplest possible" agent could skip the model entirely and be scripted; is a real model call part of what should be learned?
5. **Access control.** Anyone who can comment could trigger the agent. Restrict to a test repository and the owner, or copy the "write access" check?
6. **Stop signal.** Confirm in code how a stop is delivered (see [05-state-and-memory](05-state-and-memory.md)).
7. **Agent state store.** Where does the agent keep its per-PR conversation and files so a second turn finds them?

## Decisions

| # | Decision | Date | Notes |
|---|---|---|---|
| D1 | Keep Alchemy for deploying the broker, for now | 2026-10-18 | Alchemy is only needed by the SDK's Cloudflare adapter (`@humanlayer/channels-alchemy-cloudflare`). Terraform or Postgres/Redis storage remain possible later. The example pins `alchemy` at `2.0.0-beta.83`, a beta |

Facts checked: `@humanlayer/channels-delivery`, `-github` and `-alchemy-cloudflare` are published on npm at `0.1.0` (dist-tag `latest`), so the starter can install them without linking the local checkout. The example's other pins: `effect` 4.0.0, `@cloudflare/workers-types` 5.20260929.1.

**Version triangle (found in the first live run, 2026-10-18):** `alchemy` 2.0.0-beta.83 needs `effect` 4.0.5 (`effect/Path.make`). `@humanlayer/channels-delivery` 0.1.0 reads `Crypto.randomUUIDv4` as a value, which only works up to effect 4.0.2 (4.0.3 made it a method). No single effect version satisfies both, so the broker pins 4.0.5 and `infra/cloudfare/src/CryptoCompat.ts` bridges the one call. Without it every mailbox alarm crashed and replies were never posted. Remove the shim once the SDK is released against effect 4.0.5. The SDK example in `~/Projects/effect-channels` targets unreleased monorepo main, not the published 0.1.0.

## Size

Project with a written design, then a plan. Not yet at the written-design stage.

# cloudfare/ (placeholder)

**Role:** the broker, deployed on Cloudflare.

**Will contain (not yet built):**
- Ingress Worker: webhook route `POST /integrations/github/webhook` and the delivery API
- Mailbox Durable Object (one per issue or PR)
- A single `onMentioned` callback: check access, start the agent, `handoff()`
- Config for secrets: webhook secret, GitHub App ID and private key, bot user ID

**Uses:** `@humanlayer/channels-delivery`, `-github`, `-alchemy-cloudflare`.

**Boundaries:** B1, B2, B3, B4, B6 are the SDK's. B5 (how the callback starts the agent) is defined here. See `../docs/04-architecture.md`.

**Reference only, do not copy wholesale:** `~/Projects/effect-channels/examples/alchemy-cloudflare` (`Worker.ts`, `DeliveryMailboxDO.ts`, `GithubBot.ts`).

**Open:** deploy tooling (Alchemy vs Wrangler). See `../docs/06-starter-design-notes.md`.

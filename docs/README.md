# Docs index

These notes capture a discussion about `effect-channels` and how to use it for a starter project. They describe the SDK as it was read from its repo and READMEs on 2026-10-18. Items marked **(inference)** or **(guess)** were not confirmed in code or by the project owner.

| Doc | What it covers |
|---|---|
| [01-purpose-and-scope](01-purpose-and-scope.md) | Why this project exists, goals, non-goals |
| [02-sdk-overview](02-sdk-overview.md) | What Channels is, what problem it solves, why Effect |
| [03-user-requirements](03-user-requirements.md) | User requirements derived from the SDK, kept separate from implementation |
| [04-architecture](04-architecture.md) | Deployed components, interface boundaries, the GitHub round trip |
| [05-state-and-memory](05-state-and-memory.md) | Who remembers what; worked example with two turns and a stop |
| [06-starter-design-notes](06-starter-design-notes.md) | Findings from Pi and the SDK example, working guesses, open questions |
| [07-roadmap](07-roadmap.md) | Cloudflare first, then Azure and AWS, different sandbox strategies |

## Source material

- SDK: `~/Projects/effect-channels` (packages `delivery`, `github`, `slack`, `linear`, `sql`, `redis`, `alchemy-cloudflare`)
- SDK reference app: `~/Projects/effect-channels/examples/alchemy-cloudflare`
- Agent runtime candidate: `~/Projects/pi-durable-chat`

# 02 · The SDK: what it is and why

## What it is

`effect-channels` ("Channels") is an SDK, published as npm packages (`@humanlayer/channels-*`). Developers install it and write callbacks. It is not an end-user app. The customer is the engineer building an agent.

Tagline from its README: put your agent in Slack, GitHub and Linear without losing a message.

## The problem it solves

An agent takes minutes to hours. Chat and Git tools only wait seconds, deliver webhooks unreliably, and each has its own API. Without a shared layer every team rebuilds the same plumbing:

- Is this really from GitHub?
- What if the server crashes mid-job?
- What if GitHub sends the same event twice?
- What if two comments arrive at once?
- How does the agent get the PR's diff and comments?
- How does the bot show "working" and post the answer?

## What the SDK gives you

| Concern | SDK behaviour |
|---|---|
| Verification | Checks webhook signatures |
| Durability | Saves every event before any callback sees it; drops duplicates |
| Ordering | One mailbox per conversation (a Slack thread, a GitHub issue or PR, a Linear session); one batch at a time |
| Batching | Delivery modes: Serial, Queue, Debounce |
| Retries | Failed callbacks retry; crashed workers' leases expire and another picks up |
| Handoff | A callback starts a remote job and calls `delivery.handoff()`; the mailbox is held until the job completes or fails |
| Output | A delivery API (HTTP) for activity, plan, reactions, messages, complete, fail; saved first, then sent to the provider with retries |
| Native context | GitHub callbacks get issue/PR objects: comments, reviews, files, diff |

## "Broker" is a fair word

It is a durable broker plus an output relay: inbound it saves, orders and dispatches; outbound it takes the agent's reports, saves them and posts them. It also enforces a turn lock: while an agent holds a delivery, later events on that conversation wait.

## Why Effect

The whole codebase is written in Effect v4 (typed errors, dependency injection via layers, schemas, exhaustive matching, a testable clock). It buys reliability logic that is hard to get wrong, swappable storage (Postgres, Redis, Cloudflare Durable Objects, memory), and tests with fake services.

Trade-off: anyone writing callbacks writes Effect code, which is unfamiliar to most TypeScript teams.

## No lowest common denominator

Provider packages are native: Slack callbacks get threads, GitHub callbacks get issues and PRs. Callbacks are therefore provider-specific. Only the core, storage and delivery API are shared. A single agent serving several tools needs a small adapter per provider.

## Packages

| Package | Role |
|---|---|
| `delivery` | Core: `Channels.make`, mailboxes, delivery modes, handoff, delivery API and client |
| `slack`, `github`, `linear` | Providers |
| `sql`, `redis` | Storage on Postgres, Redis |
| `alchemy-cloudflare` | Storage and hosting on Cloudflare Durable Objects, one per mailbox, woken by alarm |

## Gaps to know about

- No MS Teams provider. One would be written against the `ChannelsProvider` contract (`packages/delivery/src/ChannelsProvider.ts`).
- Nothing runs on GitHub Actions runners. The repo's workflows only test and publish the packages.
- No audit trail, approvals or cost controls evident in the SDK.

# 05 · State and memory

## Who remembers what

| State | Owner |
|---|---|
| Saved events, mailbox, leases | Broker (storage) |
| Delivery stage, plan, output sent so far, stop flag, who is waiting | Broker; readable by the agent via `GET /deliveries/:id` |
| The agent's conversation, memory, files, what it already said or read | **The agent.** The SDK does not store it |

The broker gives the agent a stable `conversationId` across turns so it can find its own state again. If the agent host loses its state, the broker cannot restore it. Agent state needs its own durable store.

## Communication

| Direction | How |
|---|---|
| Broker → agent | Your callback starts the job with `deliveryId`, `accessToken`, context. The SDK does not define the call |
| Agent → broker | HTTP delivery API with the token |
| Stop | A flag on the delivery. **(inference)** the agent polls `GET /deliveries/:id`; no push mechanism was found |
| New comment mid-job | Saved and held. After `complete`, it becomes a new delivery with the same `conversationId` |

## Worked example (illustrative IDs and timings)

PR `acme/web#42`, failing CI. `conversationId = acme/web#42`; every turn gets a new `deliveryId`.

| Time | Event | Broker | Agent |
|---|---|---|---|
| 00:00 | Priya: `@bot why does CI fail?` | Event saved, delivery `d-1` claimed | Nothing yet |
| 00:03 | Callback checks access, reads context, starts agent, `handoff()` | `d-1` handed off, mailbox held | Session created, keyed by PR |
| 00:05 | Agent reports Working and a plan | Saves each, 👀 and checklist appear | Clones repo into sandbox |
| 02:10 | Sam: `also check lint` | Saved and waiting, not delivered | Unaware unless it asks |
| 04:00 | Agent completes with an answer | Posts it, removes 👀, releases mailbox | Keeps conversation and workspace |
| 04:01 | Sam's comment runs the callback again | `d-2` handed off | Looks up the PR, finds earlier state, sees Sam's message |
| 05:30 | Priya asks to stop | Stop flag set on `d-2` | Sees it on next status check, ends the turn |
| any | Ingress restarts | Replays from saved events and output | State lost unless stored durably |
| any | Agent host dies | After `failAfter` (24h default) fails `d-2`, unblocks the PR | Same |

## Implication for the starter

Even a trivial agent must decide where its per-PR state lives (conversation, files). That decision is part of what the starter exists to teach. See [06-starter-design-notes](06-starter-design-notes.md).

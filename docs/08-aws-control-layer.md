# 08 · AWS control layer (draft)

Notes from a discussion on 2026-10-20 to 2026-10-23. Nothing here is built. Items marked **(inference)**, **(guess)** or **(unverified)** were not confirmed in code or by the project owner. This doc is about the control layer on AWS. Identity and authorization are a separate topic: see [09-identity-and-authorization](09-identity-and-authorization.md).

## Goal

Run the same control layer that runs on Cloudflare today on AWS, and test its functional behaviour. The agent stays the echo stub. The real agent is out of scope.

Decided by the project owner:
- Test the control layer only. No real agent.
- GitHub first. Other channels (Jira, Teams, others) later, as more webhooks.
- Terraform.
- API Gateway + Lambda + DynamoDB.

Open: whether to run the SDK's own mailbox engine on a DynamoDB store (path 2), or to write the mailbox rules ourselves (path 1). See [Open decision](#open-decision).

## What each Cloudflare piece does, as a requirement

| Piece | What it provides | Requirements (see 03) |
|---|---|---|
| Worker | Public HTTPS entry, fast 200, runs in parallel copies, outbound HTTP, secrets. Holds no state. | 19 |
| Mailbox Durable Object | One live instance per key, one request at a time, its own durable storage, an alarm timer. Holds the queue, the seen-event record and the delivery state. | 24, 25, 26, 7, 27, 28 |
| AgentSession Durable Object | A place to run the agent in the background. `send()` returns at once. Stores nothing of its own today. | 19, 22 |
| Service binding (`DELIVERY_API`) | The AgentSession calls the Worker's delivery API without going over the public internet. | 18, 20 |

Not done by Cloudflare: the signature check (30) is the library; who may trigger (13, 14) is our `onMentioned`; the 👀 and the reply (2, 5) are provider API calls.

## What is tied to Cloudflare, and what is not

Verified by reading the package manifests and source on 2026-10-22:

| Package | Depends on | Cloudflare-tied |
|---|---|---|
| `channels-delivery` | `effect` | No |
| `channels-github` | `channels-delivery`, `effect` | No |
| `channels-jira` (vendored) | `channels-delivery`, `effect` | No |
| `channels-alchemy-cloudflare` | the above and `alchemy` | Yes, this is the adapter |

- The engine is generic. It talks to a store through three small services: `MailboxDelivery`, `MailboxProcessingBackend`, `DeliveryControlBackend`.
- The lifecycle rules (`DeliveryLifecycle.js`) are plain exported functions. The in-memory store (`MailboxBackendMemory.js`, 218 lines) uses them, so a store mostly loads state, applies a function, and saves it atomically.
- There is a polling entry point (`processReady`, `pollReadyMailboxes`), so a store without alarms can drive the engine.
- The library README names `channels-sql` (Postgres) and `channels-redis` stores. **(unverified)** They are not installed here and were not read. Doc 07 already assumes them for Azure and AWS.
- No DynamoDB store exists.

In our code, the Cloudflare coupling is small:

```text
GithubBot.ts  :5 ChannelsCloudflare  :27 RuntimeContext (alchemy)  :173 ChannelsCloudflare.make
JiraBot.ts    :19 RuntimeContext
both          AgentSessions (the seam: getByName(key).send(message))
other files   Worker.ts, DeliveryMailboxDO.ts, AgentSessionDO.ts, DeliveryApi.ts (binding), alchemy.run.ts
```

A second coupling is to the SDK's mailbox engine, not to Cloudflare: `onMentioned` takes a `DeliveryContext` and calls `context.handoff()`, and `AgentSessionMessage` carries `deliveryId` and `accessToken`.

## Proposed code split

```text
packages/core/      no cloud imports: mention handlers, JiraCommand, EchoAgent/EchoReply,
                    AgentSessionMessage, ports (AgentSessions, DeliveryApi tag)
infra/cloudflare/   Worker, DOs, binding layer, alchemy.run.ts, bot.ts (ChannelsCloudflare.make)
infra/aws/          the AWS wiring and Terraform
```

Edits in the shared code are small: drop the `RuntimeContext` type from `HandlerRequirements`, point `AgentSessions` at the port, and move the `ChannelsCloudflare.make` call to the platform folder. Three tests mention alchemy (`github-bot`, `jira-bot`, `jira-seam`).

## Mailbox key and what is stored

Key: `namespace|provider|installationId|resourceId`, each part written as `<length>:<text>`. Examples taken from the Cloudflare dashboard (2026-10-22):

```text
17:slop-code-factory|6:github|9:172722791|28:github:v1:1060207979:issue:7
17:slop-code-factory|4:jira|32:thecloudplumbingco.atlassian.net|19:jira:v1:issue:10000
```

- GitHub issues use `kind = issue`. Pull requests are unverified.
- Jira uses the numeric issue id, not `PROJ-42`, and the site host is part of the key.
- The Durable Object is addressed by this string. The AgentSession for the same discussion has the same name.

The SDK stores one record per mailbox (`DurableMailboxState`): `mailboxKey`, `provider`, `nextSequence`, `waiting[]` (each with `sequence`, `arrivedAt`, `admission`), and `deliveries.active` (`batchId`, `accessToken`, `admissions`, `attempt`, `claimId`, `stage`, `prepared`, `handedOffAt`, `failAt`, `terminal`) plus recent finished runs. The Cloudflare adapter keeps it through the key-value storage API.

Reference rules from the in-memory store:
- Dedup key is `namespace|provider|eventId`. A repeat is "accepted: false" and the webhook still gets 200.
- Events get growing sequence numbers. At due time the store claims "everything up to sequence N" as one batch.
- A mailbox with an active delivery cannot claim another.
- A claim has a lease. A dead worker's lease runs out and another attempt takes the same batch (same `batchId`, higher `attempt`).
- The callback and destination are saved before the callback runs.
- The reply is saved first (`terminal`), then posted by a separate output step with its own claim, retries and an idempotency key. A provider outage never re-runs the callback.

Debounce: the bot uses `Debounce {quietPeriodMs: 3000, maxWaitMs: 3000}`, so the batch is due at first event + 3 s and takes every waiting event. This replaces an earlier wrong note that "only the last mention is kept". The Jira README says the callback runs for the last mention of a batch. GitHub's handling was not checked.

## Proposed AWS shape

```text
GitHub -> API Gateway (HTTP API) -> Receiver Lambda -> SQS FIFO -> Processor Lambda -> GitHub
           POST /integrations/       verify, dedupe,    group=key    check, claim,        👀, 5 s wait,
           github/webhook            store event        delay 3 s    run echo, reply      reply
                                          \________________ DynamoDB ________________/
```

Terraform would create: one HTTP API route, two Lambdas (TypeScript bundled with esbuild), one SQS FIFO queue with a 3 s queue delay and a dead-letter queue, one DynamoDB table (on-demand, TTL), secrets in SSM or Secrets Manager, IAM roles, CloudWatch logs.

Mapping:

| Need | Cloudflare | AWS |
|---|---|---|
| Public entry, fast 200 | Worker | API Gateway + Lambda |
| One at a time per key | Durable Object | SQS FIFO message group, or a conditional-write lock in DynamoDB |
| Durable state, dedup | DO storage | DynamoDB |
| Timer | DO alarm | SQS delay and retry, or a poller |

SQS FIFO does not allow a per-message delay, only a queue-level delay. That fits a fixed 3 s debounce. SQS also cannot replace or cancel a message, so "latest" needs a record in DynamoDB. FIFO dedup lasts 5 minutes, so a permanent dedup record in DynamoDB is needed too.

Proposed table (a guess, path 1 shape; path 2 would store the SDK's state instead):

```text
PK = mailboxKey     SK = row type
 STATE           latestEventId, latestSequence, nextSequence, readyAt, status
 EVT#<seq>       sequence, eventId, arrivedAt, payload, handled
 RUN             batchId, accessToken, claimId, leaseUntil, attempt, stage, handedOffAt, reply, postAttempt
 SEEN#<eventId>  ttl
```

Known risk: reply posting is at least once. GitHub comments have no idempotency key, so a crash between posting and recording it could post twice.

## Open decision

| | Path 1: our own rules on SQS + DynamoDB | Path 2: a DynamoDB store for the SDK engine |
|---|---|---|
| Shared handlers | Change: split "decide" from "hand off". `deliveryId` and `accessToken` leave the message. | Unchanged. Only the bot wiring file changes. |
| A passing test proves | Our rules | The library's rules |
| Work | Smaller start, rules to keep in step | One store (about the size of the memory store, **(guess)**) plus a timer |
| Risk | Our copy drifts from the library | The store contract may be larger than it looks; `DeliveryLifecycle.js` (830 lines) was not fully read |

The owner first chose path 1, from a description that wrongly made the library sound tied to Cloudflare. The choice is open again.

## Other notes

- Data Studio (Cloudflare) works only on SQLite-backed objects and, per its docs, reads and writes only SQL-API data. The mailbox is stored through the key-value API, so the view may be empty or partial. Cloudflare dashboard on 2026-10-22 showed objects for GitHub issues 7 and 8, Jira issue 10000, plus two others named `slop-code-factory_DeliveryMailbox` and `mailbox`, purpose unknown. 901 requests and 13 errors in 7 days; the errors were not investigated.
- Jira understands only the `/research` command. `/plan` is ignored. GitHub treats any mention as a prompt.
- Akka was discussed as an optional agent runtime behind the HTTP delivery contract (research from the web on 2026-10-21; several details unconfirmed). It does not fit the broker itself. It is not part of this repo.
- Comparison with AWS: a Worker is close to API Gateway plus Lambda. A Durable Object has no single AWS equivalent; it is closest to SQS FIFO plus DynamoDB plus a timer.

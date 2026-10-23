# AWS control layer: design

Date: 2026-10-23. Status: draft for approval. Nothing is built. Background: [08-aws-control-layer](../../08-aws-control-layer.md). Requirement numbers refer to [03-user-requirements](../../03-user-requirements.md).

Items marked **(call)** are decisions I made and the owner has not confirmed. Items marked **(unverified)** were not checked against code or current docs.

## Intent

The broker (the control layer) runs on Cloudflare today. The goal is to run the same control layer on AWS and show that both deployments satisfy the same system requirements. The two deployments stay separate. They share the code that decides what the bot does, and each one owns only the wiring to its own cloud.

The agent stays the echo stub. The point is to test how events are received, ordered, deduplicated, delayed, retried and answered, not what an agent does.

## Goals

- One shared core with no cloud imports: mention rules, commands, the echo agent and reply, the agent message shape, and two ports (`AgentSessions`, `DeliveryApi`).
- `infra/cloudfare` keeps working throughout, with its tests green, on the SDK's own mailbox engine.
- `infra/aws` runs the same behaviour on API Gateway, Lambda, DynamoDB, and Terraform.
- One list of behaviour tests, written from the requirements, with no cloud in it. Each deployment passes the whole list.
- GitHub first. Jira on AWS comes after GitHub works.

## Non-goals

- A real agent, its workspace, or its model access.
- Identity and authorization beyond what exists today ([09-identity-and-authorization](../../09-identity-and-authorization.md)). The existing GitHub write-access check moves with the handlers unchanged.
- Teams or other channels.
- Renaming `infra/cloudfare`.
- Requirements outside the plumbing set in doc 03: 4, 6, 8 to 12, 15 to 21, 23, 29.

## Anti-goals

- A pass on AWS that proves only our own copy of the rules and not the requirements.
- Cloudflare behaviour changing as a side effect of the extraction.
- Cloud-specific imports (`alchemy`, `aws-sdk`) appearing in the core.

## Requirements in scope

Doc 03 lists 1, 2, 3 (minimal), 4 (activity at least), 5, 24 to 28 and 30 as the plumbing set. This design also covers the debounce (7, 21) and the stuck-job time limit (22), because both are in the current behaviour and in the proposed AWS flow.

## Decisions made by the owner

- Test the control layer only; no real agent.
- GitHub first; other channels later as more webhooks.
- Terraform.
- API Gateway, Lambda, DynamoDB.
- Cloudflare and AWS deployments stay separate and achieve the same requirements.
- Deploy to the owner's existing AWS account, region `ap-southeast-1` (Singapore). AWS announced durable functions for Singapore on 2025-12-18 (search result, not checked on the Capabilities by Region page); the spike confirms it. The account id and how credentials are supplied for Terraform are the builder's to settle with the owner.
- Use the same GitHub App for both deployments. Only one deployment is live at a time, and the App's webhook URL is switched between them. Both therefore use the same webhook secret, private key and bot user ID, and the App's installation id in the mailbox key stays the same. Because the URL changes by hand, a switch while an event is in flight is lost to the old deployment; this is accepted for testing.
- Write the mailbox rules ourselves on AWS ("path 1" in doc 08). The owner accepted this as part of the recommendation on 2026-10-23, after first choosing it earlier from a description that overstated the SDK's Cloudflare coupling. **Confirm this when reading.**
- Use a Lambda durable function for the delivery lifecycle, after a one-day spike. If the spike fails, fall back to SQS FIFO plus DynamoDB.

## Design

### Folder layout

```text
packages/core/      no cloud imports
infra/cloudfare/    Worker, Durable Objects, alchemy, ChannelsCloudflare wiring (unchanged behaviour)
infra/aws/          Terraform, Lambdas, DynamoDB access, durable function
```

Packaging of `packages/core` (npm workspaces, or a path dependency) **(call)**. The repo has a root `package.json` and `package-lock.json`; how they are set up was not checked.

### What moves

| Today in `infra/cloudfare/src` | Goes to | Change |
|---|---|---|
| `JiraCommand.ts`, `EchoReply.ts`, `AgentSessionMessage.ts` | core | move, no edits |
| `EchoAgent.ts` | core | move; uses the `DeliveryApi` port |
| `DeliveryApi.ts` | core (the tag), each cloud (the live layer) | split |
| `AgentSessionDO.ts` | core (`AgentSessions` tag), Cloudflare (the Durable Object) | split; remove `RuntimeContext` from the tag's type |
| `GithubBot.ts`, `JiraBot.ts` | core (handlers), Cloudflare (`ChannelsCloudflare.make`, line 173 of `GithubBot.ts`) | edit; drop `RuntimeContext` from `HandlerRequirements` |
| `Worker.ts`, `DeliveryMailboxDO.ts`, `alchemy.run.ts` | Cloudflare | stay |

Tests move with their file. `github-bot`, `jira-bot` and `jira-seam` mention alchemy and need the same edit.

### The handler split

On Cloudflare the SDK engine gives each mention callback a `DeliveryContext`, and the callback calls `context.handoff()`. The agent message carries `deliveryId` and `accessToken` taken from it. AWS path 1 has no `DeliveryContext`.

Each mention handler is split into:

- **decide** (core): is the author allowed, what is the prompt, which reaction or notice to send, what to react with on denial.
- **hand off** (per cloud): start the agent with the delivery details. On Cloudflare this is today's code. On AWS the deliveryId and token come from our own delivery record.

This is the largest edit and the main risk of path 1. The Cloudflare tests must stay green after it.

### The AWS flow

```text
GitHub -> API Gateway -> Receiver Lambda -> Starter Lambda -> durable execution
                          verify, dedupe,    take lock,        wait 3 s
                          save, answer 200   start execution   step: claim + echo callback
                                                               step: post reply
                                  DynamoDB <-- all of the above  callback: wait for /complete or /fail (10 min)
                                                               step: release lock, start next
```

- The Receiver verifies the signature (library code, platform-independent), saves the event, and answers 200 immediately.
- The execution is started asynchronously (sync is capped at 15 minutes). Its name is `hash(namespace|provider|eventId)`, which makes duplicate starts idempotent.
- The 3 s debounce is `context.wait`. Cloudflare's current setting is `Debounce {quietPeriodMs: 3000, maxWaitMs: 3000}`.
- The echo callback and the reply post are separate steps so a provider outage retries only the post (req 28).
- The agent's `/complete` and `/fail` on the delivery API call `SendDurableExecutionCallbackSuccess` or `Failure` with a callback id stored in DynamoDB. The callback timeout is 10 minutes, matching the bot's hand-off `failAfter` (`HANDOFF_FAIL_AFTER = '10 minutes'` in `GithubBot.ts` and `JiraBot.ts`). The SDK's own default is 24 hours; the bot overrides it. An earlier draft of this document and doc 04 said 24 hours.
- Pin the function to a numbered version or alias, never `$LATEST`. Attach a dead-letter queue.

### DynamoDB (shape is a guess)

```text
PK = mailboxKey     SK = row type
 STATE           nextSequence, active delivery id, status
 EVT#<seq>       sequence, eventId, arrivedAt, payload, handled
 RUN             deliveryId, accessToken, callbackId, stage, startedAt, terminal reply
 SEEN#<eventId>  ttl
```

The mailbox key format stays `namespace|provider|installationId|resourceId`, each part written `<length>:<text>`, so keys match Cloudflare's.

One run at a time per mailbox is enforced with a conditional write on `STATE`. A waiting event is a row. When a run ends, the finishing step starts the next waiting batch. The exact schema is the builder's to settle.

### Ports

```ts
AgentSessions.send(message)                // core -> agent, per conversation
DeliveryApi.complete({ deliveryId, accessToken, payload })   // agent -> broker
```

Both tags already exist in the repo. Cloudflare fills them with a Durable Object and a service binding. AWS fills them with a Lambda invoke (or direct call) and an HTTPS call to the delivery API.

### Shared behaviour tests

One list, no cloud in it, run against each deployment's wiring:

| Behaviour | Req |
|---|---|
| The same webhook twice gives one reply | 26 |
| Two comments close together become one run | 7, 21 |
| Two runs on one issue never overlap | 25 |
| Reply fails to post: retry the post, not the echo | 28 |
| Agent never completes: the delivery fails and frees the issue | 22, 27 |
| A bad signature is rejected | 30 |
| An event saved before a crash is processed after restart | 24 |
| A user without write access gets 👎 and one notice | 13 (GitHub, today's behaviour) |

How each deployment runs the list locally (Cloudflare harness, local DynamoDB) is the builder's to design **(call)**. A deployed smoke test on AWS is also needed.

### The spike (throwaway)

Three checks, about a day. Pass criteria:

0. Durable functions are offered in `ap-southeast-1` (announced, see above). If not, the spike stops here and the SQS fallback applies, or the owner picks another region.
1. Terraform creates a durable-execution-enabled function, a published version, and an alias, and invokes it by alias. **(unverified)**
2. An Effect-based handler runs inside `withDurableExecution` with all side effects in steps, and replays after a wait without error. **(unverified)**
3. A second Lambda calls `SendDurableExecutionCallbackSuccess` with an id read from DynamoDB and resumes the right execution. Documented, not tried.

If all three pass, build the durable-function version. If any fails with no easy workaround, build SQS FIFO (3 s queue delay, DLQ) plus DynamoDB plus a scheduled sweeper for lease expiry and the 24 h limit. The table, handlers and tests are the same for both.

### Order of work

1. Spike.
2. Extract the core; Cloudflare tests stay green.
3. Write the shared behaviour tests and pass them on Cloudflare.
4. Build `infra/aws` until the same tests pass.
5. Jira on AWS.

## Constraints

- Only one deployment may receive the App's webhooks at a time. If both did, both would reply to every mention. Switching means changing the webhook URL in the GitHub App settings. This stays a manual step; nothing in the design automates it.
- Durable function limits: 3,000 operations and 100 MB per execution; async invokes up to 1 year; sync invokes up to 15 minutes; 300 execution starts per second by default. No Lambda destinations (DLQ only). Chained invokes stay within one account.
- Async durable invokes are not retried by Lambda. A step can run more than once, so every step must be safe to repeat.
- Event source mappings do not give idempotency; a regular Lambda starts the execution with the name.
- Posting a GitHub comment has no idempotency key. A crash between posting and recording it could post twice. Needs a guard; the approach is the builder's to settle.
- The SDK's `DeliveryLifecycle.js` (830 lines) was not fully read. Parts of its rules may need copying (claim, lease, terminal reply).

## Left to the builder

- DynamoDB schema and the lock mechanics.
- How local runs of the shared tests work for each deployment.
- Lambda bundling, logging, alarms.
- Terraform state backend and module layout.
- How the guard against double-posting a reply works.

## Open questions

See the message that accompanies this document.

## Unverified

- Terraform support for durable functions; per-checkpoint size; default retention.
- Effect inside a replay.
- Whether pull requests use `kind = issue` in the mailbox key.
- How GitHub handles a batch of several mentions (Jira's README says the callback runs for the last mention).
- The `channels-sql` and `channels-redis` stores named in the SDK README.
- Cloudflare errors in the last 7 days (13 of 901 requests) were not investigated.

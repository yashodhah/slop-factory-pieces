# Broker Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cloudflare-deployed broker on the Channels SDK that receives a GitHub mention, hands it to an echo stub agent, and posts the stub's reply back on the issue or PR.

**Architecture:** The reference app `~/Projects/effect-channels/examples/alchemy-cloudflare` trimmed to its broker half: an Ingress Worker (webhook routes + delivery API), one `DeliveryMailbox` Durable Object per issue/PR, and one `onMentioned` callback. The callback calls `agentSessions.getByName(mailboxKey).send(message)` then `handoff()`. Behind that seam an `AgentSession` Durable Object holds an echo stub that finishes the delivery through the delivery API. Pi replaces the stub in Stage 2 without touching the broker.

**Tech Stack:** TypeScript, Effect 4.0.0, Alchemy 2.0.0-beta.83, `@humanlayer/channels-delivery|github|alchemy-cloudflare` 0.1.0 (npm), Bun 1.3, Vitest 5.0.1 + `@effect/vitest` 4.0.0, TypeScript 7.0.2.

**Spec:** `docs/04-architecture.md` (boundaries B1 to B6), `docs/06-starter-design-notes.md` (decision D1, working guesses G1 to G5). Scope is Stage 1 of the staged plan shown on 2026-10-18 (Stage 0 GitHub App is already done; Stages 2 and 3, Pi and tools, are out of scope here).

## Global Constraints

- All work is under `/Users/yashodhah/Projects/slop-factory-pieces/cloudfare/`. Do not touch `../scripts`, `../package.json`, or anything in `~/Projects/effect-channels`.
- Pins (copy from the SDK repo's catalog): `alchemy` 2.0.0-beta.83, `effect` 4.0.0, `@effect/platform-node` 4.0.0, `@effect/vitest` 4.0.0, `vitest` 5.0.1, `typescript` 7.0.2, `@cloudflare/workers-types` 5.20260929.1, `@types/bun` ^1.3.10, `@humanlayer/channels-*` 0.1.0.
- Mentions require **write access or higher**; others get a 👎 and, once per discussion, the `maintainerOnlyNotice` comment (behaviour of the reference `respondToMentionAccess`).
- Delivery mode: `DebounceDeliveryMode.make({ quietPeriodMs: 3_000, maxWaitMs: 3_000 })`. Event processing: `{ concurrency: 1, leaseMs: 10_000, maxAttempts: 5 }`.
- Env var names: `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_BOT_MENTION_NAME`, `GITHUB_BOT_USER_ID`. Secrets live in `cloudfare/.env` only; never committed, never printed.
- Keep the reference file and symbol names (`DeliveryMailbox`, `AgentSession`, `AgentSessions`, `AgentSessionMessage`, `DeliveryApi`, `githubHandlers`, `bot`) so the code stays diffable against the reference.
- Cloudflare compatibility date stays `2026-10-01` as in the reference.
- Git commits are made only if the user has agreed to commits for this repo. Commit steps below are the intended boundaries.

## Review Focus

1. Stub completes **before** the mailbox registers the handoff → completion must be retried until accepted, not fail the delivery. (Task 3 test)
2. Mention with an empty or whitespace-only body (`@bot` alone) → reply with the no-text wording, not a crash or empty comment. (Task 1 test)
3. Mention by a user without write access → 👎, notice posted once, no agent call, no handoff. (Task 4 test)
4. Mention on a pull request as well as on an issue → both reach the same `send` path with the right `mailboxKey`. (Task 4 test)
5. GitHub redelivers the same webhook → exactly one reply. Provided by the SDK; verified live in Task 6, not unit-tested.

---

## File Structure

```text
cloudfare/
├── package.json, tsconfig.json, vitest.config.ts, .env.example, .gitignore
├── alchemy.run.ts              # stack: IngressWorker only
├── src/
│   ├── EchoReply.ts            # pure: reply text from a prompt
│   ├── AgentSessionMessage.ts  # B5 message shape (trimmed from reference)
│   ├── EchoAgent.ts            # finishes a delivery with the echo reply via DeliveryApi
│   ├── AgentSessionDO.ts       # AgentSession Durable Object + AgentSessions service (thin)
│   ├── DeliveryApi.ts          # copied from reference (self service binding client)
│   ├── GithubBot.ts            # access check, mentionPrompt, onMentioned, bot
│   ├── DeliveryMailboxDO.ts    # copied from reference
│   └── Worker.ts               # IngressWorker (trimmed layers)
└── test/
    ├── support/delivery-context.ts   # fake DeliveryContext recording handoff
    ├── echo-reply.vi.test.ts
    ├── agent-session-message.vi.test.ts
    ├── echo-agent.vi.test.ts
    └── github-bot.vi.test.ts
```

---

### Task 1: Project setup and `echoReply`

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.gitignore`, `src/EchoReply.ts`
- Test: `test/echo-reply.vi.test.ts`

**Interfaces:**
- Produces: `export const echoReply: (prompt: string) => string` in `src/EchoReply.ts`.

- [ ] **Step 1: Set up the project.** `package.json` (`"type": "module"`, scripts `test` = `vitest --run`, `typecheck` = `tsc --noEmit -p tsconfig.json`, `alchemy:deploy` = `alchemy deploy`, `dev` = `alchemy dev`) with the pinned dependencies from Global Constraints. `tsconfig.json` copied from the reference `examples/alchemy-cloudflare/tsconfig.json`. `vitest.config.ts` includes `test/**/*.test.ts`. `.env.example` copied from the reference keeping only the five GitHub variables. `.gitignore`: `node_modules`, `.env`, `.alchemy`. Run `bun install`.
- [ ] **Step 2: Write the failing tests** in `test/echo-reply.vi.test.ts`:
  - `echoReply('hello there')` contains `Got it` and `"hello there"`.
  - `echoReply('   \n ')` equals `Got it (no text in the comment). The broker, mailbox, handoff and delivery API all worked.`
  - a 200-character prompt is quoted truncated to 80 characters followed by `…`.
- [ ] **Step 3: Run `bun run test`.** Expected: FAIL, `echoReply` not defined.
- [ ] **Step 4: Implement `echoReply`** in `src/EchoReply.ts`. Format: `Got it: "<first 80 chars>". The broker, mailbox, handoff and delivery API all worked.`; trimmed prompt, `…` appended only when truncated; empty case as in Step 2.
- [ ] **Step 5: Run `bun run test` and `bun run typecheck`.** Expected: PASS, no type errors.
- [ ] **Step 6: Commit** `chore: scaffold broker project with echoReply`.

---

### Task 2: `AgentSessionMessage` (the B5 message)

**Files:**
- Create: `src/AgentSessionMessage.ts`
- Test: `test/agent-session-message.vi.test.ts`

**Interfaces:**
- Consumes: `DeliveryId` from `@humanlayer/channels-delivery`; `GitHubIssue`, `GitHubPullRequest` from `@humanlayer/channels-github`.
- Produces (same names as the reference): `AgentSessionMessage` (Schema.Struct with `prompt: string`, `githubDiscussion: Union<[GitHubIssue, GitHubPullRequest]>`, `deliveryId: DeliveryId`, `accessToken: Schema.RedactedFromValue(Schema.String)`); `type AgentSessionMessage`; `targetOf(message): { deliveryId; accessToken }`. No `requestComments`.

- [ ] **Step 1: Write the failing test.** Encode then decode a message built from an issue and from a PR (fixtures as in the reference `mention-access.vi.test.ts`: `GitHubIssue.make({ ref, mailboxKey: 'github:issue:42' })`); the round trip equals the original; `targetOf` returns the same `deliveryId` and the redacted token; the encoded form does not print the token via `String(message.accessToken)`.
- [ ] **Step 2: Run `bun run test -- agent-session-message`.** Expected: FAIL.
- [ ] **Step 3: Implement** `src/AgentSessionMessage.ts` by trimming the reference file (drop `requestComments` and its `RequestComment` import).
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: AgentSessionMessage for the broker-to-agent seam`.

---

### Task 3: Echo agent and `AgentSession` Durable Object

**Files:**
- Create: `src/DeliveryApi.ts` (verbatim copy of the reference), `src/EchoAgent.ts`, `src/AgentSessionDO.ts`
- Test: `test/echo-agent.vi.test.ts`

**Interfaces:**
- Consumes: `echoReply`, `AgentSessionMessage`, `targetOf`, `DeliveryApi` (a `DeliveryClient`; read its `complete` signature in `@humanlayer/channels-delivery` types, `payload` is `{ markdown: string }` per the SDK README).
- Produces:
  - `export const answer: (message: AgentSessionMessage) => Effect.Effect<void, never, DeliveryApi>` in `src/EchoAgent.ts`. Calls `api.complete({ ...targetOf(message), payload: { markdown: echoReply(message.prompt) } })`, retrying as the reference `finishDelivery` does (every 10 seconds, up to 30 times, while the error is `DeliveryControlUnavailable` or `HttpClientError`) **and also while the delivery has not been handed off yet** (find the error tag the SDK returns for that in `packages/delivery/src/DeliveryControl.ts`; use it). `DeliveryClosed` is logged and treated as done. Any other failure is logged and swallowed.
  - `AgentSession` (Durable Object class) and `AgentSessions` (Context.Service with `getByName(mailboxKey)` returning `{ send: (input: typeof AgentSessionMessage.Encoded) => Effect<void, never, RuntimeContext> }`), same shapes as the reference. `send` decodes the message, checks `githubDiscussion.mailboxKey` equals the object's name (`state.id.name`), then starts `answer(message)` in the background (`Effect.forkDetach`) and returns immediately. Provides `AgentSessionDOLive` and `AgentSessions.layer`.

- [ ] **Step 1: Write the failing tests** in `test/echo-agent.vi.test.ts` using a fake `DeliveryApi` layer that records calls:
  - `answer` calls `complete` once with the message's `deliveryId`, token, and a markdown containing `Got it`.
  - When the fake `complete` fails twice with the not-handed-off error and then succeeds, `answer` completes with exactly three `complete` calls (use `TestClock` to advance the 10-second spacing).
  - When `complete` fails with `DeliveryClosed`, `answer` succeeds without further calls.
- [ ] **Step 2: Run `bun run test -- echo-agent`.** Expected: FAIL.
- [ ] **Step 3: Implement `answer`** in `src/EchoAgent.ts` as specified.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Implement `src/AgentSessionDO.ts`** by trimming the reference: no Workspace, Fold log, expiry or recovery; `send` and an empty-bodied `alarm` are enough. Copy `src/DeliveryApi.ts` verbatim.
- [ ] **Step 6: Run `bun run typecheck`.** Expected: no errors.
- [ ] **Step 7: Commit** `feat: echo agent behind the AgentSession seam`.

---

### Task 4: GitHub bot (`onMentioned`)

**Files:**
- Create: `src/GithubBot.ts`, `test/support/delivery-context.ts`
- Test: `test/github-bot.vi.test.ts`

**Interfaces:**
- Consumes: `AgentSessions`, `AgentSessionMessage` (Tasks 2, 3).
- Produces (reference names): `maintainerOnlyNotice: string` (unchanged text), `respondToMentionAccess(event: GitHubMentioned): Effect<boolean, ..., GitHubApi>` (copy from reference unchanged), `mentionPrompt(event: GitHubMentioned): string`, `githubHandlers` with only `onMentioned`, `bot` (`ChannelsCloudflare.make({ namespace: 'slop-code-factory', providers: [github], eventProcessing })`) with the Global Constraints values and `bot: Config.all({ mentionNames, botUserId })` as in the reference.
- `mentionPrompt`: for `GitHubIssueCommentCreated` / `GitHubPrCommentCreated` / `GitHubPrReviewCommentCreated` triggers, the comment body; for `GitHubIssueOpened` / `GitHubPrOpened`, title and body joined by a newline (skip a null body). No batching logic.
- `support/delivery-context.ts`: `makeFakeDeliveryContext(): { context: DeliveryContext; handoffCalls: () => number }` satisfying the SDK's `DeliveryContext` type with fixed `deliveryId`, `conversationId`, a redacted `accessToken`, and a `handoff` that counts calls.

- [ ] **Step 1: Write the failing tests.** Reuse the fixtures and fake `GitHubApi` / `MailboxSubscriptions` / `AgentSessions` layers from the reference `mention-access.vi.test.ts` (copy what is needed, no import from `packages/*/test`). Tests:
  - Authorized mention on an issue comment: `agentSessions.getByName('github:issue:42').send` is called once with `prompt` equal to the comment body, the context's `deliveryId`, and `handoff` is called once; an `eyes` reaction was added.
  - Authorized mention on a PR comment: same, with `'github:pr:43'`.
  - Mention with body `@agent` only: `send` is called (the prompt is passed through as written; Task 1 handles wording) and `handoff` once.
  - Author without write access: a `-1` reaction, the notice comment posted once (a second denied mention with the notice already present posts nothing), `send` and `handoff` never called.
  - `mentionPrompt` for an opened issue joins title and body; null body gives title only.
- [ ] **Step 2: Run `bun run test -- github-bot`.** Expected: FAIL.
- [ ] **Step 3: Implement `src/GithubBot.ts`** by trimming the reference: keep `gitHubMentionDiscussion`, `respondToMentionAccess`, `maintainerOnlyNotice`, `githubRepositoryLogAnnotations`; delete request-batching helpers, check-failure helpers, `AutoLabel`, `onIssueCreated`, `onPrCreated`, `onSubscribed*`. `onMentioned`: authorize, `discussion.subscribe()`, encode an `AgentSessionMessage` with `prompt: mentionPrompt(event)`, `send`, `return yield* context.handoff()`.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Run `bun run typecheck`.** Expected: no errors.
- [ ] **Step 6: Commit** `feat: GitHub bot with write-access mention handling`.

---

### Task 5: Mailbox Durable Object, Worker and stack

**Files:**
- Create: `src/DeliveryMailboxDO.ts` (copy of reference, no changes expected), `src/Worker.ts`, `alchemy.run.ts`

**Interfaces:**
- Consumes: `bot` (Task 4), `AgentSessions`, `AgentSessionDOLive`, `DeliveryApi` (Task 3).
- Produces: default export `IngressWorker` (`Cloudflare.Worker('IngressWorker', { main: import.meta.url, compatibility: { date: '2026-10-01' }, name: 'slop-code-factory', env: { [DELIVERY_API_BINDING]: Cloudflare.Workers.Self } }, ...)`) and the stack default export from `alchemy.run.ts` returning `{ url: worker.url }`.

- [ ] **Step 1: Copy `DeliveryMailboxDO.ts`.**
- [ ] **Step 2: Write `src/Worker.ts`** from the reference minus `AutoLabel`, `Photon`, `Cloudflare.Workers.AIBinding`. Keep `ChannelsDeliveryMailboxesLive`, `RoutesLive`, `AgentSessions.layer`, `AgentSessionDOLive`, `DeliveryApi.layerSelfBinding`, `GitHubApiLive`, `FetchHttpClient.layer`, `NodeCrypto.layer`, `RouterConfig`.
- [ ] **Step 3: Write `alchemy.run.ts`**: `Alchemy.Stack('SlopCodeFactoryBroker', { providers: Cloudflare.providers(), state: Cloudflare.state() }, ...)` yielding only `IngressWorker`.
- [ ] **Step 4: Run `bun run typecheck`.** Expected: no errors.
- [ ] **Step 5: Run `bun alchemy plan` with `.env` filled.** Expected: a plan creating one Worker and two Durable Object namespaces, with no container or AI binding, and no secret values printed. If Cloudflare authentication is missing, stop and ask the user to run `! bun alchemy login` or provide an API token.
- [ ] **Step 6: Commit** `feat: ingress worker, mailbox DO and alchemy stack`.

---

### Task 6: Deploy and live verification

**Files:**
- Modify: `../docs/06-starter-design-notes.md` (record results), `../README.md` (status line)

- [ ] **Step 1: Fill `cloudfare/.env`** with the GitHub App values (the user does this; do not read or echo them).
- [ ] **Step 2: Run `bun alchemy deploy`.** Expected: prints the Worker URL.
- [ ] **Step 3: Set the GitHub App's webhook URL** to `<worker url>/integrations/github/webhook` (the user does this in GitHub's app settings).
- [ ] **Step 4: Check webhook health.** GitHub App → Advanced → Recent Deliveries shows `200` for a ping. A `401` means the webhook secret differs between GitHub and `.env`.
- [ ] **Step 5: Happy path.** On the test repo, as a user with write access, comment `@<app-slug> hello` on an issue. Expected: 👀 on the comment within seconds, then a comment beginning `Got it: "@<app-slug> hello"`, and 👀 removed. Repeat on a pull request.
- [ ] **Step 6: Access rule.** From an account without write access (or a temporarily downgraded one), mention the bot. Expected: 👎 and one notice comment; a second denied mention adds no second notice.
- [ ] **Step 7: Redelivery.** In Recent Deliveries, redeliver the happy-path webhook. Expected: no second reply.
- [ ] **Step 8: Queueing.** Post two mentions within three seconds. Expected: handled as one batch, one reply per delivery with no overlap.
- [ ] **Step 9: Logs.** `bun alchemy logs --resource IngressWorker --since 10m --no-input` shows the delivery accepted and completed, with no errors.
- [ ] **Step 10: Record results** in `docs/06-starter-design-notes.md` (what passed, what surprised us, Alchemy beta issues) and update the README status. Commit `docs: record Stage 1 live results`.

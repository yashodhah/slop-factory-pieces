# Core Extraction and Shared Behaviour Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove durable functions work in `ap-southeast-1`, move everything cloud-neutral into `packages/core`, and pass one shared list of requirement tests on the Cloudflare deployment.

**Architecture:** `packages/core` holds the decisions (who may trigger, what the prompt is, the echo agent) and two ports. `infra/cloudfare` keeps the SDK mailbox engine and does the hand-off. The shared tests talk to a small driver interface, so the AWS deployment can pass the same list in a later plan.

**Tech Stack:** TypeScript, Effect 4, Vitest 5, Bun (`infra/cloudfare` uses `bun.lock`), the `@humanlayer/channels-*` packages, Terraform and AWS Lambda (spike only).

**Spec:** `docs/superpowers/specs/2026-10-23-aws-control-layer-design.md`

**Out of this plan:** `infra/aws` itself. Its tasks depend on the spike result (durable function or SQS fallback), so it is planned after Task 1.

## Global Constraints

- AWS region `ap-southeast-1`; the owner's existing account.
- Cloudflare behaviour must not change; every existing test in `infra/cloudfare/test` stays green after each task.
- `packages/core` imports no `alchemy`, `@humanlayer/channels-alchemy-cloudflare`, `@cloudflare/*`, or `@aws-sdk/*`.
- Mailbox key format stays `namespace|provider|installationId|resourceId`, each part written `<length>:<text>`; namespace `slop-code-factory`.
- Debounce stays `Debounce {quietPeriodMs: 3000, maxWaitMs: 3000}`; event processing stays `concurrency: 1, leaseMs: 10_000, maxAttempts: 5`.
- Keep the folder name `infra/cloudfare`.
- The working tree has unrelated uncommitted changes (`docs/README.md`, deleted plan and spec files, docs 08 and 09). Never `git add -A` or `git add .`; add only the files a task names.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Failure modes the spec implies that no obvious task would test. Each has a test in Task 6.

- A webhook with a bad signature: rejected with no reaction, no comment, no agent start (B9).
- The same webhook redelivered after its run finished: still no second reply (B2).
- Mentions on two different issues at once: neither blocks the other (B5).
- A pull request mention, whose mailbox key `kind` is unverified: handled like an issue mention (B12).
- The agent calling complete after the delivery already timed out: ignored, no second reply (B8).

## File Structure

```text
packages/core/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts                 public exports
  src/JiraCommand.ts           moved
  src/EchoReply.ts             moved
  src/AgentSessionMessage.ts   moved
  src/Ports.ts                 AgentSessions and DeliveryApi tags
  src/EchoAgent.ts             moved
  src/GithubMention.ts         decideGitHubMention (access check, reactions, prompt)
  src/JiraMention.ts           decideJiraMention (policy, command, ack, issue fetch, prompt)
  src/conformance/driver.ts    ControlLayerDriver interface
  src/conformance/suite.ts     defineControlLayerSuite(driver)
infra/cloudfare/src/
  Handoff.ts                   handOff(request, context): builds the message, sends it, calls context.handoff
  GithubBot.ts, JiraBot.ts     provider config plus thin onMentioned = decide, then handOff
  AgentSessionDO.ts            Durable Object plus the Cloudflare layer that fills the AgentSessions port
  DeliveryApi.ts               the Cloudflare layer that fills the DeliveryApi port
infra/cloudfare/test/
  support/memory-driver.ts     ControlLayerDriver over Channels.make + ChannelsMemory
  control-layer.vi.test.ts     runs defineControlLayerSuite
```

---

### Task 1: Durable function spike (throwaway)

No TDD; the output is a result note. The spike code is deleted at the end.

**Files:**
- Create (temporary): `spike/aws-durable/` (Terraform, two small Lambdas)
- Create: `docs/superpowers/spikes/2026-10-23-durable-spike-result.md`

**Interfaces:**
- Produces: a pass or fail per check in the result note, and one line: "build durable" or "build SQS fallback". Plan 2 depends on it.

- [ ] **Step 1: Check 0, region.** Terraform-create any durable-enabled function in `ap-southeast-1`. If the region refuses, stop, record it, and ask the owner whether to pick another region or use the fallback.
- [ ] **Step 2: Check 1, Terraform.** In Terraform, create a Node.js 24 function with durable execution enabled, publish a numbered version, create an alias, and invoke it asynchronously by alias. Find the provider argument names from the AWS provider docs; do not guess them. Record the exact arguments used.
- [ ] **Step 3: Check 2, Effect inside replay.** The handler is wrapped in `withDurableExecution` from `@aws/durable-execution-sdk-js`. It does: `context.step` running an `Effect.runPromise` that logs a marker, `context.wait({ seconds: 3 })`, then a second step. Pass when the logs show the first step's marker once, the handler body twice, and the execution succeeds.
- [ ] **Step 4: Check 3, callback from a second Lambda.** The handler calls `context.createCallback`, writes the callback id to a DynamoDB item keyed by a test delivery id, then awaits it. A second Lambda reads the id and calls the Lambda client's `SendDurableExecutionCallbackSuccess` command (confirm the exact command name in the installed `@aws-sdk/client-lambda`). Pass when the first execution resumes with the sent result.
- [ ] **Step 5: Idempotent start.** Start two executions with the same execution name and identical payload (confirm the CLI/SDK parameter name). Pass when the second returns the first's execution and no second execution exists. Start a third with a different payload and record the `DurableExecutionAlreadyStartedException`.
- [ ] **Step 6: Write the result note and destroy.** The note lists each check with pass or fail, the Terraform arguments, any workaround, and the decision line. Run `terraform destroy`, delete `spike/`.
- [ ] **Step 7: Commit** only the result note.

```bash
git add docs/superpowers/spikes/2026-10-23-durable-spike-result.md
git commit -m "docs: durable function spike result"
```

---

### Task 2: Core package scaffold and the pure files

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`
- Move: `infra/cloudfare/src/{JiraCommand,EchoReply,AgentSessionMessage}.ts` to `packages/core/src/`
- Move: `infra/cloudfare/test/{jira-command,echo-reply,agent-session-message}.vi.test.ts` to `packages/core/test/`
- Modify: `infra/cloudfare/package.json` (depend on core), every cloudfare import of the moved files

**Interfaces:**
- Produces: package `@slop/core` exporting everything from `src/index.ts`. Consumers import from `@slop/core`, never from deep paths.

- [ ] **Step 1: Failing canary test** `packages/core/test/canary.vi.test.ts`: imports `Effect` from `effect` and `DeliveryId` from `@humanlayer/channels-delivery` and `parseCommand` from `../src/JiraCommand`, asserts `parseCommand('/research x')` is `Option.some({ name: 'research', args: 'x' })`. Run `bun run test` in `packages/core`. Expected: FAIL (module not found).
- [ ] **Step 2: Scaffold the package.** Same strict `tsconfig` options as `infra/cloudfare/tsconfig.json` minus `WebWorker`, `bun` and `@cloudflare/workers-types` types. `package.json` has `"name": "@slop/core"`, `"exports": { ".": "./src/index.ts" }`, scripts `test` and `typecheck` mirroring `infra/cloudfare`. The shared libraries (`effect`, the three `@humanlayer/channels-*` packages) must resolve to the same copies `infra/cloudfare` uses, including the vendored Jira tarball. Choose the install layout that achieves this (workspaces or path dependency) and record the choice in the commit message.
- [ ] **Step 3: Move the three files and their tests** with `git mv`; fix imports; export them from `src/index.ts`. In `infra/cloudfare`, replace their relative imports with `@slop/core`.
- [ ] **Step 4: Verify.** Run `bun run test` and `bun run typecheck` in both `packages/core` and `infra/cloudfare`. Expected: all pass, test counts unchanged apart from the canary.
- [ ] **Step 5: Add a guard test** `packages/core/test/no-cloud-imports.vi.test.ts` that reads every file under `packages/core/src` and fails if any import path starts with `alchemy`, `@cloudflare/`, `@aws-sdk/`, or `@humanlayer/channels-alchemy-cloudflare`. Run it; expected PASS.
- [ ] **Step 6: Commit** (explicit paths only).

---

### Task 3: Ports without `RuntimeContext`

**Files:**
- Create: `packages/core/src/Ports.ts`
- Modify: `infra/cloudfare/src/AgentSessionDO.ts`, `infra/cloudfare/src/DeliveryApi.ts`, `infra/cloudfare/src/Worker.ts`, `infra/cloudfare/src/GithubBot.ts:27,121`, `infra/cloudfare/src/JiraBot.ts:19,54`
- Modify: `infra/cloudfare/test/{github-bot,jira-bot,jira-seam}.vi.test.ts` (drop the `RuntimeContext` layer)

**Interfaces:**
- Produces in `Ports.ts`:
  - `class AgentSessions extends Context.Service<AgentSessions, { readonly getByName: (mailboxKey: string) => { readonly send: (input: typeof AgentSessionMessage.Encoded) => Effect.Effect<void> } }>()('slop-code-factory/AgentSessions')`
  - `class DeliveryApi extends Context.Service<DeliveryApi, DeliveryClient>()('slop-code-factory/DeliveryApi')`
- Cloudflare produces layers that fill both. The old `AgentSessions.layer` and `DeliveryApi.layerSelfBinding` become `AgentSessionsCloudflare` and `DeliveryApiCloudflare`.

- [ ] **Step 1: Make the three tests fail first.** Remove the `RuntimeContext` import and layer from `github-bot`, `jira-bot` and `jira-seam` tests; import `AgentSessions` from `@slop/core`. Run `bun run typecheck && bun run test` in `infra/cloudfare`. Expected: FAIL (types and missing tag).
- [ ] **Step 2: Write `Ports.ts`** with the two tags above and export them.
- [ ] **Step 3: Cloudflare fills the ports.** `AgentSessionsCloudflare` wraps the Durable Object namespace and supplies `RuntimeContext` itself, so callers see `Effect<void>`. **Check first** that `RuntimeContext` can be provided from where the layer is built (the Worker's request context). If it cannot, fall back: keep `RuntimeContext` as a type parameter of the core tag's `send`, record why in the commit message, and tell the owner, because this changes the spec's "drop `RuntimeContext`" edit.
- [ ] **Step 4: Update `Worker.ts`, `GithubBot.ts`, `JiraBot.ts`** to use the new names and drop `RuntimeContext` from `HandlerRequirements`.
- [ ] **Step 5: Verify.** `bun run typecheck && bun run test` in `infra/cloudfare`. Expected: PASS.
- [ ] **Step 6: Commit.**

---

### Task 4: Move the echo agent

**Files:**
- Move: `infra/cloudfare/src/EchoAgent.ts` to `packages/core/src/EchoAgent.ts`; test `echo-agent.vi.test.ts` to `packages/core/test/`
- Modify: `infra/cloudfare/src/AgentSessionDO.ts` (import `answer` from `@slop/core`)

**Interfaces:**
- Consumes: `DeliveryApi` from Task 3.
- Produces: `answer(message: AgentSessionMessage): Effect<void, never, DeliveryApi>` and `MOCK_WORK_DURATION`, exported from core.

- [ ] **Step 1:** `git mv` both files; change the `DeliveryApi` import to `./Ports`; fix test imports.
- [ ] **Step 2: Verify** in both packages: `bun run typecheck && bun run test`. Expected: PASS, echo-agent test count unchanged.
- [ ] **Step 3: Commit.**

---

### Task 5: Split each mention handler into decide and hand off

**Files:**
- Create: `packages/core/src/GithubMention.ts`, `packages/core/src/JiraMention.ts`, `infra/cloudfare/src/Handoff.ts`
- Modify: `infra/cloudfare/src/GithubBot.ts`, `infra/cloudfare/src/JiraBot.ts`
- Test: `packages/core/test/github-mention.vi.test.ts`, `packages/core/test/jira-mention.vi.test.ts`

**Interfaces:**
- Produces in core:
  - `type MentionRequest = { readonly prompt: string; readonly discussion: AgentSessionMessage['discussion'] }`
  - `decideGitHubMention(event: GitHubMentioned): Effect<Option<MentionRequest>, GitHubApiError | Config.ConfigError, GitHubApi>`. Runs `respondToMentionAccess`, which moves here with `maintainerOnlyNotice`, and `mentionPrompt`. `None` when denied.
  - `decideJiraMention(event: JiraMentioned, options?: { authorize? }): Effect<Option<MentionRequest>, never, JiraApi>`. Policy, command parse, 👀 acknowledgement, issue fetch, `jiraPrompt`. Keeps `authorizeJiraMention`, `JIRA_ACK_MARKDOWN`, the 5 s timeouts.
- Produces in Cloudflare: `handOff(request: MentionRequest, context: DeliveryContext): Effect<DeliveryHandoff, DeliveryHandoffError, AgentSessions>`. Encodes `AgentSessionMessage` with `context.deliveryId` and `context.accessToken`, sends it to `AgentSessions.getByName(request.discussion.mailboxKey)`, then `context.handoff({ failAfter: '10 minutes' })`. `HANDOFF_FAIL_AFTER` lives here.
- `githubHandlers.onMentioned` and `makeJiraHandlers().onMentioned` keep their exported names and signatures, now: decide, return if `None`, else `handOff`.

- [ ] **Step 1: Failing core tests.** `github-mention`: with a fake `GitHubApi` whose access is `'write'`, `decideGitHubMention` returns `Some` with `prompt` equal to the comment body and the 👀 reaction added; with access `'read'`, returns `None`, adds a `-1` reaction, and posts the notice once. `jira-mention`: with a known `/research` command returns `Some` and posts the `👀 On it` comment; with an unknown command or `authorize` returning `false`, returns `None` and posts nothing. Copy the fakes from the existing `github-bot` and `jira-bot` tests rather than inventing new ones. Run; expected FAIL.
- [ ] **Step 2: Implement `decideGitHubMention` and `decideJiraMention`** by moving the existing logic out of the handlers, unchanged.
- [ ] **Step 3: Implement `Handoff.ts`** and rewrite both `onMentioned` handlers as decide-then-hand-off. Keep their log annotations.
- [ ] **Step 4: Verify.** Run both packages' tests and typecheck. The existing `github-bot`, `jira-bot` and `jira-seam` tests are unchanged apart from Task 3 and must still pass; they are the proof that Cloudflare behaviour did not change.
- [ ] **Step 5: Commit.**

---

### Task 6: Shared behaviour suite, passing on Cloudflare

**Files:**
- Create: `packages/core/src/conformance/driver.ts`, `packages/core/src/conformance/suite.ts`
- Create: `infra/cloudfare/test/support/memory-driver.ts`, `infra/cloudfare/test/control-layer.vi.test.ts`

**Interfaces:**
- Produces in `driver.ts`:

```ts
export interface ControlLayerDriver {
  readonly postGitHubMention: (input: {
    eventId: string; kind: 'issue' | 'pr'; number: number; author: string; body: string; signature: 'valid' | 'invalid'
  }) => Effect.Effect<{ status: number }>
  readonly advance: (ms: number) => Effect.Effect<void>
  readonly agentStarts: Effect.Effect<ReadonlyArray<{ deliveryId: string; mailboxKey: string; prompt: string }>>
  readonly completeDelivery: (deliveryId: string) => Effect.Effect<void>
  readonly output: Effect.Effect<{ reactions: ReadonlyArray<string>; comments: ReadonlyArray<string> }>
  readonly failNextCommentPosts: (count: number) => Effect.Effect<void>
  readonly setAuthorAccess: (login: string, access: 'none' | 'read' | 'write') => Effect.Effect<void>
  readonly restart: Effect.Effect<void>
}
```

- Produces in `suite.ts`: `defineControlLayerSuite(name: string, make: Effect<ControlLayerDriver, never, Scope>, options?: { skip?: Partial<Record<BehaviourId, string>> }): void`. A skip needs a reason string and is printed.

Behaviours, each one `it` named `B<n> <description> (req <n>)`:

| Id | Behaviour | Req |
|---|---|---|
| B1 | The same webhook posted twice while running gives one agent start | 26 |
| B2 | The same webhook posted again after the run completed gives no second reply | 26 |
| B3 | Two mentions inside 3 s on one issue become one agent start | 7, 21 |
| B4 | A second mention on a busy issue waits; it starts only after the first completes | 25 |
| B5 | Mentions on two issues both start without waiting for each other | 25 |
| B6 | A failed comment post is retried and the echo agent is not started again | 28 |
| B7 | An agent that never completes: after the hand-off timeout the delivery fails and the next mention starts | 22, 27 |
| B8 | Completing a delivery that already timed out posts nothing | 22 |
| B9 | An invalid signature returns an error status and has no reaction, comment or agent start | 30 |
| B10 | A mention saved before `restart` is processed after it | 24 |
| B11 | An author without write access gets a `-1` reaction and one notice, no agent start | 13 |
| B12 | A mention on a pull request starts the agent like an issue | 5 |

- [ ] **Step 1: Write `driver.ts` and `suite.ts`** with all twelve behaviours as `it` blocks against the driver. Run `bun run typecheck` in `packages/core`. Expected: PASS.
- [ ] **Step 2: Failing run.** In `control-layer.vi.test.ts` call `defineControlLayerSuite('cloudflare', makeMemoryDriver)`; with `makeMemoryDriver` still a stub that throws, run `bun run test` in `infra/cloudfare`. Expected: FAIL on all twelve.
- [ ] **Step 3: Implement `makeMemoryDriver`** over `Channels.make` with `ChannelsMemory.make({ polling })` from `@humanlayer/channels-delivery`, the real Cloudflare-side bot configuration from `GithubBot.ts` (so the real handlers and `handOff` run), a fake `GitHubApi` recording reactions and comments, a fake `AgentSessions` recording starts, a fake `DeliveryApi` client wired to `completeDelivery`, and `TestClock` for `advance`. Webhooks are signed with HMAC-SHA256 as `jira-seam.vi.test.ts` does, using the `x-hub-signature-256` header. `restart` rebuilds the processing layer over the same in-memory store. The driver file is the one place that knows the SDK's wiring.
- [ ] **Step 4: Make the suite pass.** Fix driver gaps first. If a behaviour cannot be observed on this driver (likely B10 if the memory store cannot survive a rebuild, or B7's timing), pass it in `skip` with a written reason and tell the owner; do not weaken the assertion.
- [ ] **Step 5: Verify.** `bun run test` and `bun run typecheck` in both packages. Expected: PASS, with any skips listed.
- [ ] **Step 6: Commit.**

---

## Self-review notes

- Spec coverage: layout, moves, ports, handler split, shared tests, spike (checks 0 to 3) and order of work are covered. The AWS build, Jira on AWS, and the DynamoDB schema are left to plan 2 by design.
- Unverified inside this plan: that `RuntimeContext` can be supplied by the Cloudflare layer (Task 3, with a fallback), that the memory store supports restart (Task 6, with an explicit skip path), and the install layout for `packages/core` (Task 2).

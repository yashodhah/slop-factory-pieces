# Jira Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Jira comment `@slopcodebot /research` on an issue reaches the broker's `AgentSession`, and the mock agent's reply is posted back as a comment by the bot user.

**Architecture:** A new `packages/jira` provider in the user's fork of the SDK (`/Users/yashodhah/Projects/effect-channels`, `origin` = `git@github.com:yashodhah/effect-channels.git`), modeled on `packages/github` (text-mention parsing, `onMentioned`, comment output) with Linear's layout as the secondary reference. This repo (`infra/cloudfare`) links the package, registers it next to GitHub, and owns the `/research` command parsing, the access policy (none for now) and the mock agent.

**Tech Stack:** TypeScript, Effect 4.0.0, `@effect/vitest`, Bun, Alchemy 2.0.0-beta.83 (as pinned in `infra/cloudfare/package.json`), Jira Cloud REST API v3.

**Spec:** `docs/superpowers/specs/2026-10-19-jira-channel-design.md`. Read it first; this plan only adds names, signatures and order.

## Global Constraints

- Two repos. SDK work (Tasks 1 to 5) is in `/Users/yashodhah/Projects/effect-channels` on a new branch `jira-channel`, commits there. Broker work (Tasks 6 to 8) is in `/Users/yashodhah/Projects/slop-factory-pieces` on `broker-stage-1`.
- `effect` and `@effect/*` stay at 4.0.0 in both repos. No new dependencies in the SDK package beyond what `packages/github/package.json` has (`@humanlayer/channels-delivery: workspace:*`, same dev/peer deps).
- `providerName` is `'jira'`; the webhook is served at `<base>/integrations/jira/webhook`.
- Mailbox resource id: `jira:v1:issue:<issueId>`; installation id: the Jira cloud id if the payload carries it, else the `site` option (the site's host).
- Only `comment_created` is handled; `comment_updated` and everything else are `ProviderWebhookIgnored`. Comments authored by the bot's account id never reach `onMentioned`. A comment that does not mention the bot's account id never reaches `onMentioned`.
- The package knows nothing about slash commands. `/research` is parsed in this repo. A mention with a missing or unknown command produces no reply and no agent run.
- No Jira permission check in this round (spec: deferred), but the handler keeps the access check as a separate step beside the command parse.
- Jira has no reactions: `reactionTargets: []`, and `SetMessageReaction` and `SetActivity` are not in `supportedOperations`.
- Env names in this repo: `JIRA_WEBHOOK_SECRET`, `JIRA_BASE_URL`, `JIRA_BOT_EMAIL`, `JIRA_API_TOKEN`, `JIRA_BOT_ACCOUNT_ID`. Secrets only in `.env` (never committed or printed); add names to `.env.example`.
- Dependency link: `infra/cloudfare/package.json` points `@humanlayer/channels-jira` at `link:../../../effect-channels/packages/jira`. Do not publish.
- Commit steps are the intended boundaries. Co-author line as in the repo's recent commits.

## Review Focus

1. The bot's own reply comment arrives as a `comment_created` event that mentions nothing, or quotes `@slopcodebot /research` → must not start a run (loop). Tasks 2 and 3 pin it.
2. An edited comment (`comment_updated`) that now contains the mention → ignored. Task 2.
3. `@slopcodebot` with no command, `@slopcodebot hello`, `@slopcodebot /foo` → no reply, no agent call, delivery still ends cleanly. Task 7.
4. Jira redelivers the same webhook, or several mentions land in one debounce window → one run per delivery, stable `eventId`. Task 2 (stable id) and Task 3 (batch).
5. Mention nested inside a quote, list or after other text, and `/Research` in another case → found and parsed. Tasks 3 and 7.

---

## File Structure

SDK, `packages/jira/` (names are suggestions; follow `packages/github/src` layout):

```text
package.json, tsconfig.json                 # copy of packages/github's, renamed @humanlayer/channels-jira
src/JiraIdentity.ts                         # ids and resource id
src/JiraWebhookSignature.ts                 # verify per spike findings
src/JiraWebhookSchemas.ts                   # headers + comment_created schema
src/JiraWebhookProvider.ts                  # WebhookProvider
src/JiraComment.ts                          # comment body -> plain text, mentioned account ids
src/JiraCallbackEvents.ts, JiraCallbacks.ts # JiraMentioned, onMentioned handler type
src/JiraEventProcessor.ts                   # batch -> prepare -> onMentioned
src/JiraApi.ts, JiraApiLive.ts              # postComment, fetchIssue, myself
src/JiraDeliveryDestination.ts              # destination JSON, supported operations
src/JiraDeliveryOutput.ts                   # PresentOutcome/CreateMessage -> comment
src/JiraBot.ts, src/index.ts
test/fixtures.ts, test/fixtures/*.json, test/jira-*.vi.test.ts
```

Broker, `infra/cloudfare/`: new `src/JiraBot.ts`, `src/JiraCommand.ts`; modified `src/AgentSessionMessage.ts`, `src/AgentSessionDO.ts`, `src/GithubBot.ts` (field rename only), `src/Worker.ts`, `alchemy.run.ts` or wherever the `GITHUB_*` variables are declared, `.env.example`, `package.json`; tests next to the existing ones.

---

### Task 1: Spike on the real Jira site (gating)

Needs the user: a bot user, its API token, a way to expose a local port (a tunnel they already use), and admin rights to register a system webhook with a secret. Ask for these; never print the token.

**Files:**
- Create (SDK repo): `packages/jira/test/fixtures/*.json`, `packages/jira/SPIKE.md` (findings, deleted or folded into README at the end)

**Interfaces:**
- Produces: the recorded facts later tasks rely on: (a) signature header name and format, or "none"; (b) whether `comment_created` carries the comment body as ADF or a string; (c) the mention shape for a mentioned account; (d) whether the payload carries a cloud id or site url; (e) a stable per-delivery id header, if any; (f) the shape accepted by `POST /rest/api/3/issue/{key}/comment` and the bot's own account id from `GET /rest/api/3/myself`.

- [ ] **Step 1:** Create branch `jira-channel` in the SDK repo.
- [ ] **Step 2:** Run a throwaway local server (not committed; keep it in the scratchpad) that writes each request's headers and raw body to files; expose it through a tunnel; register the system webhook (event `comment_created` and `comment_updated`, optional JQL project filter, a secret) pointing at it.
- [ ] **Step 3:** On a test issue, post: a comment mentioning the bot with `/research`, a plain comment, an edit of one, and a comment by the bot user (post it with the token via curl). Save each body as a redacted fixture (`comment-created-mention.json`, `comment-created-plain.json`, `comment-updated.json`, `comment-created-by-bot.json`) plus the header set.
- [ ] **Step 4:** Verify by hand that the signature, if present, validates against the raw body with the chosen secret (HMAC-SHA256, hex), and that curl `POST /rest/api/3/issue/<key>/comment` with a minimal ADF paragraph posts a comment authored by the bot.
- [ ] **Step 5:** Write the findings (a to f) in `packages/jira/SPIKE.md`. If (a) is "none", record the fallback chosen (shared secret in a custom header or the URL, compared in constant time) and tell the user.
- [ ] **Step 6: Commit** `chore(jira): record webhook fixtures and spike findings`.

---

### Task 2: Package scaffold, identity, signature, webhook provider

**Files:**
- Create: `packages/jira/package.json`, `tsconfig.json`, `src/JiraIdentity.ts`, `src/JiraWebhookSignature.ts`, `src/JiraWebhookSchemas.ts`, `src/JiraWebhookProvider.ts`, `src/index.ts`, `test/fixtures.ts`
- Test: `test/jira-webhook-signature.vi.test.ts`, `test/jira-webhook-routing.vi.test.ts`
- Modify: `scripts/release/manifest.ts:9` (add `'jira'` to `libraries`, after `'delivery'`)

**Interfaces:**
- Produces, in `JiraIdentity.ts`: `JiraAccountId`, `JiraIssueId` (branded strings, `Schema`), `jiraIssueResourceId(input: { readonly issueId: JiraIssueId }): string` returning `jira:v1:issue:<issueId>` (encoded like `githubDiscussionResourceId`).
- Produces: `verifyJiraWebhookSignature(input: { body: Uint8Array; signature: string; webhookSecret: Redacted<string> }): Effect<void, WebhookAuthenticationError, Crypto.Crypto>` (mirror `verifyGitHubWebhookSignature`; header and format from SPIKE.md).
- Produces: `makeJiraWebhookProvider(options: { readonly namespace: string; readonly webhookSecret: Redacted<string>; readonly site: string }): WebhookProvider<Crypto.Crypto>` with `providerName: 'jira'`.
- Produces in `test/fixtures.ts`: `signedJiraInput(fixture: string, secret: string): WebhookInput` (signs a fixture with the same algorithm).

- [ ] **Step 1: Failing tests** in `jira-webhook-signature.vi.test.ts`: a body signed with the secret passes; a wrong secret fails with `WebhookAuthenticationError{reason:'invalid_signature'}`; a missing/malformed header fails the same way.
- [ ] **Step 2: Failing tests** in `jira-webhook-routing.vi.test.ts` (copy the shape of `packages/github/test/github-webhook-routing.vi.test.ts`):
  - `comment-created-mention.json` → `ProviderWebhookEvent` whose admission has `provider: 'jira'`, `resourceId` equal to `jiraIssueResourceId` of the fixture's issue id, and `eventId` equal to the stable id from SPIKE.md (the delivery header if any, else the comment id), identical on two deliveries of the same fixture;
  - `comment-updated.json` → `ProviderWebhookIgnored`;
  - an unsupported `webhookEvent` → `ProviderWebhookIgnored`; invalid JSON → `WebhookPayloadInvalidError{reason:'invalid_json'}`.
- [ ] **Step 3:** Run `bun run test packages/jira` from the SDK root (`vp test` per root script). Expected: FAIL, modules missing.
- [ ] **Step 4:** Implement the files above. Package files: copy `packages/github/package.json` and `tsconfig.json`, rename to `@humanlayer/channels-jira`, drop the `@emulators/*` dev dependencies. Webhook provider follows `makeGitHubWebhookProvider`: verify signature, decode JSON, decode the schema from SPIKE.md, ignore unsupported, admit with `installationId` = payload cloud id when present, else `options.site`.
- [ ] **Step 5:** Run the two test files and `bun run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(jira): webhook provider with signature verification`.

---

### Task 3: Comment parsing, callback events, event processor

**Files:**
- Create: `src/JiraComment.ts`, `src/JiraCallbackEvents.ts`, `src/JiraCallbacks.ts`, `src/JiraEventProcessor.ts`, `src/JiraDeliveryDestination.ts`
- Test: `test/jira-comment.vi.test.ts`, `test/jira-event-processing.vi.test.ts`

**Interfaces:**
- Consumes: Task 2's identity, schemas and provider.
- Produces, `JiraComment.ts`: `commentPlainText(body: unknown): string` (ADF or string per SPIKE.md; mentions rendered as `@<displayName>`); `mentionedAccountIds(body: unknown): ReadonlyArray<string>` (walks nested ADF content); `textAfterMention(body: unknown, accountId: string): string | undefined` (plain text following the first mention of that account, trimmed).
- Produces, `JiraCallbackEvents.ts`: `JiraIssueRef`, a `Schema.Struct` (`{ id: JiraIssueId; key: string; mailboxKey: string }`) and `JiraMentioned` (`{ _tag: 'JiraMentioned'; issue: JiraIssueRef; comment: { id: string; body: string; afterMention: string; author: { accountId: string; displayName: string } }; eventId: string }`).
- Produces, `JiraCallbacks.ts`: `JiraCallbackHandlers<E, R>` with optional `onMentioned: (event: JiraMentioned, delivery: DeliveryContext) => Effect<DeliveryCallbackResult, E, R>`, `makeJiraCallbacks`, `JiraCallbackError` (same wrapping and retryability rules as `GitHubCallbacks.ts`).
- Produces, `JiraEventProcessor.ts`: `JiraBotConfiguration` (`{ accountId: JiraAccountId }`) and `makeJiraEventProcessor<E, R>(options: { namespace: string; bot: JiraBotConfiguration; handlers: JiraCallbackHandlers<E, R> }): ProviderEventProcessor<JiraApi | R>`.
- Produces, `JiraDeliveryDestination.ts`: `JiraDeliveryDestination` (tagged `JiraIssue { issue: JiraIssueRef }`), `jiraPresentationVersion = 1`, `jiraSupportedOperations: ReadonlyArray<DeliveryOperationKind>` (`PresentOutcome`, `CreateMessage`, `UpdateMessage`, `DeleteMessage`), JSON codec.

- [ ] **Step 1: Failing tests** `jira-comment.vi.test.ts` (inline ADF objects plus the real mention fixture): a mention inside a top-level paragraph, inside a quote, and inside a list item are all found; `textAfterMention(<@bot> "/research please")` returns `/research please`; a body with no mention of the account returns `undefined`; a mention of a different account is not a match.
- [ ] **Step 2: Failing tests** `jira-event-processing.vi.test.ts` (copy the harness from `packages/github/test/github-event-processing.vi.test.ts` and `test/fixtures.ts`; use `makeTestDeliveryExecution` from `packages/delivery/test`):
  - a mention fixture calls `onMentioned` once with `comment.afterMention` starting `/research`, `issue.mailboxKey` equal to the admission's mailbox key, and `prepare` called with `supportedOperations` equal to `jiraSupportedOperations` and `reactionTargets: []`;
  - the fixture authored by the bot account → `ProviderEventIgnored`, handler not called;
  - a plain comment (no mention) → `ProviderEventIgnored`;
  - a batch of two mention comments in one delivery → handler called once, for the last mention, with the earlier comment's text not lost to the batch (pass the last; document the choice in a code comment).
- [ ] **Step 3:** Run the two files. Expected: FAIL.
- [ ] **Step 4:** Implement. Processor follows `processGitHubBatch` minus subscriptions, PRs and check runs: decode the batch, drop bot-authored and non-mention comments, `execution.prepare(PreparedDeliveryInvocation.make({ callbacks: [PreparedDeliveryCallback…] }))` saving the destination, then run `onMentioned`. A prepared (retried) delivery re-runs the saved callback without choosing again, like `runPreparedInvocation`. No handler configured → `ProviderEventIgnored`.
- [ ] **Step 5:** Run the tests and `bun run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(jira): mention detection, callbacks and event processor`.

---

### Task 4: Jira API, output processor, `JiraBot.make`

**Files:**
- Create: `src/JiraApi.ts`, `src/JiraApiLive.ts`, `src/JiraDeliveryOutput.ts`, `src/JiraBot.ts`
- Modify: `src/index.ts` (export everything, `export * as JiraBot from './JiraBot'`)
- Test: `test/jira-api-live.vi.test.ts`, `test/jira-delivery-output.vi.test.ts`, `test/jira-bot.vi.test.ts`

**Interfaces:**
- Consumes: Task 3's destination, events and processor.
- Produces, `JiraApi.ts`: `JiraApi` `Context.Service` with `postComment(input: { issueKey: string; markdown: string }): Effect<{ commentId: string }, JiraApiError>`, `fetchIssue(issueKey: string): Effect<{ key: string; title: string; description: string | null }, JiraApiError>`, `myself(): Effect<{ accountId: string }, JiraApiError>`; `JiraApiError` tagged with `operation`, `retryable`, `retryAfterMs?`.
- Produces, `JiraApiLive.ts`: `JiraApiLive: Layer<JiraApi, Config.ConfigError, HttpClient>` reading `JIRA_BASE_URL`, `JIRA_BOT_EMAIL`, `JIRA_API_TOKEN` (Redacted); requests use `Authorization: Basic base64(email:token)`. `markdown` becomes an ADF document with one paragraph per blank-line-separated block (plain text; no markdown rendering).
- Produces, `JiraDeliveryOutput.ts`: `makeJiraOutputProcessor(options: { namespace: string }): ProviderOutputProcessor` handling `PresentOutcome` and `CreateMessage` (post comment, return `DeliveryOutputApplied` with a receipt holding the comment id), `UpdateMessage` and `DeleteMessage` per the API if the SPIKE shows them cheap, else `unsupported_operation` non-retryable; 429 and 5xx map to retryable `DeliveryOutputFailed`.
- Produces, `JiraBot.ts`: `make<E, R>(options: { webhookSecret: Config<Redacted<string>>; deliveryMode: DeliveryMode; bot: JiraBotConfiguration | Config<JiraBotConfiguration>; site: Config<string>; handlers: JiraCallbackHandlers<E, R> }): ChannelsProvider<{ build: never; process: R | JiraApi; error: Config.ConfigError }>`, same shape and the same "also read the bot config in the webhook half" trick as `GitHubBot.make`.

- [ ] **Step 1: Failing tests** with a fake `HttpClient` (copy the style of `github-api-live.vi.test.ts`): `postComment` sends `POST /rest/api/3/issue/ABC-1/comment` with the basic-auth header and an ADF body of two paragraphs for `"a\n\nb"`; `fetchIssue` maps title and description; a 429 maps to `retryable: true`.
- [ ] **Step 2: Failing tests** `jira-delivery-output.vi.test.ts`: `PresentOutcome` with markdown posts one comment to the destination issue and returns applied with a receipt; `SetActivity` and `SetMessageReaction` are rejected as unsupported and not retryable; an API 5xx is retryable.
- [ ] **Step 3: Failing test** `jira-bot.vi.test.ts` (copy `github-bot.vi.test.ts`): `JiraBot.make` returns `providerName: 'jira'`, builds the webhook half with only `webhookSecret`, `bot` and `site` config present, and the output processor exists.
- [ ] **Step 4:** Run the three files. Expected: FAIL.
- [ ] **Step 5:** Implement. Check `GitHubDeliveryOutput.ts` for the receipt and idempotency-key handling (an ambiguous attempt must not post twice if the receipt is known).
- [ ] **Step 6:** Run the whole package suite, `bun run typecheck`, and `bun run lint` at the SDK root. Expected: PASS.
- [ ] **Step 7: Commit** `feat(jira): API client, output processor and JiraBot.make`.

---

### Task 5: Link the package and prove the bundle resolves

**Files:**
- Modify: `infra/cloudfare/package.json`
- Test: `infra/cloudfare/test/jira-link.vi.test.ts`

**Interfaces:**
- Consumes: `@humanlayer/channels-jira` exporting `JiraBot`, `JiraApi`, `JiraApiLive`, `JiraMentioned`, `JiraIssueRef`.
- Produces: nothing new; later tasks import from the package.

- [ ] **Step 1:** Add `"@humanlayer/channels-jira": "link:../../../effect-channels/packages/jira"` and run `bun install`. Check there is exactly one copy of `effect` and `@humanlayer/channels-delivery` resolved (the linked package must not bring its own).
- [ ] **Step 2: Failing test** `jira-link.vi.test.ts`: importing `JiraBot` and `JiraApiLive` from the package resolves and `JiraBot.make` is a function.
- [ ] **Step 3:** Run `bun run test` and `bun run typecheck` in `infra/cloudfare`. If a second `effect` copy or a delivery-package duplicate appears, fix with the existing `overrides` pattern.
- [ ] **Step 4:** Verify the bundler follows the link: run `bun run alchemy:deploy` as a dry plan or the repo's local-dev command if one exists (see README) and check the Jira package is included without errors. If it cannot follow the link, apply the spec's fallbacks in order: `file:` tarball via `bun pm pack`, then moving the folder inside this repo; stop and tell the user before doing the second.
- [ ] **Step 5: Commit** `chore: link the Jira channel package`.

---

### Task 6: Generalize `AgentSessionMessage`

**Files:**
- Modify: `src/AgentSessionMessage.ts`, `src/AgentSessionDO.ts:47`, `src/GithubBot.ts:140`, `test/agent-session-message.vi.test.ts`, `test/echo-agent.vi.test.ts`, `test/github-bot.vi.test.ts:168`
- Test: `test/agent-session-message.vi.test.ts` (extended)

**Interfaces:**
- Produces: `AgentSessionMessage` with `discussion: Schema.Union([GitHubIssue, GitHubPullRequest, JiraIssueRef])` replacing `githubDiscussion`; `targetOf` unchanged. Every variant exposes `mailboxKey: string`.

- [ ] **Step 1: Failing tests:** the message round-trips (encode then decode) for a Jira issue; `decoded.discussion.mailboxKey` equals the issue's; existing GitHub cases keep passing with the renamed field.
- [ ] **Step 2:** Run `bun run test`. Expected: FAIL (field missing).
- [ ] **Step 3:** Rename `githubDiscussion` to `discussion` at the four code sites and tests; add the `JiraIssueRef` variant to the union.
- [ ] **Step 4:** Run `bun run test` and `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor: let AgentSessionMessage carry a Jira issue`.

---

### Task 7: Jira handler, command parsing, wiring

**Files:**
- Create: `src/JiraCommand.ts`, `src/JiraBot.ts`
- Modify: `src/Worker.ts` (layers: add `JiraApiLive`; `GitHubApiLive` stays), the file that registers providers (`bot` in `GithubBot.ts` or a new `src/Bot.ts` that combines `providers: [github, jira]` — keep the exported name `bot` used by `Worker.ts`), `.env.example`, `alchemy.run.ts` or wherever `GITHUB_*` secrets are declared, `README.md` (env vars and webhook setup, short)
- Test: `test/jira-command.vi.test.ts`, `test/jira-bot.vi.test.ts`

**Interfaces:**
- Consumes: Task 4's `JiraBot.make`, `JiraApi`, `JiraMentioned`; Task 6's message.
- Produces, `JiraCommand.ts`: `parseCommand(afterMention: string): Option<{ name: 'research'; args: string }>` — the first whitespace-delimited token must start with `/` and match a known command case-insensitively; anything else is `None`.
- Produces, `JiraBot.ts` here: `jiraHandlers` with `onMentioned` — (1) a separate `authorizeJiraMention(event): Effect<boolean>` returning `true` (placeholder for the deferred access policy), (2) `parseCommand(event.comment.afterMention)`; `None` → return without handoff, (3) fetch the issue through `JiraApi.fetchIssue` and, on failure, log and continue with the comment text alone, (4) build `AgentSessionMessage` with prompt = title, description (if any) and the command args, `discussion: event.issue`, `deliveryId`, `accessToken`, (5) `AgentSessions.getByName(event.issue.mailboxKey).send(message)` and `context.handoff({ failAfter: '10 minutes' })`. Export `jira` (the provider) built with `JiraBot.make`, `DebounceDeliveryMode.make({ quietPeriodMs: 3_000, maxWaitMs: 3_000 })`, `bot: Config.all({ accountId: Config.schema(JiraAccountId, 'JIRA_BOT_ACCOUNT_ID') })`, `site` from `JIRA_BASE_URL`'s host, `webhookSecret: Config.Redacted('JIRA_WEBHOOK_SECRET')`.

- [ ] **Step 1: Failing tests** `jira-command.vi.test.ts`: `/research` → research with empty args; `/Research  look at X` → research with args `look at X`; `hello /research`, `/foo`, empty string, `research` (no slash) → `None`.
- [ ] **Step 2: Failing tests** `jira-bot.vi.test.ts` (copy the harness and `delivery-context` support from `github-bot.vi.test.ts`): a `/research` mention calls `send` once on the session addressed by the issue's `mailboxKey` and then `handoff` with `failAfter: '10 minutes'`; `@bot` alone, `@bot hello` and `@bot /foo` call neither `send` nor `handoff` and return normally; a failing `fetchIssue` still sends, with a prompt containing only the comment's args or key; an authorized false (stub `authorizeJiraMention` to false in one test) sends nothing.
- [ ] **Step 3:** Run `bun run test`. Expected: FAIL.
- [ ] **Step 4:** Implement; register both providers in `ChannelsCloudflare.make` (namespace stays `slop-code-factory`); add env names to `.env.example` and to the secret declarations next to the `GITHUB_*` ones.
- [ ] **Step 5:** Run `bun run test` and `bun run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: Jira mention handler, /research command and provider wiring`.

---

### Task 8: Local run, then real end-to-end

**Files:**
- Modify: `README.md` (how to run and verify), none else.

- [ ] **Step 1 (local, no Jira):** start the worker locally (command in the README or `alchemy dev`); `curl` the signed `comment-created-mention.json` fixture to `/integrations/jira/webhook` using the secret from `.env`. Expected: 2xx, logs show the authorized mention, the `AgentSession` send, the handoff, and the delivery completing. Repeat with the bot-authored and `comment-updated` fixtures: 2xx and nothing sent.
- [ ] **Step 2:** Point the real system webhook (from Task 1) at the deployed worker or tunnel; deploy with the env set (`bun run alchemy:deploy`).
- [ ] **Step 3:** On the test issue, comment `@slopcodebot /research`. Expected: a comment from the bot user with the echo reply, no duplicate on a webhook redelivery.
- [ ] **Step 4:** Comment `@slopcodebot` alone, `@slopcodebot /foo`, edit a comment to add the mention, and let the bot's reply stand. Expected: no new bot comments, no agent logs.
- [ ] **Step 5:** Record the outcome of each check in the README "Verified" note; push the SDK branch to the fork and open nothing else without asking the user.
- [ ] **Step 6: Commit** `docs: how the Jira channel was verified`.

# Jira channel: comment `@slopcodebot /research` on a Jira issue, reach the control plane

## Intent

The broker (`infra/cloudfare`, built on the `effect-channels` SDK) already turns a GitHub comment that mentions the bot into a handed-off delivery for a per-discussion `AgentSession`, and posts the agent's reply back as a comment. The goal is the same experience in Jira: a person comments `@slopcodebot /research` on a Jira issue, the control plane is invoked, and a reply appears as a Jira comment from the bot.

This is a plumbing exercise. The agent stays a mock. Nothing about real research, repository configuration, or agent quality is in scope.

## Goals

- A new Jira channel (provider) for the SDK, so Jira can be one more `providers: [...]` entry next to GitHub in `ChannelsCloudflare.make`.
- Mention-style invocation: a comment that mentions the bot goes to an `onMentioned` callback, as with GitHub.
- Slash commands (`/research` first) parsed on the control-plane side, in this repo's handler.
- The mocked agent replies as a Jira comment authored by the bot user, via the existing delivery API and `AgentSession`.

## Non-goals

- Real research, repository lookup, or per-repo configuration (control-plane concern, later).
- OAuth, Forge or Connect apps, multi-site installs.
- Multi-turn conversations (the GitHub bot also does not subscribe discussions yet).
- A help/usage reply for unknown commands.
- Publishing the Jira package to npm.

## Anti-goals (a failure even if it technically works)

- The bot replying to its own comments, or any loop from its own output.
- Edits to old comments re-triggering a run.
- Replies appearing as a human's name instead of the bot's.
- Command vocabulary baked into the SDK package so that adding `/foo` needs a fork change.

## Decisions (made with the user)

1. **Where the code lives.** A new package `packages/jira` in the user's fork of the SDK, `git@github.com:yashodhah/effect-channels.git`, local checkout at `/Users/yashodhah/Projects/effect-channels` (its `origin` was repointed to the fork; local `main` is level with the fork's `main`). Model it on the existing providers, mainly GitHub (text mention parsing) and Linear (layout).
2. **How this repo consumes it.** Linked, not published: this repo's `infra/cloudfare/package.json` points at the local package folder (for example `link:../../../effect-channels/packages/jira`). Publishing is out of scope. Deploying from CI is out of scope until publishing is decided.
3. **Identity.** A dedicated Jira user for the bot, with its own email and an API token (basic auth: email + token). Comments must show the bot as the author. The credential sits behind a small interface so OAuth could replace it later.
4. **Inbound events.** A Jira Cloud *system webhook* (registered by an admin; the user has admin rights and can create a secret), event `comment_created`, optionally a JQL filter such as `project = ABC`. Jira cannot filter on comment text, so every in-scope new comment arrives and the channel filters.
5. **What the channel filters (generic, no command knowledge):**
   - only `comment_created`; edits (`comment_updated`) are ignored;
   - comments authored by the bot's own account ID are ignored;
   - a comment must mention the bot's account ID, otherwise it is ignored (HTTP 200, nothing handed off).
6. **Commands live in this repo.** Everything that mentions the bot goes to `onMentioned`. The handler in `infra/cloudfare` (next to `mentionPrompt` and the access check) parses the first `/command` after the mention. `/research` is the only command. A mention with a missing or unknown command does nothing and sends no reply (user: "stay silent"). The package stays a generic mention channel, "do the same as other packages".
7. **Mailbox key.** One mailbox and `AgentSession` per Jira issue, like a GitHub issue: resource id `jira:v1:issue:<issueId>`, installation id derived from the Jira site.
8. **Reply path.** The mocked agent behaves like `EchoAgent`: set activity `Working`, then complete the delivery with a canned markdown reply. The channel's output processor posts the markdown as a comment on the issue. Jira has no reactions, so reaction and activity operations are unsupported (declared via `supportedOperations`, as Linear does for issues).

## What the Jira package contains (modeled on GitHub/Linear; names are suggestions)

- `JiraBot` (`make(options)` returning the `ChannelsProvider`; `providerName: 'jira'`, so the webhook is served at `<base>/integrations/jira/webhook`), `JiraWebhookProvider`, `JiraWebhookSignature`, `JiraWebhookSchemas` (one `comment_created` event), `JiraIdentity`, `JiraEventProcessor`, `JiraCallbackEvents`, `JiraCallbacks` (an `onMentioned` handler type), `JiraDeliveryDestination`, `JiraDeliveryOutput`, `JiraApi`/`JiraApiLive` (post comment, fetch issue title/description, `myself`), `JiraAuth`, `index.ts`.
- Skip the Linear-only extras: files, lifecycle/OAuth revocation, issue-change events, resource records, agent-session machinery.
- Registration: add `'jira'` to `libraries` in the SDK's `scripts/release/manifest.ts`. The research found no other hard-coded provider lists.
- Tests in the SDK's style (`@effect/vitest`, `test/jira-*.vi.test.ts`, fixture JSON payloads, HMAC-signed fixture builder): webhook routing and signature, mention detection, self/edit filtering, delivery output posting a comment.

## What changes in this repo (`infra/cloudfare`)

- Add the Jira provider next to `github` in `bot` (`GithubBot.ts` / a new `JiraBot.ts`), with its own `onMentioned`.
- Generalize `AgentSessionMessage` so a message can come from Jira as well as GitHub (today it holds a GitHub issue/PR ref); keep `deliveryId` and `accessToken`, and keep `targetOf`.
- Parse the command in the Jira handler; for `/research`, send the message to `AgentSessions.getByName(<issue mailbox key>)` and `handoff` with a fail-after, as the GitHub handler does.
- Prompt content: the mention comment plus the issue's title and description (fetched through the Jira API). Nothing repo-specific.
- Add config/secrets: Jira site/base URL, bot account ID, bot email, API token, webhook secret.
- Tests next to the existing ones in `infra/cloudfare/test`.

## Constraints and facts to respect

- Jira Cloud has no reactions; the GitHub flow's 👀 acknowledgement has no equivalent (an immediate "on it" comment is optional and not required).
- Mentions in a Jira Cloud comment body reach the webhook as an account ID inside rich text (ADF), not the plain text `@slopcodebot`; match on the bot's account ID.
- Access control (the GitHub bot allows only users with write access): **deferred by the user.** For now any user who can comment and mention the bot may invoke it. Do not build a Jira permission check in this round, but keep the handler structured so one can be added beside the command parse.
- Webhook authenticity must be verified. System webhooks with a secret are expected to send an HMAC signature header, but the exact header name and format have **not been verified**. The builder must confirm against Atlassian's docs and a real test event, then implement verification (constant-time compare) accordingly. If no signature is available, a shared secret passed in a header or the URL is the fallback.
- Pin versions as the existing project does (`effect` and `@effect/*` at 4.0.0, per recent commits). The SDK fork has its own versions; make the new package match the fork, and make the link resolve with this repo's `effect` version.

## Calls made by the author (not discussed with the user; change if wrong)

- **Effect versions already match.** The fork's `overrides` and this repo both pin `effect` and `@effect/*` at 4.0.0, so the link needs no version reconciliation. Whether Wrangler/alchemy can bundle a `link:` target outside this repo is unverified; the builder checks it first. Fallbacks, in order: `file:` tarball from `bun pm pack`, then moving the folder inside this repo.
- **Spike first.** Step 1 of the plan is a short spike against the real test site: capture one real `comment_created` webhook, and record (a) the signature header, if any, and its format, (b) whether the payload carries the comment body as ADF and the site/cloud id, (c) the mention shape. Signature verification, fixtures and the mention parser are built from those captures, not from assumptions. If there is no HMAC, the fallback is a shared secret in a custom header or the URL, compared in constant time.
- **Installation id.** The Jira cloud id if the payload carries it, else the site's base-URL host from config. Fixed once chosen, since it is part of the mailbox key.
- **Mention detection stays in the webhook path.** If the payload lacks the comment body, the channel fetches the comment through `JiraApi` before filtering; the builder decides the failure semantics (suggested: retryable error).
- **Issue fetch.** Title and description are fetched in this repo's handler (control-plane side) through the package's `JiraApi`. If the fetch fails, proceed with the comment text alone.

## Left to the builder

- Exact Jira webhook payload handling, ADF traversal for mention and command text, and the comment-posting body format (API v3 ADF vs v2 wiki/markdown).
- Delivery mode (suggested: queue-style rather than serial, as GitHub uses a debounce mode; builder decides), handoff fail-after value, and error/retry mapping.
- File names, and test depth beyond the cases above.
- How the signed-webhook fixtures and a local end-to-end check (for example a curl-posted fixture against the local worker) are done.

## Testing

Four layers, cheapest first. Layers 1 to 3 need no credentials.

1. **Package tests in the fork** (`@effect/vitest`, `test/jira-*.vi.test.ts`), using payloads captured in the spike and a signing fixture builder:
   - webhook: valid signature accepted; bad or missing signature rejected;
   - mention filter: a bot mention passes; a plain comment, an edit and a comment by the bot itself are ignored;
   - mailbox key is stable for the same issue;
   - output: a completed delivery posts a comment to the right issue with the right body, against a fake HTTP client.
2. **Handler tests in this repo** (`infra/cloudfare/test`, beside the GitHub ones):
   - `@bot /research` sends a message to the issue's `AgentSession`; a missing or unknown command does nothing;
   - a failed issue fetch falls back to the comment text alone;
   - the mock agent sets `Working` and completes the delivery with its canned reply.
3. **Local run without Jira.** Run the worker locally and `curl` a signed fixture to `/integrations/jira/webhook`, covering routing, signature check, Durable Objects and handoff end to end, with the comment post stubbed.
4. **Real end-to-end on the user's Jira site** (worker deployed or tunneled, system webhook pointed at it): comment `@slopcodebot /research` on a test issue and see the bot user's reply. Then check live that a mention without a command, an edited comment and the bot's own comment each produce nothing. The spike's findings (signature header, comment format) are confirmed here.

## Verification environment

The user will test against their real Jira Cloud site: a bot user with its API token and a reachable deployed worker or tunnel. The spike and the "Done when" checks use real events, not only fixtures. The user supplies the credentials and site details when the builder needs them.

## Done when

- A Jira comment `@slopcodebot /research` on a test issue produces a comment from the bot user containing the mock agent's reply.
- A mention without `/research`, an edited comment, and a comment by the bot itself each produce no reply and no agent run.
- The SDK fork's tests for the new package pass, and this repo's tests pass.

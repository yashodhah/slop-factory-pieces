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

## Configuration

Set these in `.env` (never committed; see `.env.example` for the names). The Worker reads them through Effect `Config`.

- GitHub: `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_BOT_MENTION_NAME`, `GITHUB_BOT_USER_ID`.
- Jira: `JIRA_WEBHOOK_SECRET`, `JIRA_BASE_URL` (e.g. `https://your-site.atlassian.net`; its host is part of every Jira mailbox key, so do not change it), `JIRA_BOT_EMAIL`, `JIRA_API_TOKEN`, `JIRA_BOT_ACCOUNT_ID`. All five are required: the Worker builds the Jira provider at startup, so a missing `JIRA_*` variable stops the whole Worker from starting, GitHub included. There are deliberately no defaults: a default would hide a misconfiguration, or accept webhooks signed with a known secret.

## Jira setup

1. Create a Jira user for the bot, give it access to the projects, and create an API token for it (`JIRA_BOT_EMAIL`, `JIRA_API_TOKEN`). Its account ID is `JIRA_BOT_ACCOUNT_ID`; comments are posted as this user.
2. As a Jira admin, add a system webhook: URL `<worker-url>/integrations/jira/webhook`, event `comment_created` (optionally a JQL filter such as `project = ABC`), secret = `JIRA_WEBHOOK_SECRET`.
3. Comment `@<bot> /research <optional text>` on an issue. A mention without a known command is ignored silently.

## Repacking the vendored Jira package

`@humanlayer/channels-jira` is installed from a tarball in `vendor/`. To update it:

1. In the SDK checkout, `cd packages/jira && bun pm pack`.
2. Rename the `.tgz` to include the SDK short commit hash, e.g. `humanlayer-channels-jira-0.0.0-ea6c5ef.tgz` (current file in `vendor/`). Always use a fresh filename: bun caches `file:` tarballs by name and would otherwise reuse a stale entry. Move it into `vendor/`, delete the old one, and point `@humanlayer/channels-jira` in `package.json` at `file:./vendor/<new-file>.tgz`.
3. `bun install`, then `bun run test` and `bun run typecheck`.

## Running locally

Not verified locally. `alchemy.run.ts` uses `Cloudflare.providers()` and `Cloudflare.state()`, so `alchemy dev` needs Cloudflare credentials and touches a Cloudflare account; no fully local, side-effect-free mode was used. The Jira webhook was therefore not exercised end to end with signed fixtures. Coverage comes from the unit and routing tests (`bun run test`), including `test/jira-bot.vi.test.ts`.

## Unverified against a live Jira site

No live Jira site has been used. The SDK package's `ASSUMPTIONS.md` (`packages/jira/` in the SDK checkout) lists what is assumed. None of the following has been checked against a real site:

- Signature: header `X-Hub-Signature` with value `sha256=<hex>`, HMAC-SHA256 over the raw request body bytes, lowercase hex, keyed by the webhook secret. The header is documented; the raw-body input and hex format are assumed. Only `sha256` is accepted.
- `comment_created` payload: `webhookEvent`, `timestamp`, `comment`, `issue` are documented generically; the exact `comment.*` and `issue.fields.summary` layout is assumed from REST API v3, as is `comment.author.accountType` being `app` for bots. No cloud id is in the payload (assumed); the site comes from configuration.
- Comment body: ADF (`version: 1`, `type: "doc"`) is assumed. A plain string body is tolerated as text without mentions.
- Mention node: `{ type: "mention", attrs: { id, text, accessLevel } }` inline in a paragraph, possibly nested in blockquotes or lists; the command text follows as a separate `text` node. Recalled from the ADF spec, not re-fetched.
- Event id: `X-Atlassian-Webhook-Identifier` (unique per tenant, constant across retries) is documented; the fallback to `comment.id` plus `webhookEvent` is assumed.
- Comment post: `POST /rest/api/3/issue/{key}/comment` with `{ body: <ADF doc> }`, one paragraph per block, Basic auth with bot email and API token. Recalled, not re-fetched.
- `GET /rest/api/3/myself` returning `accountId` and `displayName`.

Behaviour to know: comment posting is at-least-once (Jira has no idempotency key), and mentions within the 3 second debounce window collapse to the last one.

Checks to run when a site is available:

1. Deploy, set the `JIRA_*` variables, and add the system webhook (see Jira setup).
2. Comment `@<bot> /research <text>` on an issue: expect exactly one reply from the bot.
3. A mention without a command, an edited comment (`comment_updated`), and a bot-authored reply must each produce nothing.
4. Redeliver the same webhook from Jira: still one reply in total.
5. If any of these fail, compare the real payload and headers with the assumptions above and fix the channel package, not this Worker.

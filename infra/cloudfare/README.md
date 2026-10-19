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
- Jira: `JIRA_WEBHOOK_SECRET`, `JIRA_BASE_URL` (e.g. `https://your-site.atlassian.net`; its host is part of every Jira mailbox key, so do not change it), `JIRA_BOT_EMAIL`, `JIRA_API_TOKEN`, `JIRA_BOT_ACCOUNT_ID`. All five are required: the Worker builds the Jira provider at startup.

## Jira setup

1. Create a Jira user for the bot, give it access to the projects, and create an API token for it (`JIRA_BOT_EMAIL`, `JIRA_API_TOKEN`). Its account ID is `JIRA_BOT_ACCOUNT_ID`; comments are posted as this user.
2. As a Jira admin, add a system webhook: URL `<worker-url>/integrations/jira/webhook`, event `comment_created` (optionally a JQL filter such as `project = ABC`), secret = `JIRA_WEBHOOK_SECRET`.
3. Comment `@<bot> /research <optional text>` on an issue. A mention without a known command is ignored silently.

## Repacking the vendored Jira package

`@humanlayer/channels-jira` is installed from a tarball in `vendor/`. To update it:

1. In the SDK checkout, `cd packages/jira && bun pm pack`.
2. Move the `.tgz` into `vendor/`, delete the old one, and point `@humanlayer/channels-jira` in `package.json` at `file:./vendor/<new-file>.tgz`.
3. `bun install`, then `bun run test` and `bun run typecheck`.

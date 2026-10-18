# GitHub App: `slop-code-factory`

Config only, nothing to run. This is the GitHub side of the broker in `../../infra/cloudfare/`.

```text
GitHub App settings  ──(5 values)──►  infra/cloudfare/.env  ──(alchemy deploy)──►  Worker secrets
        ▲                                                                              │
        └──────────────── webhook URL = <worker url>/integrations/github/webhook ◄──────┘
```

The two sides depend on each other: the app needs the Worker's URL, and the Worker needs the app's secrets. Do it in the order below.

## What the broker needs

| `.env` variable | What it is | Where to get it | Secret? |
|---|---|---|---|
| `GITHUB_WEBHOOK_SECRET` | Shared password GitHub uses to sign webhooks; the broker checks it | You generate it, then paste it into GitHub and `.env` | **Yes** |
| `GITHUB_APP_ID` | Numeric id of the app | App settings page, "About" section | No |
| `GITHUB_PRIVATE_KEY` | Lets the broker sign in as the app (posting comments, reactions) | "Generate a private key" on the app settings page (downloads a `.pem`) | **Yes** |
| `GITHUB_BOT_MENTION_NAME` | The app slug, used as the mention name. No `@`, no `[bot]` | The app's URL: `github.com/apps/<slug>` | No |
| `GITHUB_BOT_USER_ID` | Numeric user id of the app's bot account, so the broker ignores its own comments | `curl` command below | No |

Never commit the webhook secret or the private key, and don't paste them into chat. `infra/cloudfare/.gitignore` already ignores `.env`.

## Step 1: Create the app (skip what you've done)

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App** (use the organization's settings if it should own the app).

| Setting | Value |
|---|---|
| GitHub App name | `slop-code-factory` (must be globally unique; the slug may differ) |
| Homepage URL | any URL, e.g. the repo |
| Webhook | **Active** |
| Webhook URL | a placeholder for now (e.g. `https://example.com`); you set the real one in Step 5 |
| Webhook secret | the value from Step 2 |
| Where can this app be installed | **Only on this account** |

No OAuth callback, device flow or setup URL is needed.

### Permissions (repository)

The SDK's own list is longer; this is the minimum for the starter.

| Permission | Access | Used for |
|---|---|---|
| Metadata | Read-only | Mandatory; repository identity |
| Issues | Read and write | Reading issues and comments, posting comments, reactions |
| Pull requests | Read and write | Same for pull requests and their review comments |

Not needed yet: Checks, Contents, Actions (they serve CI-failure handling and merging, which the starter drops).

### Subscribe to events

`Issues`, `Issue comment`, `Pull request`, `Pull request review comment`.

Other events the SDK would ignore anyway. If you change permissions after installing, GitHub asks you to approve the new permissions on the installation.

## Step 2: Webhook secret

```sh
openssl rand -hex 32
```

Paste the output into the app's **Webhook secret** field and keep a copy for `.env`. The two copies must be identical or every webhook returns `401`.

## Step 3: App id, private key, slug, bot user id

1. **App id:** the number under "About" on the app settings page.
2. **Private key:** on the same page, "Private keys" → **Generate a private key**. Keep the downloaded `.pem` out of the repo.
3. **Install the app** on the test repository (left menu → Install App). Only that repository.
4. **Slug:** from the app's public page URL, `github.com/apps/<slug>`.
5. **Bot user id:** the app's bot account is `<slug>[bot]`:

   ```sh
   curl --fail --silent "https://api.github.com/users/<slug>%5Bbot%5D" | jq .id
   ```

## Step 4: Put the values in the broker

```sh
cd infra/cloudfare
cp .env.example .env
```

Edit `.env`:

```dotenv
GITHUB_WEBHOOK_SECRET=<from Step 2>
GITHUB_APP_ID=<from Step 3>
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
<the full contents of the .pem, keeping the line breaks>
-----END RSA PRIVATE KEY-----"
GITHUB_BOT_MENTION_NAME=<slug>
GITHUB_BOT_USER_ID=<from Step 3>
```

Use the whole `.pem` contents, including the BEGIN and END lines, inside the quotes.

## Step 5: Deploy, then point GitHub at the Worker

```sh
cd infra/cloudfare
bun install
bun run alchemy:deploy     # needs Cloudflare login; prints the Worker URL
```

Then in the app settings set **Webhook URL** to:

```text
<worker url>/integrations/github/webhook
```

Alchemy turns the `.env` values into Cloudflare secrets during deploy. This has not been verified yet in this project.

## Step 6: Check it works

1. App settings → **Advanced** → **Recent Deliveries**: a ping shows `200`.
2. On an issue in the test repository, as someone with write access, comment `@<slug> hello`. Expect 👀, then a reply starting `Got it`, then 👀 removed.
3. Mention it from an account without write access. Expect 👎 and one notice comment.

| Symptom | Likely cause |
|---|---|
| `401` in Recent Deliveries | Webhook secret differs between GitHub and `.env` (redeploy after fixing) |
| `403` in Worker logs | A permission is missing, or the app isn't installed on that repository |
| `200` but no reply | `GITHUB_BOT_MENTION_NAME` wrong (don't include `@` or `[bot]`), or event not subscribed |
| Bot replies to itself | `GITHUB_BOT_USER_ID` wrong |
| 👀 stays after the reply | The agent didn't report "Working" before finishing (fixed in the stub; check logs) |

Logs: `bun alchemy logs --resource IngressWorker --since 10m --no-input` from `infra/cloudfare/`.

## Changing things later

| Change | Do |
|---|---|
| Rotate webhook secret | Generate a new one, set it in GitHub **and** `.env`, run `bun run alchemy:deploy` |
| Rotate private key | Generate a new key in GitHub, update `GITHUB_PRIVATE_KEY`, redeploy, then delete the old key |
| Rename the app or change its slug | Update `GITHUB_BOT_MENTION_NAME` and, if the bot account changed, `GITHUB_BOT_USER_ID`; redeploy |
| Change permissions or events | Edit in app settings, approve on the installation, no redeploy needed |
| Worker URL changes | Update the app's Webhook URL |
| Any `.env` change | `bun run alchemy:deploy` |

## Source

Permissions, events and variable meanings come from the SDK's `packages/github/README.md` (`~/Projects/effect-channels`), trimmed to the starter's needs.

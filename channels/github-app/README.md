# github-app/ (placeholder)

**Role:** definition of the GitHub App `slop-code-factory`. Config only, nothing to run.

**Will contain (not yet written):**
- App settings checklist: webhook URL, webhook secret, install scope (a single test repository)
- A manifest, modelled on `~/Projects/effect-channels/examples/alchemy-cloudflare/github-app-manifest.example.json`
- Notes on resolving the bot's numeric user ID (needed so the app ignores its own events)

**Likely permissions (from the SDK's GitHub README, to be trimmed to what the starter needs):** Issues (read/write), Pull requests (read/write), Metadata (read). Checks, Contents and Actions are only needed for features outside the starter.

**Likely webhook events:** issues, issue comments, pull request. Other events are acknowledged and ignored by the SDK.

**Secrets:** never committed. `.env` is already in `.gitignore`.

# pi/ (placeholder)

**Role:** the simple agent, plus its sandbox and tools.

**Will contain (not yet built):**
- A Pi Durable agent that runs per PR (conversation id = the PR) with no client attached
- A tiny tool set: `write_file`, `read_file`, `list_files` (guess)
- A sandbox/filesystem port so the implementation can be swapped (virtual filesystem, container, other)
- A small client for the delivery API: activity, then complete or fail, using `deliveryId` and `accessToken`

**Uses:** `@earendil-works/pi-durable` (experimental). Reference: `~/Projects/pi-durable-chat` (`src/agent/ports.ts` for what a runtime must provide, `src/adapters/cloudflare/` for the Durable Object mapping).

**Note:** Pi has no sandbox or filesystem tools today; those are ours to add.

**Open:** can Pi run headlessly, where does per-PR state live, scripted vs real model call. See `../docs/06-starter-design-notes.md`.

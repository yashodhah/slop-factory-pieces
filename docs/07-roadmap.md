# 07 · Roadmap (draft)

## Phase 1: Cloudflare, Pi

Prove the round trip: GitHub comment → broker → Pi agent in a minimal sandbox → acknowledgement on GitHub.

Exit criteria (draft):
- A comment on a test repo produces 👀, then a short reply.
- The agent performed one tool-driven action in its sandbox (for example write and read a file).
- A second comment on the same PR runs as a new turn and finds the earlier file.
- Restarting the broker mid-turn does not lose the comment.

## Phase 2: other sandbox strategies, same cloud

Swap the agent's sandbox while keeping the broker and delivery API unchanged. Candidates (not chosen): virtual filesystem in Durable Objects, container with a real disk, shell-only, none.

## Phase 3: other clouds

Same shape on Azure and AWS. Mapping for Azure from the discussion (a proposal; the SDK adapters were not tested there):

| Piece | Azure candidate |
|---|---|
| Broker service | Container Apps or App Service (public HTTPS) |
| Storage | Azure Database for PostgreSQL (`sql` adapter) or Azure Cache for Redis (`redis` adapter) |
| Secrets | Key Vault (SDK reads secrets via `Config`; wiring is app-level, not verified) |
| Agent host | Container Apps Jobs, AKS or ACI |
| Model | Azure OpenAI |

AWS equivalents to be worked out.

## Phase 4: more providers

Slack and Linear providers exist. MS Teams has no provider and would be a new package written against `ChannelsProvider`; it is the highest-risk item and needs a spike first.

## Seams that must stay clean

- Broker ⟷ agent: only B5 (start) and B6 (delivery API).
- Agent ⟷ sandbox: a narrow tool interface the agent calls.
- Broker ⟷ storage: the SDK's storage adapters.

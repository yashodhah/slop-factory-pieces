# 03 · User requirements

Derived by reading the SDK and its reference app. They describe what users need, not how it is built. They are a draft for the product owner to confirm.

## Personas

| Persona | Who |
|---|---|
| Team member | Person in Slack, GitHub or Linear talking to the agent |
| Maintainer / admin | Controls who may use the agent and what it may do |
| Agent builder | Engineer adding an agent to these tools |
| Platform / ops owner | Runs it and is accountable for reliability and security |

## A. Team members

1. Invoke the agent by mentioning it (or assigning a Linear issue).
2. Get an immediate sign it was seen (👀, "Working on this…", typing indicator).
3. The agent understands the context where it was asked: whole thread, issue and comments, PR with reviews, inline comments and diff.
4. See what it is doing while it works: a status line and an updating task checklist.
5. Replies appear in the same thread, issue or PR, in that tool's native style.
6. Continue the conversation without re-mentioning.
7. Several quick messages are treated as one request.
8. Tell the agent to stop, and it stops.
9. Work products appear where expected (a branch and PR).
10. On a followed PR, failing checks are investigated.
11. New issues and PRs are labelled sensibly.
12. Files can be sent and received (Slack).

## B. Maintainers and admins

13. Only authorised people can trigger the agent (the reference app: users with write access).
14. The agent never answers its own messages or loops.
15. The agent has only the permissions it needs, and they are documented.
16. Secrets never appear in logs, messages or stored events.
17. Idle agent workspaces are cleaned up (14 days in the reference app).

## C. Agent builders

18. One agent can serve several tools, and a tool can be added without redesign.
19. Long jobs do not hit chat-tool timeouts (Linear's 10-second limit is handled).
20. Any agent, model or infrastructure can be used.
21. Reaction speed is configurable: every message, batched, or after a pause.
22. A time limit applies to stuck jobs.
23. A quick-start path exists: example, setup guide, app manifests.

## D. Platform and ops owners

24. No message is lost through crashes, deploys or provider outages.
25. Events in one conversation run one at a time, in order.
26. Duplicate webhooks never cause duplicate work or replies.
27. Failures retry; stuck jobs are picked up by another worker.
28. Provider outages delay replies but never re-run the agent's work.
29. Deployable on approved infrastructure (Postgres, Redis, Cloudflare), with memory for trials.
30. Requests are verified as coming from the real provider.

## Which of these matter for the starter

Only the plumbing set: 1, 2, 3 (minimal), 4 (activity at least), 5, 24 to 28, 30. Everything else is out of scope for now.

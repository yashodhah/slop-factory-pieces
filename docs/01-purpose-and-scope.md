# 01 · Purpose and scope

## Purpose

Learn the plumbing end to end:

> someone comments on GitHub → a broker receives and saves it → a long-running agent is started → the agent reports progress and an answer → the broker posts it back on GitHub

The project is called **slop-code-factory** (also the name of the GitHub App).

## What the owner wants to learn (their words, condensed)

- How the SDK works as a broker, deployed on Cloudflare.
- How an agent uses a sandbox, tooling and a local filesystem.
- How the agent communicates back to GitHub.

## Goals

- A working round trip on Cloudflare: comment in, acknowledgement out.
- A deliberately trivial agent built on Pi Durable, with a minimal sandbox and a few tools.
- Clear seams between broker, agent host and sandbox so each can be swapped later.

## Non-goals

- The agent completing real tasks.
- Code review or development workflows.
- Production hardening, auth beyond what the plumbing needs, cost controls.

## Anti-goals (would count as failure even if it technically works)

- Copying the SDK's full Cloudflare example (about 3,700 lines, built to prove every feature) and not understanding it. **(inference from "might be too complicated")**
- Coupling the agent so tightly to Cloudflare that Azure or AWS needs a rewrite.

## Later

Once it works on Cloudflare: run the same shape on Azure and AWS, and try different sandboxing strategies for the agent. See [07-roadmap](07-roadmap.md).

import * as Cloudflare from 'alchemy/Cloudflare'
import type { Effect } from 'effect'

import { bot } from './GithubBot'

/** The mailbox's RPC methods and alarm. */
type MailboxMethods = Effect.Success<Effect.Success<ReturnType<typeof bot.mailbox>>>

/** The application-owned mailbox Durable Object: one per GitHub issue or pull request. */
export class DeliveryMailbox extends Cloudflare.DurableObject<DeliveryMailbox, MailboxMethods>()('DeliveryMailbox') {}

/**
 * The mailbox's implementation. The Worker entrypoint provides what the callbacks need (the GitHub API,
 * AgentSessions) and `Crypto`; the Durable Object's alarm belongs to the mailbox.
 */
export const DeliveryMailboxDOLive = DeliveryMailbox.make(bot.mailbox({ rearmAfterMs: 1_000 }))

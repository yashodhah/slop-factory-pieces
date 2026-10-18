import * as Cloudflare from 'alchemy/Cloudflare'
import { Effect } from 'effect'

import { CryptoCompat } from './CryptoCompat'
import { bot } from './GithubBot'

/** The mailbox's RPC methods and alarm. */
type MailboxMethods = Effect.Success<Effect.Success<ReturnType<typeof bot.mailbox>>>

/** The application-owned mailbox Durable Object: one per GitHub issue or pull request. */
export class DeliveryMailbox extends Cloudflare.DurableObject<DeliveryMailbox, MailboxMethods>()('DeliveryMailbox') {}

/**
 * The mailbox's implementation. The Worker entrypoint provides what the callbacks need (the GitHub API,
 * AgentSessions); `Crypto` comes from `CryptoCompat`, provided here because the mailbox captures its services when the
 * object is built and must not depend on the order of the Worker's layers. The Durable Object's alarm belongs to the mailbox.
 */
export const DeliveryMailboxDOLive = DeliveryMailbox.make(
	bot.mailbox({ rearmAfterMs: 1_000 }).pipe(Effect.provide(CryptoCompat)),
)

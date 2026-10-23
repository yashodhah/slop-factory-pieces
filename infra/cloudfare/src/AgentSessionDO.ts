import * as Cloudflare from 'alchemy/Cloudflare'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { Effect, Layer, Schema } from 'effect'

import { AgentSessionMessage, AgentSessions, DeliveryApi } from '@slop/core'
import { answer } from './EchoAgent'

/**
 * The AgentSession namespace; callers address it directly by the GitHub or Jira discussion's mailbox key. `send` starts
 * the echo agent in the background and returns once the message is accepted; the agent finishes the delivery.
 * Stage 2 replaces what is behind `send` with Pi.
 */
export class AgentSession extends Cloudflare.DurableObject<
	AgentSession,
	{
		readonly send: (input: typeof AgentSessionMessage.Encoded) => Effect.Effect<void, never, RuntimeContext>
	}
>()('AgentSession') {}

/**
 * Fills the core `AgentSessions` port with the AgentSession namespace, so callers see `Effect<void>`.
 *
 * The stub's `send` is `RuntimeContext`-coloured only because it shares its type with the object's own method:
 * Alchemy's stub calls the Durable Object through its Cloudflare binding and never reads `RuntimeContext`. A
 * Worker's layers cannot require it either, so it is discharged with `RuntimeContext.phantom`, as Alchemy does for
 * the `RuntimeContext`-coloured calls its own services wrap. Every call still runs inside a Worker or Durable Object
 * event, where Alchemy provides the real context.
 */
export const AgentSessionsCloudflare = Layer.effect(
	AgentSessions,
	Effect.gen(function* () {
		const namespace = yield* AgentSession
		return AgentSessions.of({
			getByName: (mailboxKey) => {
				const session = namespace.getByName(mailboxKey)
				return { send: (input) => session.send(input).pipe(Effect.provide(RuntimeContext.phantom)) }
			},
		})
	}),
)

/**
 * A message must be for this Durable Object: its discussion's mailbox key is the object's name. Anything else
 * is a routing bug, so the object dies rather than answer the wrong discussion.
 */
export const ensureMessageForMailbox = (message: AgentSessionMessage, mailboxKey: string): Effect.Effect<void> =>
	message.discussion.mailboxKey === mailboxKey
		? Effect.void
		: Effect.die(new Error('AgentSession message does not match this Durable Object mailbox key'))

/** Build this object's methods. The Worker entrypoint provides `DeliveryApi`. */
const AgentSessionImplementation = Effect.gen(function* () {
	const state = yield* Cloudflare.DurableObjectState
	const api = yield* DeliveryApi

	return Effect.gen(function* () {
		const mailboxKey = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(state.id.name)

		return {
			send: Effect.fn('agent_session.send')(function* (input: typeof AgentSessionMessage.Encoded) {
				const message = yield* Schema.decodeEffect(AgentSessionMessage)(input).pipe(Effect.orDie)
				yield* ensureMessageForMailbox(message, mailboxKey)
				yield* answer(message).pipe(Effect.provideService(DeliveryApi, api), Effect.forkDetach, Effect.asVoid)
			}),
		}
	}).pipe(
		Effect.tapCause((cause) => Effect.logError('AgentSession could not start', cause)),
		Effect.orDie,
	)
})

/** Register the AgentSession implementation in the Worker runtime. */
export const AgentSessionDOLive = AgentSession.make(AgentSessionImplementation)

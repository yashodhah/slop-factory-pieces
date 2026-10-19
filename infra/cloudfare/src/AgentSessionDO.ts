import * as Cloudflare from 'alchemy/Cloudflare'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { Context, Effect, Layer, Schema } from 'effect'

import { AgentSessionMessage } from './AgentSessionMessage'
import { DeliveryApi } from './DeliveryApi'
import { answer } from './EchoAgent'

/**
 * The AgentSession namespace; callers address it directly by the GitHub discussion's mailbox key. `send` starts
 * the echo agent in the background and returns once the message is accepted; the agent finishes the delivery.
 * Stage 2 replaces what is behind `send` with Pi.
 */
export class AgentSession extends Cloudflare.DurableObject<
	AgentSession,
	{
		readonly send: (input: typeof AgentSessionMessage.Encoded) => Effect.Effect<void, never, RuntimeContext>
	}
>()('AgentSession') {}

/** The AgentSession namespace as a service, as `DeliveryMailboxes` is for mailboxes. */
export class AgentSessions extends Context.Service<
	AgentSessions,
	{
		readonly getByName: (mailboxKey: string) => {
			readonly send: (input: typeof AgentSessionMessage.Encoded) => Effect.Effect<void, never, RuntimeContext>
		}
	}
>()('slop-code-factory/AgentSessions', {
	/** The namespace of {@link AgentSession}. */
	make: AgentSession,
}) {
	static readonly layer = Layer.effect(this, this.make)
}

/** Build this object's methods. The Worker entrypoint provides `DeliveryApi`. */
const AgentSessionImplementation = Effect.gen(function* () {
	const state = yield* Cloudflare.DurableObjectState
	const api = yield* DeliveryApi

	return Effect.gen(function* () {
		const mailboxKey = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(state.id.name)

		return {
			send: Effect.fn('agent_session.send')(function* (input: typeof AgentSessionMessage.Encoded) {
				const message = yield* Schema.decodeEffect(AgentSessionMessage)(input).pipe(Effect.orDie)
				if (message.discussion.mailboxKey !== mailboxKey) {
					return yield* Effect.die(
						new Error('AgentSession message does not match this Durable Object mailbox key'),
					)
				}
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

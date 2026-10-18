/** The stub agent: ends the handed-off delivery with the echo reply, through the delivery API. */
import { Effect, Predicate, Schedule } from 'effect'

import { type AgentSessionMessage, targetOf } from './AgentSessionMessage'
import { DeliveryApi } from './DeliveryApi'
import { echoReply } from './EchoReply'

const RETRY_EVERY = '10 seconds'
const RETRY_TIMES = 30

/**
 * Whether completing may succeed later. The delivery is not found until the callback's `handoff()` has been
 * recorded, and the store or the HTTP call can be briefly unreachable.
 */
const isRetryable = (error: unknown) =>
	Predicate.isTagged(error, 'DeliveryNotFound') ||
	Predicate.isTagged(error, 'DeliveryControlUnavailable') ||
	Predicate.isTagged(error, 'HttpClientError')

/** Complete the delivery with the echo reply. A delivery that already ended counts as done; other failures are logged. */
export const answer = Effect.fn('echo_agent.answer')(function* (message: AgentSessionMessage) {
	const api = yield* DeliveryApi
	yield* api.complete({ ...targetOf(message), payload: { markdown: echoReply(message.prompt) } }).pipe(
		Effect.retry({ schedule: Schedule.spaced(RETRY_EVERY), times: RETRY_TIMES, while: isRetryable }),
		Effect.catchTags({
			DeliveryClosed: (error) => Effect.logWarning('echo_agent.answer: the delivery already ended', error),
		}),
		Effect.tapError((error) => Effect.logError('echo_agent.answer failed', error)),
		Effect.ignore,
	)
})

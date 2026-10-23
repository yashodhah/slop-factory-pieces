/** The stub agent: ends the handed-off delivery with the echo reply, through the delivery API. */
import { DeliveryActivity } from '@humanlayer/channels-delivery'
import { Effect, Predicate, Schedule } from 'effect'

import { type AgentSessionMessage, targetOf } from './AgentSessionMessage'
import { echoReply } from './EchoReply'
import { DeliveryApi } from './Ports'

const RETRY_EVERY = '10 seconds'
const RETRY_TIMES = 30
const WORKING = DeliveryActivity.cases.Working.make({ message: 'Working on it' })
/** Stands in for real agent work so the acknowledgement and the reply are visibly apart; replaced by the real agent later. */
export const MOCK_WORK_DURATION = '5 seconds'

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
	/** Only cosmetic, but GitHub removes the `eyes` reaction at the end only if the last activity was `Working`. */
	yield* api.activity.set({ ...targetOf(message), activity: WORKING }).pipe(
		Effect.tapError((error) => Effect.logWarning('echo_agent.answer: set_activity failed', error)),
		Effect.ignore,
	)
	yield* Effect.sleep(MOCK_WORK_DURATION)
	yield* api.complete({ ...targetOf(message), payload: { markdown: echoReply(message.prompt) } }).pipe(
		Effect.retry({ schedule: Schedule.spaced(RETRY_EVERY), times: RETRY_TIMES, while: isRetryable }),
		Effect.catchTags({
			DeliveryClosed: (error) => Effect.logWarning('echo_agent.answer: the delivery already ended', error),
		}),
		Effect.tapError((error) => Effect.logError('echo_agent.answer failed', error)),
		Effect.ignore,
	)
})

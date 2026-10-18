import {
	BatchId,
	DeliveryContext,
	DeliveryHandoff,
	makeConversationId,
	makeDeliveryId,
	type HandoffOptions,
} from '@humanlayer/channels-delivery'
import { Effect, Redacted, Ref } from 'effect'

/** A `DeliveryContext` that counts `handoff()` calls instead of talking to a mailbox. */
export const makeFakeDeliveryContext = (mailboxKey: string) =>
	Effect.gen(function* () {
		const handoffs = yield* Ref.make(0)
		const options = yield* Ref.make<ReadonlyArray<HandoffOptions | undefined>>([])
		const deliveryId = makeDeliveryId({ mailboxKey, batchId: BatchId.make('test-batch') })
		const context = new DeliveryContext({
			deliveryId,
			conversationId: makeConversationId(mailboxKey),
			accessToken: Redacted.make('test-access-token'),
			handoff: (given) =>
				Ref.update(handoffs, (count) => count + 1).pipe(
					Effect.andThen(Ref.update(options, (all) => [...all, given])),
					Effect.as(DeliveryHandoff.make({ deliveryId })),
				),
		})
		return { context, handoffCalls: Ref.get(handoffs), handoffOptions: Ref.get(options) }
	})

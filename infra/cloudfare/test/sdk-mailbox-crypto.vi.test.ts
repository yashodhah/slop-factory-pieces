import * as NodeCrypto from '@effect/platform-node/NodeCrypto'
import { describe, expect, it } from '@effect/vitest'
import {
	claimOrDeferReadyMailbox,
	MailboxProcessingBackend,
	OutputReadyMailbox,
	QueueDeliveryMode,
	RecoverableMailbox,
} from '@humanlayer/channels-delivery'
import { Effect, Layer, Option } from 'effect'

/**
 * The live crash: the SDK's mailbox prepares output with `yield* crypto.randomUUIDv4`. That line only works with
 * the effect version the SDK was built for, so this runs the real SDK function on the project's installed effect.
 */
const backend = Layer.mock(MailboxProcessingBackend, {
	claimDeliveryOutput: () => Effect.succeed(Option.none()),
	claimMailbox: () => Effect.succeed(Option.none()),
})

const claim = (mailbox: OutputReadyMailbox | RecoverableMailbox) =>
	claimOrDeferReadyMailbox({ mailbox, leaseMs: 10_000, deliveryModeFor: () => QueueDeliveryMode.make({}) }).pipe(
		Effect.provide(Layer.merge(backend, NodeCrypto.layer)),
	)

describe('the SDK mailbox on the installed effect', () => {
	it.effect('prepares output for a mailbox that has output ready', () =>
		Effect.gen(function* () {
			const outcome = yield* claim(OutputReadyMailbox.make({ mailboxKey: 'github:issue:1' }))
			expect(outcome._tag).toBe('Skipped')
		}),
	)

	it.effect('recovers a mailbox with a frozen batch', () =>
		Effect.gen(function* () {
			const outcome = yield* claim(RecoverableMailbox.make({ mailboxKey: 'github:issue:1' }))
			expect(outcome._tag).toBe('Skipped')
		}),
	)
})

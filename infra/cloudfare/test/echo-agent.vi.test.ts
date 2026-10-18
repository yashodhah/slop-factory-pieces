import { describe, expect, it } from '@effect/vitest'
import {
	DeliveryClosed,
	DeliveryId,
	DeliveryNotFound,
	type DeliveryClient,
	type DeliveryClientTarget,
} from '@humanlayer/channels-delivery'
import { GitHubId, GitHubIssue, GitHubIssueRef } from '@humanlayer/channels-github'
import { Effect, Fiber, Layer, Redacted, Ref } from 'effect'
import { TestClock } from 'effect/testing'

import { AgentSessionMessage } from '../src/AgentSessionMessage'
import { DeliveryApi } from '../src/DeliveryApi'
import { answer } from '../src/EchoAgent'

const message = AgentSessionMessage.make({
	prompt: 'why does CI fail?',
	githubDiscussion: GitHubIssue.make({
		ref: GitHubIssueRef.make({
			installationId: GitHubId.make(100),
			repositoryId: GitHubId.make(200),
			owner: 'acme',
			repository: 'web',
			number: GitHubId.make(42),
		}),
		mailboxKey: 'github:issue:42',
	}),
	deliveryId: DeliveryId.make('delivery:v1:abc:def'),
	accessToken: Redacted.make('secret-token'),
})

type CompleteCall = DeliveryClientTarget & { readonly payload?: { readonly markdown?: string } }

/** A DeliveryApi whose `complete` fails with each scripted error in turn, then succeeds. Only `complete` exists. */
const fakeDeliveryApi = (failures: ReadonlyArray<DeliveryNotFound | DeliveryClosed>) =>
	Effect.gen(function* () {
		const calls = yield* Ref.make<ReadonlyArray<CompleteCall>>([])
		const order = yield* Ref.make<ReadonlyArray<string>>([])
		const activity = yield* Ref.make<ReadonlyArray<unknown>>([])
		const set = (call: { readonly activity: unknown }) =>
			Ref.update(order, (all) => [...all, 'activity']).pipe(
				Effect.andThen(Ref.update(activity, (all) => [...all, call.activity])),
			)
		const complete = (call: CompleteCall) =>
			Effect.gen(function* () {
				yield* Ref.update(order, (all) => [...all, 'complete'])
				const before = yield* Ref.getAndUpdate(calls, (all) => [...all, call])
				const failure = failures[before.length]
				if (failure !== undefined) return yield* Effect.fail(failure)
				return { _tag: 'DeliveryMutationReceipt', deliveryId: message.deliveryId, status: 'accepted' } as const
			})
		// The test double implements the one method `answer` calls, so it is widened to the client type here.
		const layer = Layer.succeed(DeliveryApi, { complete, activity: { set } } as unknown as DeliveryClient)
		return { calls, order, activity, layer }
	})

describe('answer', () => {
	it.effect('completes the delivery once with the echo reply, the delivery id and the token', () =>
		Effect.gen(function* () {
			const { calls, layer } = yield* fakeDeliveryApi([])
			yield* answer(message).pipe(Effect.provide(layer))
			const all = yield* Ref.get(calls)
			expect(all).toHaveLength(1)
			expect(all[0]?.deliveryId).toBe(message.deliveryId)
			expect(Redacted.value(all[0]!.accessToken)).toBe('secret-token')
			expect(all[0]?.payload?.markdown).toContain('Got it')
			expect(all[0]?.payload?.markdown).toContain('"why does CI fail?"')
		}),
	)

	it.effect('shows Working before it completes, so GitHub clears the eyes reaction', () =>
		Effect.gen(function* () {
			const { order, activity, layer } = yield* fakeDeliveryApi([])
			yield* answer(message).pipe(Effect.provide(layer))
			expect(yield* Ref.get(order)).toEqual(['activity', 'complete'])
			expect(yield* Ref.get(activity)).toMatchObject([{ _tag: 'Working' }])
		}),
	)

	it.effect('retries every 10 seconds while the delivery is not found yet, then completes', () =>
		Effect.gen(function* () {
			const { calls, layer } = yield* fakeDeliveryApi([new DeliveryNotFound(), new DeliveryNotFound()])
			const fiber = yield* answer(message).pipe(Effect.provide(layer), Effect.forkChild)
			yield* TestClock.adjust('10 seconds')
			yield* TestClock.adjust('10 seconds')
			yield* Fiber.join(fiber)
			expect(yield* Ref.get(calls)).toHaveLength(3)
		}),
	)

	it.effect('treats an already closed delivery as done without more calls', () =>
		Effect.gen(function* () {
			const { calls, layer } = yield* fakeDeliveryApi([new DeliveryClosed()])
			yield* answer(message).pipe(Effect.provide(layer))
			expect(yield* Ref.get(calls)).toHaveLength(1)
		}),
	)
})

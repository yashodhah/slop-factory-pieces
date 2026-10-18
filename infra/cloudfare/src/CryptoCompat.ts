import * as NodeCrypto from '@effect/platform-node/NodeCrypto'
import { Crypto, Effect, Layer } from 'effect'

/**
 * `Crypto` for the Worker and its Durable Objects, bridging two versions that disagree.
 *
 * Alchemy 2.0.0-beta.83 needs effect 4.0.5 (`effect/Path.make`). In effect 4.0.5 `Crypto.randomUUIDv4` is a
 * method, but `@humanlayer/channels-delivery` 0.1.0 yields it as a value (`MailboxProcessing.js`, when it
 * prepares output), which crashes every mailbox alarm. This serves `randomUUIDv4` as an Effect and passes every
 * other member through. Remove it once the SDK is released against effect 4.0.5.
 */
export const CryptoCompat = Layer.effect(
	Crypto.Crypto,
	Effect.gen(function* () {
		const crypto = yield* Crypto.Crypto
		return new Proxy(crypto, {
			get: (target, key) => {
				if (key === 'randomUUIDv4') return Effect.suspend(() => target.randomUUIDv4())
				const member: unknown = Reflect.get(target, key, target)
				return typeof member === 'function' ? member.bind(target) : member
			},
		})
	}),
).pipe(Layer.provide(NodeCrypto.layer))

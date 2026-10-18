import { describe, expect, it } from '@effect/vitest'
import { Crypto, Effect } from 'effect'

import { CryptoCompat } from '../src/CryptoCompat'

describe('CryptoCompat', () => {
	it.effect('exposes randomUUIDv4 as a value the SDK can yield, giving a fresh uuid each time', () =>
		Effect.gen(function* () {
			const crypto = yield* Crypto.Crypto
			// This is how @humanlayer/channels-delivery 0.1.0 reads it (MailboxProcessing.js); effect 4.0.5 types it as a method.
			const asValue = crypto as unknown as { readonly randomUUIDv4: Effect.Effect<string> }
			const first = yield* asValue.randomUUIDv4
			const second = yield* asValue.randomUUIDv4
			expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
			expect(second).not.toBe(first)
		}).pipe(Effect.provide(CryptoCompat)),
	)

	it.effect('keeps the other Crypto members the SDK calls working', () =>
		Effect.gen(function* () {
			const crypto = yield* Crypto.Crypto
			expect((yield* crypto.randomBytes(16)).length).toBe(16)
			expect((yield* crypto.digest('SHA-256', new TextEncoder().encode('x'))).length).toBe(32)
		}).pipe(Effect.provide(CryptoCompat)),
	)
})

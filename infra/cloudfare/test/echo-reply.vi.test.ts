import { describe, expect, it } from '@effect/vitest'

import { echoReply } from '../src/EchoReply'

describe('echoReply', () => {
	it('quotes the prompt back with an acknowledgement', () => {
		const reply = echoReply('hello there')
		expect(reply).toContain('Got it')
		expect(reply).toContain('"hello there"')
	})

	it('says there was no text when the prompt is blank', () => {
		expect(echoReply('   \n ')).toBe(
			'Got it (no text in the comment). The broker, mailbox, handoff and delivery API all worked.',
		)
	})

	it('quotes at most 80 characters and marks the cut with an ellipsis', () => {
		const reply = echoReply('a'.repeat(200))
		expect(reply).toContain(`"${'a'.repeat(80)}…"`)
		expect(reply).not.toContain('a'.repeat(81))
	})
})

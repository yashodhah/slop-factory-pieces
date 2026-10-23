import { describe, expect, it } from '@effect/vitest'
import { DeliveryId } from '@humanlayer/channels-delivery'
import { JiraIssueId, JiraIssueRef } from '@humanlayer/channels-jira'
import { Effect, Exit, Redacted } from 'effect'

import { ensureMessageForMailbox } from '../src/AgentSessionDO'
import { AgentSessionMessage } from '@slop/core'

/** The Durable Object's own guard; the object itself needs the Workers runtime, so the guard is tested alone. */
const jiraMessage = (mailboxKey: string) =>
	AgentSessionMessage.make({
		prompt: 'Add rate limiting',
		discussion: JiraIssueRef.make({ id: JiraIssueId.make('10042'), key: 'ABC-7', mailboxKey }),
		deliveryId: DeliveryId.make('delivery:v1:abc:def'),
		accessToken: Redacted.make('test-access-token'),
	})

describe('AgentSession mailbox key guard', () => {
	it.effect('accepts a Jira message for this Durable Object', () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(ensureMessageForMailbox(jiraMessage('jira:issue:10042'), 'jira:issue:10042'))
			expect(Exit.isSuccess(exit)).toBe(true)
		}),
	)

	it.effect('dies for a Jira message whose mailbox key is another Durable Object name', () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(ensureMessageForMailbox(jiraMessage('jira:issue:99'), 'jira:issue:10042'))
			expect(Exit.isFailure(exit) && Exit.hasDies(exit)).toBe(true)
		}),
	)
})

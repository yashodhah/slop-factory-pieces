import { describe, it } from '@effect/vitest'
import { JiraApi, JiraApiError, JiraIssueId, JiraIssueRef, JiraMentioned } from '@humanlayer/channels-jira'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { Effect, Layer, Ref } from 'effect'

import type { AgentSessionMessage } from '../src/AgentSessionMessage'
import { AgentSessions } from '../src/AgentSessionDO'
import { jiraHandlers, makeJiraHandlers } from '../src/JiraBot'
import { makeFakeDeliveryContext } from './support/delivery-context'

const issue = JiraIssueRef.make({
	id: JiraIssueId.make('10042'),
	key: 'ABC-42',
	mailboxKey: 'jira:issue:10042',
})

const mention = (afterMention: string) =>
	JiraMentioned.make({
		issue,
		comment: {
			id: '7001',
			body: `@slopcodebot ${afterMention}`.trim(),
			afterMention,
			author: { accountId: 'person-1', displayName: 'Person One' },
		},
		eventId: 'jira-event-1',
	})

interface Recorded {
	readonly sent: ReadonlyArray<{ readonly mailboxKey: string; readonly message: typeof AgentSessionMessage.Encoded }>
	readonly fetched: ReadonlyArray<string>
}

type FetchIssue = JiraApi['Service']['fetchIssue']

const describedIssue: FetchIssue = (key) =>
	Effect.succeed({ key, title: 'Login times out', description: 'After 30 seconds the page hangs.' })

/** Run `onMentioned` once against a fake Jira API and AgentSession; return what was sent and handed off. */
const runOnMentioned = (
	event: JiraMentioned,
	options: { readonly fetchIssue?: FetchIssue; readonly handlers?: typeof jiraHandlers } = {},
) =>
	Effect.gen(function* () {
		const recorded = yield* Ref.make<Recorded>({ sent: [], fetched: [] })
		const delivery = yield* makeFakeDeliveryContext(event.issue.mailboxKey)
		const fetchIssue = options.fetchIssue ?? describedIssue
		const layer = Layer.mergeAll(
			Layer.mock(JiraApi, {
				fetchIssue: (key) =>
					Ref.update(recorded, (current) => ({ ...current, fetched: [...current.fetched, key] })).pipe(
						Effect.andThen(fetchIssue(key)),
					),
			}),
			Layer.succeed(
				AgentSessions,
				AgentSessions.of({
					getByName: (mailboxKey: string) => ({
						send: (message: typeof AgentSessionMessage.Encoded) =>
							Ref.update(recorded, (current) => ({ ...current, sent: [...current.sent, { mailboxKey, message }] })),
					}),
				}),
			),
			Layer.mock(RuntimeContext, { Type: 'Worker', id: 'jira-bot-test', env: {} }),
		)
		const handlers = options.handlers ?? jiraHandlers
		yield* handlers.onMentioned(event, delivery.context).pipe(Effect.provide(layer))
		return {
			recorded: yield* Ref.get(recorded),
			handoffs: yield* delivery.handoffCalls,
			handoffOptions: yield* delivery.handoffOptions,
			delivery: delivery.context,
		}
	})

describe('Jira onMentioned with /research', () => {
	it.effect('sends one message to the issue AgentSession, then hands off with a 10 minute failAfter', ({ expect }) =>
		Effect.gen(function* () {
			const result = yield* runOnMentioned(mention('/research why is login slow'))
			expect(result.recorded.fetched).toEqual(['ABC-42'])
			expect(result.recorded.sent).toHaveLength(1)
			const [sent] = result.recorded.sent
			expect(sent?.mailboxKey).toBe(issue.mailboxKey)
			expect(sent?.message).toMatchObject({
				prompt: 'Login times out\nAfter 30 seconds the page hangs.\nwhy is login slow',
				deliveryId: result.delivery.deliveryId,
				discussion: { id: '10042', key: 'ABC-42', mailboxKey: issue.mailboxKey },
			})
			expect(result.handoffs).toBe(1)
			expect(result.handoffOptions).toEqual([{ failAfter: '10 minutes' }])
		}),
	)

	it.effect('leaves out a missing description and empty args', ({ expect }) =>
		Effect.gen(function* () {
			const result = yield* runOnMentioned(mention('/Research'), {
				fetchIssue: (key) => Effect.succeed({ key, title: 'Login times out', description: null }),
			})
			expect(result.recorded.sent[0]?.message.prompt).toBe('Login times out')
			expect(result.handoffs).toBe(1)
		}),
	)

	it.effect('still sends when fetching the issue fails, with the issue key and the args', ({ expect }) =>
		Effect.gen(function* () {
			const result = yield* runOnMentioned(mention('/research look at X'), {
				fetchIssue: () => Effect.fail(JiraApiError.make({ operation: 'fetch_issue', retryable: true, status: 503 })),
			})
			expect(result.recorded.sent).toHaveLength(1)
			const prompt = result.recorded.sent[0]?.message.prompt
			expect(prompt).toContain('ABC-42')
			expect(prompt).toContain('look at X')
			expect(prompt).not.toContain('Login times out')
			expect(result.handoffs).toBe(1)
		}),
	)
})

describe('Jira onMentioned without a known command', () => {
	for (const afterMention of ['', 'hello', '/foo', 'hello /research']) {
		it.effect(`${JSON.stringify(afterMention)}: no fetch, no send, no handoff`, ({ expect }) =>
			Effect.gen(function* () {
				const result = yield* runOnMentioned(mention(afterMention))
				expect(result.recorded.fetched).toEqual([])
				expect(result.recorded.sent).toEqual([])
				expect(result.handoffs).toBe(0)
			}),
		)
	}
})

describe('Jira onMentioned when the access policy denies', () => {
	it.effect('sends nothing and does not hand off', ({ expect }) =>
		Effect.gen(function* () {
			const handlers = makeJiraHandlers({ authorize: () => Effect.succeed(false) })
			const result = yield* runOnMentioned(mention('/research'), { handlers })
			expect(result.recorded.fetched).toEqual([])
			expect(result.recorded.sent).toEqual([])
			expect(result.handoffs).toBe(0)
		}),
	)
})

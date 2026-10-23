import { describe, it } from '@effect/vitest'
import { JiraApi, JiraApiError, JiraIssueId, JiraIssueRef, JiraMentioned } from '@humanlayer/channels-jira'
import { Effect, Fiber, Layer, Redacted, Ref } from 'effect'
import { TestClock } from 'effect/testing'

import { type AgentSessionMessage, AgentSessions } from '@slop/core'
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
	readonly posted: ReadonlyArray<Parameters<PostComment>[0]>
	/** The order of Jira calls and AgentSession sends. */
	readonly order: ReadonlyArray<'fetch' | 'ack' | 'send'>
}

type FetchIssue = JiraApi['Service']['fetchIssue']
type PostComment = JiraApi['Service']['postComment']

const postedOk: PostComment = () => Effect.succeed({ commentId: '9001' })

const describedIssue: FetchIssue = (key) =>
	Effect.succeed({ key, title: 'Login times out', description: 'After 30 seconds the page hangs.' })

/** Run `onMentioned` once against a fake Jira API and AgentSession; return what was sent and handed off. */
const runOnMentioned = (
	event: JiraMentioned,
	options: {
		readonly fetchIssue?: FetchIssue
		readonly postComment?: PostComment
		readonly handlers?: typeof jiraHandlers
	} = {},
) =>
	Effect.gen(function* () {
		const recorded = yield* Ref.make<Recorded>({ sent: [], fetched: [], posted: [], order: [] })
		const delivery = yield* makeFakeDeliveryContext(event.issue.mailboxKey)
		const fetchIssue = options.fetchIssue ?? describedIssue
		const postComment = options.postComment ?? postedOk
		const layer = Layer.mergeAll(
			Layer.mock(JiraApi, {
				fetchIssue: (key) =>
					Ref.update(recorded, (current) => ({
						...current,
						fetched: [...current.fetched, key],
						order: [...current.order, 'fetch' as const],
					})).pipe(Effect.andThen(fetchIssue(key))),
				postComment: (input) =>
					Ref.update(recorded, (current) => ({
						...current,
						posted: [...current.posted, input],
						order: [...current.order, 'ack' as const],
					})).pipe(Effect.andThen(postComment(input))),
			}),
			Layer.succeed(
				AgentSessions,
				AgentSessions.of({
					getByName: (mailboxKey: string) => ({
						send: (message: typeof AgentSessionMessage.Encoded) =>
							Ref.update(recorded, (current) => ({
								...current,
								sent: [...current.sent, { mailboxKey, message }],
								order: [...current.order, 'send' as const],
							})),
					}),
				}),
			),
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
				accessToken: Redacted.value(result.delivery.accessToken),
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

describe('Jira onMentioned when fetching the issue hangs', () => {
	it.effect('gives up after 5 seconds and sends the comment-only prompt', ({ expect }) =>
		Effect.gen(function* () {
			const fiber = yield* runOnMentioned(mention('/research look at X'), { fetchIssue: () => Effect.never }).pipe(
				Effect.forkChild,
			)
			yield* TestClock.adjust('4999 millis')
			expect(fiber.pollUnsafe()).toBeUndefined()
			yield* TestClock.adjust('1 millis')
			expect(fiber.pollUnsafe()).toBeDefined()
			const result = yield* Fiber.join(fiber)
			expect(result.recorded.sent).toHaveLength(1)
			expect(result.recorded.sent[0]?.message.prompt).toBe('Jira issue ABC-42\nlook at X')
			expect(result.handoffOptions).toEqual([{ failAfter: '10 minutes' }])
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

describe('Jira onMentioned acknowledgement', () => {
	it.effect('posts one "👀 On it" comment on the issue, without a mention, before sending to the AgentSession', ({ expect }) =>
		Effect.gen(function* () {
			const result = yield* runOnMentioned(mention('/research why is login slow'))
			expect(result.recorded.posted).toEqual([{ issueKey: 'ABC-42', markdown: '👀 On it' }])
			expect(result.recorded.order.indexOf('ack')).toBeLessThan(result.recorded.order.indexOf('send'))
			expect(result.recorded.sent).toHaveLength(1)
			expect(result.handoffs).toBe(1)
		}),
	)

	for (const afterMention of ['', 'hello', '/foo']) {
		it.effect(`${JSON.stringify(afterMention)}: no acknowledgement`, ({ expect }) =>
			Effect.gen(function* () {
				const result = yield* runOnMentioned(mention(afterMention))
				expect(result.recorded.posted).toEqual([])
			}),
		)
	}

	it.effect('posts no acknowledgement when the access policy denies', ({ expect }) =>
		Effect.gen(function* () {
			const handlers = makeJiraHandlers({ authorize: () => Effect.succeed(false) })
			const result = yield* runOnMentioned(mention('/research'), { handlers })
			expect(result.recorded.posted).toEqual([])
		}),
	)

	it.effect('still sends and hands off when the acknowledgement fails', ({ expect }) =>
		Effect.gen(function* () {
			const result = yield* runOnMentioned(mention('/research look at X'), {
				postComment: () => Effect.fail(JiraApiError.make({ operation: 'post_comment', retryable: false, status: 403 })),
			})
			expect(result.recorded.posted).toHaveLength(1)
			expect(result.recorded.sent).toHaveLength(1)
			expect(result.handoffs).toBe(1)
		}),
	)

	it.effect('gives up on a hung acknowledgement after 5 seconds and still sends and hands off', ({ expect }) =>
		Effect.gen(function* () {
			const fiber = yield* runOnMentioned(mention('/research look at X'), { postComment: () => Effect.never }).pipe(
				Effect.forkChild,
			)
			yield* TestClock.adjust('4999 millis')
			expect(fiber.pollUnsafe()).toBeUndefined()
			yield* TestClock.adjust('1 millis')
			const result = yield* Fiber.join(fiber)
			expect(result.recorded.sent).toHaveLength(1)
			expect(result.handoffs).toBe(1)
		}),
	)
})

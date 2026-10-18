import { describe, it } from '@effect/vitest'
import { MailboxSubscriptionCreatedResult, MailboxSubscriptions } from '@humanlayer/channels-delivery'
import {
	type GitHubAccessLevel,
	GitHubApi,
	GitHubContent,
	GitHubDiscussionRef,
	GitHubEventId,
	GitHubId,
	GitHubIssue,
	GitHubIssueComment,
	GitHubIssueCommentCreated,
	GitHubIssueMentioned,
	GitHubIssueOpened,
	GitHubIssueRef,
	GitHubParticipant,
	GitHubPrCommentCreated,
	GitHubPrMentioned,
	GitHubPrOpened,
	GitHubPullRequest,
	GitHubPullRequestRef,
	GitHubReactionTarget,
	type GitHubReactionRequest,
} from '@humanlayer/channels-github'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { ConfigProvider, Effect, Layer, Ref } from 'effect'

import type { AgentSessionMessage } from '../src/AgentSessionMessage'
import { AgentSessions } from '../src/AgentSessionDO'
import { githubHandlers, maintainerOnlyNotice, mentionPrompt } from '../src/GithubBot'
import { makeFakeDeliveryContext } from './support/delivery-context'

const repository = {
	installationId: GitHubId.make(100),
	repositoryId: GitHubId.make(200),
	owner: 'acme',
	repository: 'web',
}
const issue = GitHubIssue.make({
	ref: GitHubIssueRef.make({ ...repository, number: GitHubId.make(42) }),
	mailboxKey: 'github:issue:42',
})
const pullRequest = GitHubPullRequest.make({
	ref: GitHubPullRequestRef.make({ ...repository, number: GitHubId.make(43) }),
	mailboxKey: 'github:pr:43',
})
const issueDiscussion = GitHubDiscussionRef.cases.Issue.make({ ref: issue.ref })
const prDiscussion = GitHubDiscussionRef.cases.PullRequest.make({ ref: pullRequest.ref })
const person = GitHubParticipant.make({ id: GitHubId.make(1), login: 'user-1', type: 'User' })
const botAuthor = GitHubParticipant.make({ id: GitHubId.make(999), login: 'agent[bot]', type: 'Bot' })

const commentRecord = (discussion: GitHubDiscussionRef, author: GitHubParticipant, body: string, id: number) =>
	GitHubIssueComment.make({
		ref: { discussion, id: GitHubId.make(id) },
		body,
		url: `https://github.com/acme/web/issues/42#issuecomment-${id}`,
		author,
	})

const eventId = GitHubEventId.make('mention-by-user-1')

const mentions = (body: string) => {
	const issueComment = GitHubIssueCommentCreated.make({
		issue,
		actor: person,
		eventId,
		comment: commentRecord(issueDiscussion, person, body, 1),
	})
	const prComment = GitHubPrCommentCreated.make({
		pullRequest,
		actor: person,
		eventId,
		comment: commentRecord(prDiscussion, person, body, 2),
	})
	return [
		{
			name: 'issue comment',
			mailboxKey: issue.mailboxKey,
			discussion: issueDiscussion,
			event: GitHubIssueMentioned.make({ issue, trigger: issueComment, events: [issueComment] }),
			target: GitHubReactionTarget.cases.Comment.make({ comment: issueComment.comment.ref }),
		},
		{
			name: 'PR comment',
			mailboxKey: pullRequest.mailboxKey,
			discussion: prDiscussion,
			event: GitHubPrMentioned.make({ pullRequest, trigger: prComment, events: [prComment] }),
			target: GitHubReactionTarget.cases.Comment.make({ comment: prComment.comment.ref }),
		},
	]
}

interface Recorded {
	readonly reactions: ReadonlyArray<GitHubReactionRequest>
	readonly posts: ReadonlyArray<{ readonly discussion: GitHubDiscussionRef; readonly content: GitHubContent }>
	readonly comments: ReadonlyArray<GitHubIssueComment>
	readonly sent: ReadonlyArray<{ readonly mailboxKey: string; readonly message: typeof AgentSessionMessage.Encoded }>
	readonly subscribed: ReadonlyArray<string>
}

/** Run `onMentioned` for each event in turn against one fake GitHub, AgentSession and mailbox. */
const runOnMentioned = (
	fixtures: ReadonlyArray<ReturnType<typeof mentions>[number]>,
	access: GitHubAccessLevel,
) =>
	Effect.gen(function* () {
		const recorded = yield* Ref.make<Recorded>({ reactions: [], posts: [], comments: [], sent: [], subscribed: [] })
		const [first] = fixtures
		const delivery = yield* makeFakeDeliveryContext(first?.mailboxKey ?? issue.mailboxKey)
		const post = (discussion: GitHubDiscussionRef, content: GitHubContent) =>
			Ref.modify(recorded, (current) => {
				const comment = commentRecord(discussion, botAuthor, content.markdown, 500 + current.posts.length)
				return [
					comment,
					{ ...current, posts: [...current.posts, { discussion, content }], comments: [...current.comments, comment] },
				] as const
			})
		const layer = Layer.mergeAll(
			ConfigProvider.layer(ConfigProvider.fromUnknown({ GITHUB_BOT_USER_ID: '999' })),
			Layer.mock(GitHubApi, {
				fetchUserAccess: () => Effect.succeed(access),
				addReaction: (input) =>
					Ref.update(recorded, (current) => ({ ...current, reactions: [...current.reactions, input] })),
				listIssueComments: () => Ref.get(recorded).pipe(Effect.map((current) => current.comments)),
				listPullRequestComments: () => Ref.get(recorded).pipe(Effect.map((current) => current.comments)),
				postIssueComment: ({ issue: ref, content }) =>
					post(GitHubDiscussionRef.cases.Issue.make({ ref }), content),
				postPullRequestComment: ({ pullRequest: ref, content }) =>
					post(GitHubDiscussionRef.cases.PullRequest.make({ ref }), content),
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
			Layer.mock(MailboxSubscriptions, {
				subscribe: ({ mailboxKey }) =>
					Ref.update(recorded, (current) => ({ ...current, subscribed: [...current.subscribed, mailboxKey] })).pipe(
						Effect.as(MailboxSubscriptionCreatedResult.make({})),
					),
			}),
			Layer.mock(RuntimeContext, { Type: 'Worker', id: 'github-bot-test', env: {} }),
		)
		for (const fixture of fixtures) {
			yield* githubHandlers.onMentioned(fixture.event, delivery.context).pipe(Effect.provide(layer))
		}
		return { recorded: yield* Ref.get(recorded), handoffs: yield* delivery.handoffCalls, handoffOptions: yield* delivery.handoffOptions, delivery: delivery.context }
	})

describe('onMentioned with write access', () => {
	for (const fixture of mentions('@agent why does CI fail?')) {
		it.effect(`${fixture.name}: reacts, sends to the AgentSession, then hands off once, without subscribing the discussion`, ({ expect }) =>
			Effect.gen(function* () {
				const result = yield* runOnMentioned([fixture], 'write')
				expect(result.recorded.reactions).toEqual([{ target: fixture.target, reaction: 'eyes' }])
				// A subscribed discussion routes every later event, mentions included, to onSubscribed*Events, which this bot lacks.
				expect(result.recorded.subscribed).toEqual([])
				expect(result.recorded.sent).toHaveLength(1)
				const [sent] = result.recorded.sent
				expect(sent?.mailboxKey).toBe(fixture.mailboxKey)
				expect(sent?.message).toMatchObject({
					prompt: '@agent why does CI fail?',
					deliveryId: result.delivery.deliveryId,
					githubDiscussion: { mailboxKey: fixture.mailboxKey },
				})
				expect(result.handoffs).toBe(1)
			}),
		)
	}

	it.effect('hands off with a 10 minute failAfter so a lost agent cannot block the discussion for a day', ({ expect }) =>
		Effect.gen(function* () {
			const [fixture] = mentions('@agent help')
			const result = yield* runOnMentioned([fixture!], 'write')
			expect(result.handoffOptions).toEqual([{ failAfter: '10 minutes' }])
		}),
	)

	it.effect('passes a bare "@agent" mention through as written', ({ expect }) =>
		Effect.gen(function* () {
			const [fixture] = mentions('@agent')
			const result = yield* runOnMentioned([fixture!], 'write')
			expect(result.recorded.sent[0]?.message.prompt).toBe('@agent')
			expect(result.handoffs).toBe(1)
		}),
	)
})

describe('onMentioned without write access', () => {
	for (const fixture of mentions('@agent help')) {
		it.effect(`${fixture.name}: 👎, one notice, no agent, no handoff, even on a second denied mention`, ({ expect }) =>
			Effect.gen(function* () {
				const result = yield* runOnMentioned([fixture, fixture], 'read')
				expect(result.recorded.reactions).toEqual([
					{ target: fixture.target, reaction: '-1' },
					{ target: fixture.target, reaction: '-1' },
				])
				expect(result.recorded.posts).toEqual([
					{ discussion: fixture.discussion, content: { markdown: maintainerOnlyNotice } },
				])
				expect(result.recorded.sent).toEqual([])
				expect(result.recorded.subscribed).toEqual([])
				expect(result.handoffs).toBe(0)
			}),
		)
	}
})

describe('mentionPrompt', () => {
	const actor = person
	const opened = (body: string | null) =>
		GitHubIssueMentioned.make({
			issue,
			trigger: GitHubIssueOpened.make({ issue, actor, eventId, title: 'Login times out', body }),
			events: [],
		})

	it('joins the title and body of an opened issue', ({ expect }) => {
		expect(mentionPrompt(opened('@agent please look'))).toBe('Login times out\n@agent please look')
	})

	it('is just the title when an opened issue has no body', ({ expect }) => {
		expect(mentionPrompt(opened(null))).toBe('Login times out')
	})

	it('is the title and body of an opened pull request', ({ expect }) => {
		const trigger = GitHubPrOpened.make({ pullRequest, actor, eventId, title: 'Fix it', body: '@agent review' })
		expect(mentionPrompt(GitHubPrMentioned.make({ pullRequest, trigger, events: [] }))).toBe('Fix it\n@agent review')
	})
})

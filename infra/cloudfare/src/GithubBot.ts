/**
 * The bot: its providers (GitHub here, Jira from `./JiraBot`), callback and event processing settings.
 * The Worker and the Durable Object both build their half from this one value.
 */
import { ChannelsCloudflare } from '@humanlayer/channels-alchemy-cloudflare'
import {
	DebounceDeliveryMode,
	type DeliveryContext,
	type DeliveryHandoffError,
	type MailboxSubscriptionError,
	type MailboxSubscriptions,
} from '@humanlayer/channels-delivery'
import {
	GitHubApi,
	GitHubBot,
	GitHubContent,
	GitHubDiscussionRef,
	GitHubId,
	GitHubReaction,
	GitHubReactionTarget,
	hasGitHubAccess,
	type GitHubApiError,
	type GitHubCallbackHandlers,
	type GitHubMentioned,
	type GitHubRepositoryRef,
} from '@humanlayer/channels-github'
import { Config, Effect, Match, Predicate, Schema } from 'effect'

import { AgentSessionMessage, AgentSessions } from '@slop/core'
import { jira } from './JiraBot'

export const maintainerOnlyNotice =
	'This agent can only be invoked by maintainers (users with write access or higher to this repository).'

const gitHubMentionDiscussion = (event: GitHubMentioned) =>
	Match.value(event).pipe(
		Match.tagsExhaustive({
			GitHubIssueMentioned: ({ issue }) => issue,
			GitHubPrMentioned: ({ pullRequest }) => pullRequest,
		}),
	)

/**
 * check if a user has mention access. if so, send eyes when we start working.
 * If not, send a thumbs down - AND, if not posted already in the issue/pr, a comment indicating it can only be used by maintainers
 */
export const respondToMentionAccess = Effect.fn('bot.github.respondToMentionAccess')(function* (
	event: GitHubMentioned,
) {
	const discussion = gitHubMentionDiscussion(event)
	const access = yield* discussion.fetchUserAccess(event.trigger.actor.login).pipe(
		Effect.catchIf(
			(error) => error.reason === 'not_found',
			(error) =>
				Effect.logInfo('GitHub could not resolve the mention author; denying access', error).pipe(
					Effect.as('none' as const),
				),
		),
	)
	const allowed = hasGitHubAccess({ access, minimum: 'write' })
	const target = Match.value(event.trigger).pipe(
		Match.tagsExhaustive({
			GitHubIssueOpened: ({ issue }) =>
				GitHubReactionTarget.cases.Discussion.make({
					discussion: GitHubDiscussionRef.cases.Issue.make({ ref: issue.ref }),
				}),
			GitHubPrOpened: ({ pullRequest }) =>
				GitHubReactionTarget.cases.Discussion.make({
					discussion: GitHubDiscussionRef.cases.PullRequest.make({ ref: pullRequest.ref }),
				}),
			GitHubIssueCommentCreated: ({ comment }) =>
				GitHubReactionTarget.cases.Comment.make({ comment: comment.ref }),
			GitHubPrCommentCreated: ({ comment }) => GitHubReactionTarget.cases.Comment.make({ comment: comment.ref }),
			GitHubPrReviewCommentCreated: ({ comment }) =>
				GitHubReactionTarget.cases.Comment.make({ comment: comment.ref }),
		}),
	)
	const api = yield* GitHubApi
	yield* api.addReaction({ target, reaction: GitHubReaction.make(allowed ? 'eyes' : '-1') })
	if (allowed) return true

	yield* Effect.logWarning('Bot mention denied: the author lacks write access').pipe(
		Effect.annotateLogs({ actor: event.trigger.actor.login, access }),
	)
	const botUserId = yield* Config.schema(GitHubId, 'GITHUB_BOT_USER_ID')
	const comments = yield* discussion.listComments()
	const alreadyNotified = comments.some(
		(comment) => comment.author?.id === botUserId && comment.body === maintainerOnlyNotice,
	)
	if (!alreadyNotified) yield* discussion.postComment(GitHubContent.make({ markdown: maintainerOnlyNotice }))
	return false
})

/** Lines of text, without the missing ones, as one string. */
const joinText = (lines: ReadonlyArray<string | null>) => lines.filter(Predicate.isNotNull).join('\n')

/** What the agent is asked: the comment that mentioned the bot, or the title and description of what was opened. */
export const mentionPrompt = (event: GitHubMentioned): string =>
	Match.value(event.trigger).pipe(
		Match.tagsExhaustive({
			GitHubIssueOpened: ({ title, body }) => joinText([title, body]),
			GitHubPrOpened: ({ title, body }) => joinText([title, body]),
			GitHubIssueCommentCreated: ({ comment }) => comment.body,
			GitHubPrCommentCreated: ({ comment }) => comment.body,
			GitHubPrReviewCommentCreated: ({ comment }) => comment.body,
		}),
	)

const githubRepositoryLogAnnotations = (ref: GitHubRepositoryRef) => ({
	'github.owner': ref.owner,
	'github.repository': ref.repository,
	'github.repository_id': ref.repositoryId,
	'github.installation_id': ref.installationId,
})

const HANDOFF_FAIL_AFTER = '10 minutes'

type HandlerError = GitHubApiError | Config.ConfigError | MailboxSubscriptionError | DeliveryHandoffError
type HandlerRequirements = GitHubApi | AgentSessions | MailboxSubscriptions

/**
 * GitHub App callbacks. An authorized mention hands the delivery to the discussion's AgentSession, which finishes
 * it. Until then the mailbox holds later events back. Mentions require write access or higher.
 *
 * The discussion is deliberately not subscribed: the SDK sends every event of a subscribed discussion, mentions
 * included, to `onSubscribedIssueEvents` / `onSubscribedPrEvents`, which this bot does not define, so later
 * mentions would be ignored as `callback_not_configured`. Subscribe once those handlers exist (multi-turn).
 */
export const githubHandlers = {
	onMentioned: (event: GitHubMentioned, context: DeliveryContext) => {
		const discussion = gitHubMentionDiscussion(event)
		return Effect.gen(function* () {
			if (!(yield* respondToMentionAccess(event))) return

			yield* Effect.logInfo('Authorized mention received')
			const message = yield* Schema.encodeEffect(AgentSessionMessage)(
				AgentSessionMessage.make({
					prompt: mentionPrompt(event),
					discussion,
					deliveryId: context.deliveryId,
					accessToken: context.accessToken,
				}),
			).pipe(Effect.orDie)
			const agentSessions = yield* AgentSessions
			yield* agentSessions.getByName(discussion.mailboxKey).send(message)
			/** Fail a lost agent's delivery soon, so it cannot hold back the discussion's mailbox for the default day. */
			return yield* context.handoff({ failAfter: HANDOFF_FAIL_AFTER })
		}).pipe(
			Effect.annotateLogs({
				...githubRepositoryLogAnnotations(discussion.ref),
				'github.discussion_kind': discussion._tag,
				'github.discussion_number': discussion.ref.number,
				'github.event_id': event.trigger.eventId,
				'github.actor': event.trigger.actor.login,
				'delivery.id': context.deliveryId,
			}),
		)
	},
} satisfies GitHubCallbackHandlers<HandlerError, HandlerRequirements>

const github = GitHubBot.make<HandlerError, HandlerRequirements>({
	webhookSecret: Config.Redacted('GITHUB_WEBHOOK_SECRET'),
	deliveryMode: DebounceDeliveryMode.make({ quietPeriodMs: 3_000, maxWaitMs: 3_000 }),
	bot: Config.all({
		mentionNames: Config.String('GITHUB_BOT_MENTION_NAME').pipe(Config.map((name) => [name])),
		botUserId: Config.schema(GitHubId, 'GITHUB_BOT_USER_ID'),
	}),
	handlers: githubHandlers,
})

export const bot = ChannelsCloudflare.make({
	namespace: 'slop-code-factory',
	providers: [github, jira],
	eventProcessing: {
		concurrency: 1,
		leaseMs: 10_000,
		maxAttempts: 5,
	},
})

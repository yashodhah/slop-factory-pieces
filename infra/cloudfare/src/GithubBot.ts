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
	GitHubBot,
	GitHubId,
	type GitHubApi,
	type GitHubApiError,
	type GitHubCallbackHandlers,
	type GitHubMentioned,
	type GitHubRepositoryRef,
} from '@humanlayer/channels-github'
import { Config, Effect, Option } from 'effect'

import { type AgentSessions, decideGitHubMention, gitHubMentionDiscussion } from '@slop/core'
import { handOff } from './Handoff'
import { jira } from './JiraBot'

const githubRepositoryLogAnnotations = (ref: GitHubRepositoryRef) => ({
	'github.owner': ref.owner,
	'github.repository': ref.repository,
	'github.repository_id': ref.repositoryId,
	'github.installation_id': ref.installationId,
})

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
			const request = yield* decideGitHubMention(event)
			if (Option.isNone(request)) return
			return yield* handOff(request.value, context)
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

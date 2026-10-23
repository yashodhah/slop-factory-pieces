/**
 * The Jira provider: a comment that mentions the bot with a known `/command` is acknowledged with a `👀 On it`
 * comment, then the delivery is handed to the issue's AgentSession. Mentions without a known command, or denied by
 * the access policy, are ignored silently (no acknowledgement, no reply, no agent run).
 */
import {
	DebounceDeliveryMode,
	type DeliveryContext,
	type DeliveryHandoffError,
} from '@humanlayer/channels-delivery'
import {
	JiraAccountId,
	JiraApi,
	JiraBot,
	type JiraCallbackHandlers,
	type JiraIssueInfo,
	type JiraMentioned,
} from '@humanlayer/channels-jira'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { Config, Effect, Option, Predicate, Schema } from 'effect'

import { AgentSessions } from './AgentSessionDO'
import { AgentSessionMessage, parseCommand } from '@slop/core'

/**
 * Whether the mention's author may invoke the bot. Access control is deferred: anyone who can comment on the
 * issue may, for now. A Jira permission check replaces this later.
 */
export const authorizeJiraMention = (_event: JiraMentioned): Effect.Effect<boolean> => Effect.succeed(true)

/** Lines of text, without the missing or empty ones, as one string. */
const joinText = (lines: ReadonlyArray<string | null>) =>
	lines.filter(Predicate.isNotNull).filter((line) => line.length > 0).join('\n')

/** What the agent is asked: the issue's title and description (or just its key if they are unknown) and the args. */
export const jiraPrompt = (input: {
	readonly issueKey: string
	readonly issue: Option.Option<JiraIssueInfo>
	readonly args: string
}): string =>
	Option.match(input.issue, {
		onNone: () => joinText([`Jira issue ${input.issueKey}`, input.args]),
		onSome: (issue) => joinText([issue.title, issue.description, input.args]),
	})

const HANDOFF_FAIL_AFTER = '10 minutes'
const FETCH_ISSUE_TIMEOUT = '5 seconds'
const ACK_TIMEOUT = '5 seconds'
/** Jira has no comment reactions, so the acknowledgement is a comment of its own. */
export const JIRA_ACK_MARKDOWN = '👀 On it'

type HandlerError = DeliveryHandoffError
type HandlerRequirements = JiraApi | RuntimeContext | AgentSessions

/** Builds the Jira callbacks; `authorize` is the access policy, swappable in tests. */
export const makeJiraHandlers = (
	options: { readonly authorize?: (event: JiraMentioned) => Effect.Effect<boolean> } = {},
) => {
	const authorize = options.authorize ?? authorizeJiraMention
	return {
		onMentioned: (event: JiraMentioned, context: DeliveryContext) =>
			Effect.gen(function* () {
				if (!(yield* authorize(event))) {
					yield* Effect.logWarning('Jira mention denied by the access policy')
					return
				}
				const command = parseCommand(event.comment.afterMention)
				if (Option.isNone(command)) {
					yield* Effect.logInfo('Jira mention without a known command; ignoring')
					return
				}

				const api = yield* JiraApi
				/** Best effort: a failed or hung acknowledgement is logged and never blocks the run. */
				yield* api.postComment({ issueKey: event.issue.key, markdown: JIRA_ACK_MARKDOWN }).pipe(
					Effect.timeout(ACK_TIMEOUT),
					Effect.catch((error) => Effect.logWarning('Could not acknowledge the Jira mention; continuing', error)),
					Effect.asVoid,
				)
				/** A hung fetch must not stall the run: after the timeout the prompt has the comment alone. */
				const issue = yield* api.fetchIssue(event.issue.key).pipe(
					Effect.timeout(FETCH_ISSUE_TIMEOUT),
					Effect.map(Option.some),
					Effect.catch((error) =>
						Effect.logWarning('Could not fetch the Jira issue; prompting with the comment alone', error).pipe(
							Effect.as(Option.none<JiraIssueInfo>()),
						),
					),
				)
				yield* Effect.logInfo('Jira command received').pipe(
					Effect.annotateLogs({ 'jira.command': command.value.name }),
				)
				const message = yield* Schema.encodeEffect(AgentSessionMessage)(
					AgentSessionMessage.make({
						prompt: jiraPrompt({ issueKey: event.issue.key, issue, args: command.value.args }),
						discussion: event.issue,
						deliveryId: context.deliveryId,
						accessToken: context.accessToken,
					}),
				).pipe(Effect.orDie)
				const agentSessions = yield* AgentSessions
				yield* agentSessions.getByName(event.issue.mailboxKey).send(message)
				/** Fail a lost agent's delivery soon, so it cannot hold back the issue's mailbox for the default day. */
				return yield* context.handoff({ failAfter: HANDOFF_FAIL_AFTER })
			}).pipe(
				Effect.annotateLogs({
					'jira.issue_key': event.issue.key,
					'jira.issue_id': event.issue.id,
					'jira.comment_id': event.comment.id,
					'jira.event_id': event.eventId,
					'jira.actor': event.comment.author.accountId,
					'delivery.id': context.deliveryId,
				}),
			),
	} satisfies JiraCallbackHandlers<HandlerError, HandlerRequirements>
}

export const jiraHandlers = makeJiraHandlers()

/**
 * Reads five variables: `JIRA_WEBHOOK_SECRET`, `JIRA_BASE_URL` (the site, used only for the mailbox key) and
 * `JIRA_BOT_ACCOUNT_ID` here, and `JIRA_CLOUD_ID` and `JIRA_API_TOKEN` in the SDK's default `JiraApiLive`, which
 * calls the Atlassian API gateway with the service account's token as a Bearer token.
 */
export const jira = JiraBot.make<HandlerError, HandlerRequirements>({
	webhookSecret: Config.Redacted('JIRA_WEBHOOK_SECRET'),
	deliveryMode: DebounceDeliveryMode.make({ quietPeriodMs: 3_000, maxWaitMs: 3_000 }),
	bot: Config.all({ accountId: Config.schema(JiraAccountId, 'JIRA_BOT_ACCOUNT_ID') }),
	/** The site's host is the installation id in each issue's mailbox key, so it must not change. */
	site: Config.schema(Schema.URLFromString, 'JIRA_BASE_URL').pipe(Config.map((url) => url.host)),
	handlers: jiraHandlers,
})

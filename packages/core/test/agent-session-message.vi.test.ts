import { describe, expect, it } from '@effect/vitest'
import { DeliveryId } from '@humanlayer/channels-delivery'
import { GitHubId, GitHubIssue, GitHubIssueRef, GitHubPullRequest, GitHubPullRequestRef } from '@humanlayer/channels-github'
import { JiraIssueId, JiraIssueRef } from '@humanlayer/channels-jira'
import { Effect, Redacted, Schema } from 'effect'

import { AgentSessionMessage, targetOf } from '../src/AgentSessionMessage'

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

const jiraIssue = JiraIssueRef.make({ id: JiraIssueId.make('10001'), key: 'ACME-7', mailboxKey: 'jira:issue:10001' })

type Discussion = GitHubIssue | GitHubPullRequest | JiraIssueRef

const messageFor = (discussion: Discussion) =>
	AgentSessionMessage.make({
		prompt: 'why does CI fail?',
		discussion,
		deliveryId: DeliveryId.make('delivery:v1:abc:def'),
		accessToken: Redacted.make('secret-token'),
	})

describe('AgentSessionMessage', () => {
	const roundTrip = (discussion: Discussion) =>
		Effect.gen(function* () {
			const message = messageFor(discussion)
			const encoded = yield* Schema.encodeEffect(AgentSessionMessage)(message)
			const decoded = yield* Schema.decodeEffect(AgentSessionMessage)(encoded)
			expect(decoded.prompt).toBe(message.prompt)
			expect(decoded.discussion.mailboxKey).toBe(discussion.mailboxKey)
			expect(decoded.deliveryId).toBe(message.deliveryId)
			expect(Redacted.value(decoded.accessToken)).toBe('secret-token')
		})

	it.effect('survives encode then decode for an issue', () => roundTrip(issue))

	it.effect('survives encode then decode for a pull request', () => roundTrip(pullRequest))

	it.effect('survives encode then decode for a Jira issue', () => roundTrip(jiraIssue))

	it.effect('decodes each discussion shape to its own variant', () =>
		Effect.gen(function* () {
			const decode = (discussion: Discussion) =>
				Schema.encodeEffect(AgentSessionMessage)(messageFor(discussion)).pipe(
					Effect.flatMap(Schema.decodeEffect(AgentSessionMessage)),
				)
			expect(Object.keys((yield* decode(jiraIssue)).discussion).sort()).toEqual(['id', 'key', 'mailboxKey'])
			expect(Object.keys((yield* decode(issue)).discussion).sort()).toEqual(['_tag', 'mailboxKey', 'ref'])
		}),
	)

	it('targetOf returns the delivery id and the token for the delivery API', () => {
		const message = messageFor(issue)
		const target = targetOf(message)
		expect(target.deliveryId).toBe(message.deliveryId)
		expect(Redacted.value(target.accessToken)).toBe('secret-token')
	})

	it('does not print the token when the message is stringified', () => {
		expect(String(messageFor(issue).accessToken)).not.toContain('secret-token')
	})
})

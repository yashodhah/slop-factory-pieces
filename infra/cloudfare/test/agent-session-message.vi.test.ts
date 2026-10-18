import { describe, expect, it } from '@effect/vitest'
import { DeliveryId } from '@humanlayer/channels-delivery'
import { GitHubId, GitHubIssue, GitHubIssueRef, GitHubPullRequest, GitHubPullRequestRef } from '@humanlayer/channels-github'
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

const messageFor = (githubDiscussion: GitHubIssue | GitHubPullRequest) =>
	AgentSessionMessage.make({
		prompt: 'why does CI fail?',
		githubDiscussion,
		deliveryId: DeliveryId.make('delivery:v1:abc:def'),
		accessToken: Redacted.make('secret-token'),
	})

describe('AgentSessionMessage', () => {
	const roundTrip = (discussion: GitHubIssue | GitHubPullRequest) =>
		Effect.gen(function* () {
			const message = messageFor(discussion)
			const encoded = yield* Schema.encodeEffect(AgentSessionMessage)(message)
			const decoded = yield* Schema.decodeEffect(AgentSessionMessage)(encoded)
			expect(decoded.prompt).toBe(message.prompt)
			expect(decoded.githubDiscussion.mailboxKey).toBe(discussion.mailboxKey)
			expect(decoded.deliveryId).toBe(message.deliveryId)
			expect(Redacted.value(decoded.accessToken)).toBe('secret-token')
		})

	it.effect('survives encode then decode for an issue', () => roundTrip(issue))

	it.effect('survives encode then decode for a pull request', () => roundTrip(pullRequest))

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

/** The message the GitHub and Jira callbacks send an AgentSession, and what the agent reads from it. */
import { DeliveryId } from '@humanlayer/channels-delivery'
import { GitHubIssue, GitHubPullRequest } from '@humanlayer/channels-github'
import { JiraIssueRef } from '@humanlayer/channels-jira'
import { Schema } from 'effect'

/** A message for the AgentSession: the prompt, its GitHub or Jira discussion, and the handed-off delivery to finish. */
export const AgentSessionMessage = Schema.Struct({
	prompt: Schema.String,
	discussion: Schema.Union([GitHubIssue, GitHubPullRequest, JiraIssueRef]),
	deliveryId: DeliveryId,
	accessToken: Schema.RedactedFromValue(Schema.String),
})
export type AgentSessionMessage = typeof AgentSessionMessage.Type

/** The delivery API's target for the message's delivery: its ID and access token. */
export const targetOf = (message: AgentSessionMessage) => ({
	deliveryId: message.deliveryId,
	accessToken: message.accessToken,
})

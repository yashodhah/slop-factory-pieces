/**
 * What the shared behaviour suite (`./suite.ts`) needs from a deployment of the control layer. Each cloud writes
 * one driver: Cloudflare's runs the real bot over the SDK's in-memory store, AWS's will run it over its own.
 * Nothing here names a cloud or the SDK's wiring; only Effect and plain values.
 */
import type { Effect } from 'effect'

/**
 * The bot as every driver configures it, so the suite can write mentions and expect replies. A driver sets the
 * mention name and bot user id from these; the suite starts each mention body with `@${mentionName}`.
 */
export const conformanceBot = {
	mentionName: 'slop-agent',
	userId: 4242,
} as const

/** The mention that addresses the bot, for the start of a comment body. */
export const botMention = `@${conformanceBot.mentionName}`

/** One message an AgentSession received: the agent start for a handed-off delivery. */
export interface AgentStart {
	readonly deliveryId: string
	readonly mailboxKey: string
	readonly prompt: string
}

export interface ControlLayerDriver {
	/**
	 * POST a GitHub `issue_comment` webhook (`created`) for issue or pull request `number` of the one test
	 * repository. `eventId` is the webhook delivery id; the same id posted again is GitHub redelivering it.
	 * `signature: 'invalid'` signs the body with the wrong secret. Returns the HTTP status of the response.
	 */
	readonly postGitHubMention: (input: {
		eventId: string
		kind: 'issue' | 'pr'
		number: number
		author: string
		body: string
		signature: 'valid' | 'invalid'
	}) => Effect.Effect<{ status: number }>
	/** Let `ms` milliseconds pass for the deployment, running whatever falls due in them. */
	readonly advance: (ms: number) => Effect.Effect<void>
	/** Every agent start so far, oldest first. */
	readonly agentStarts: Effect.Effect<ReadonlyArray<AgentStart>>
	/**
	 * Do what the echo agent does when it finishes: complete the delivery with `echoReply(prompt)` through the
	 * delivery API. A delivery that already ended is not an error here.
	 */
	readonly completeDelivery: (deliveryId: string) => Effect.Effect<void>
	/**
	 * What the bot showed on GitHub so far, oldest first: each reaction it added (`eyes`, `-1`, ...) and the
	 * Markdown of each comment it posted.
	 */
	readonly output: Effect.Effect<{ reactions: ReadonlyArray<string>; comments: ReadonlyArray<string> }>
	/** Make the next `count` comment posts fail with a retryable GitHub error. */
	readonly failNextCommentPosts: (count: number) => Effect.Effect<void>
	/** The access `login` has to the repository. Authors not set have `write`. */
	readonly setAuthorAccess: (login: string, access: 'none' | 'read' | 'write') => Effect.Effect<void>
	/** Stop mailbox processing and start it again over the same saved mailboxes. */
	readonly restart: Effect.Effect<void>
}

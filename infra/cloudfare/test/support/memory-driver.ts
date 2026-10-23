/**
 * The shared behaviour suite's driver for Cloudflare's bot, run over the SDK's in-memory store instead of Durable
 * Objects. It is the one place that knows how the SDK is wired:
 *
 * - The real provider (`makeGitHubProvider`, so the real `githubHandlers` and `handOff`), the real namespace and
 *   event processing (`botSettings`), the SDK's webhook routes and delivery API, all in this test's fiber so the
 *   `TestClock` drives the debounce, polling, retries and the hand-off timeout.
 * - Faked: `GitHubApi` (records reactions and comments), `AgentSessions` (records agent starts) and the
 *   `DeliveryApi` client, which reaches the SDK's delivery API routes in process instead of over a service binding.
 * - The store is built once; `restart` closes mailbox processing and builds it again over that same store, the way
 *   a Durable Object restarts over its storage. Webhook routes and the delivery API keep running.
 */
import { createHmac } from 'node:crypto'

import * as NodeCrypto from '@effect/platform-node/NodeCrypto'
import {
	Channels,
	ChannelsMemory,
	DeliveryClosed,
	DeliveryControlLive,
	DeliveryTerminalConflict,
	deliveryApiRoutes,
	makeDeliveryClient,
} from '@humanlayer/channels-delivery'
import {
	type GitHubAccessLevel,
	GitHubApi,
	GitHubApiError,
	GitHubDiscussionRef,
	GitHubId,
	GitHubIssueComment,
	GitHubParticipant,
	type GitHubReactionRequest,
} from '@humanlayer/channels-github'
import { type AgentSessionMessage, AgentSessions, DeliveryApi, echoReply } from '@slop/core'
import { type AgentStart, type ControlLayerDriver, conformanceBot } from '@slop/core/conformance/driver'
import { ConfigProvider, Context, Effect, Exit, Layer, Redacted, Ref, Scope } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpEffect, HttpRouter, HttpServerRequest } from 'effect/http'
import { TestClock } from 'effect/testing'

import { botSettings, makeGitHubProvider } from '../../src/GithubBot'

const signingKey = 'control-layer-test-key'
const ORIGIN = 'http://control-layer.test'
/** How often the in-memory store looks for due mailboxes. */
const POLL_MS = 100
/** `advance` moves the clock in steps no longer than this, so work woken by one step can schedule the next. */
const ADVANCE_STEP_MS = POLL_MS

const repository = {
	installationId: GitHubId.make(100),
	repositoryId: GitHubId.make(200),
	owner: 'acme',
	repository: 'web',
}
const botAuthor = GitHubParticipant.make({
	id: GitHubId.make(conformanceBot.userId),
	login: `${conformanceBot.mentionName}[bot]`,
	type: 'Bot',
})

/** What the GitHub provider reads from the Worker's environment. */
const environment = ConfigProvider.layer(
	ConfigProvider.fromUnknown({
		GITHUB_WEBHOOK_SECRET: signingKey,
		GITHUB_BOT_MENTION_NAME: conformanceBot.mentionName,
		GITHUB_BOT_USER_ID: String(conformanceBot.userId),
	}),
)

/** Signed the way GitHub signs: `sha256=` + hex HMAC-SHA256 of the raw body. */
const sign = (key: string, body: string) => `sha256=${createHmac('sha256', key).update(body).digest('hex')}`

interface Recorded {
	readonly reactions: ReadonlyArray<GitHubReactionRequest>
	readonly comments: ReadonlyArray<GitHubIssueComment>
	readonly failCommentPosts: number
	readonly access: ReadonlyMap<string, GitHubAccessLevel>
	readonly starts: ReadonlyArray<AgentStart & { readonly accessToken: string }>
}

const discussionKey = (discussion: GitHubDiscussionRef) => `${discussion._tag}:${discussion.ref.number}`

export const makeMemoryDriver: Effect.Effect<ControlLayerDriver, never, Scope.Scope> = Effect.gen(function* () {
	const recorded = yield* Ref.make<Recorded>({
		reactions: [],
		comments: [],
		failCommentPosts: 0,
		access: new Map(),
		starts: [],
	})

	const post = (discussion: GitHubDiscussionRef, markdown: string) =>
		Ref.modify(recorded, (current): readonly [Effect.Effect<GitHubIssueComment, GitHubApiError>, Recorded] => {
			if (current.failCommentPosts > 0) {
				const error = new GitHubApiError({
					operation: discussion._tag === 'Issue' ? 'post_issue_comment' : 'post_pull_request_comment',
					reason: 'unavailable',
					retryable: true,
					status: 503,
				})
				return [Effect.fail(error), { ...current, failCommentPosts: current.failCommentPosts - 1 }]
			}
			const comment = GitHubIssueComment.make({
				ref: { discussion, id: GitHubId.make(900_000 + current.comments.length) },
				body: markdown,
				url: `https://github.com/acme/web/issues/${discussion.ref.number}#issuecomment-${current.comments.length}`,
				author: botAuthor,
			})
			return [Effect.succeed(comment), { ...current, comments: [...current.comments, comment] }]
		}).pipe(Effect.flatten)
	const commentsOn = (discussion: GitHubDiscussionRef) =>
		Ref.get(recorded).pipe(
			Effect.map((current) =>
				current.comments.filter((comment) => discussionKey(comment.ref.discussion) === discussionKey(discussion)),
			),
		)

	const gitHubApi = Layer.mock(GitHubApi, {
		fetchUserAccess: ({ login }) =>
			Ref.get(recorded).pipe(Effect.map((current) => current.access.get(login) ?? 'write')),
		addReaction: (input) =>
			Ref.update(recorded, (current) => ({ ...current, reactions: [...current.reactions, input] })),
		removeReaction: () => Effect.void,
		listIssueComments: ({ issue }) => commentsOn(GitHubDiscussionRef.cases.Issue.make({ ref: issue })),
		listPullRequestComments: ({ pullRequest }) =>
			commentsOn(GitHubDiscussionRef.cases.PullRequest.make({ ref: pullRequest })),
		postIssueComment: ({ issue, content }) =>
			post(GitHubDiscussionRef.cases.Issue.make({ ref: issue }), content.markdown),
		postPullRequestComment: ({ pullRequest, content }) =>
			post(GitHubDiscussionRef.cases.PullRequest.make({ ref: pullRequest }), content.markdown),
	})

	const agentSessions = Layer.succeed(
		AgentSessions,
		AgentSessions.of({
			getByName: (mailboxKey: string) => ({
				send: (message: typeof AgentSessionMessage.Encoded) =>
					Ref.update(recorded, (current) => ({
						...current,
						starts: [
							...current.starts,
							{
								deliveryId: message.deliveryId,
								mailboxKey,
								prompt: message.prompt,
								accessToken: message.accessToken,
							},
						],
					})),
			}),
		}),
	)

	const options = { ...botSettings, providers: [makeGitHubProvider(gitHubApi)] } as const
	const storage = ChannelsMemory.make({ polling: { intervalMs: POLL_MS } })
	const services = Layer.mergeAll(NodeCrypto.layer, agentSessions, environment)

	/** The mailboxes, built once for the driver's life: `restart` keeps them. */
	const store = Layer.succeedContext(yield* Layer.build(storage.layer))

	/** The Worker half: webhook routes and the delivery API, on one router. */
	const routerLayer = Layer.merge(
		Channels.routesLayer(options),
		deliveryApiRoutes({}).pipe(Layer.provide(DeliveryControlLive)),
	).pipe(
		Layer.provideMerge(
			HttpRouter.layer.pipe(Layer.provide(Layer.succeed(HttpRouter.RouterConfig, Channels.routerConfig))),
		),
		Layer.provide(store),
		Layer.provide(services),
	)
	/**
	 * `HttpRouter.Request<'Error', ...>` is a type-only marker of the errors a route may raise, never a service to
	 * provide; the SDK's own `start` builds the same layer without it. Serving turns those errors into responses.
	 */
	const routerContext = yield* Layer.build(
		routerLayer as Layer.Layer<Layer.Success<typeof routerLayer>, Layer.Error<typeof routerLayer>>,
	).pipe(Effect.orDie)
	const router = Context.get(routerContext, HttpRouter.HttpRouter)
	/** Requests run with this test's services, its `TestClock` among them. */
	const handle = HttpEffect.toWebHandlerWith<never, HttpServerRequest.HttpServerRequest | Scope.Scope>(
		yield* Effect.context<never>(),
	)(router.asHttpEffect())
	const send = (request: Request) => Effect.promise(() => handle(request))

	/** The Durable Object half: mailbox processing, which `restart` rebuilds over the same store. */
	const startProcessing = Effect.gen(function* () {
		const scope = yield* Scope.make()
		yield* Layer.buildWithScope(
			Channels.processingLayer(options, storage.polling).pipe(Layer.provide(store), Layer.provide(services)),
			scope,
		).pipe(Effect.orDie)
		return scope
	})
	const processing = yield* Ref.make(yield* startProcessing)
	yield* Effect.addFinalizer(() => Ref.get(processing).pipe(Effect.flatMap((scope) => Scope.close(scope, Exit.void))))

	/** The delivery API client an AgentSession uses, reaching the routes above in process. */
	const inProcess = HttpClient.make((request) =>
		HttpClientRequest.toWeb(request).pipe(
			Effect.flatMap(send),
			Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
			Effect.orDie,
		),
	)
	const deliveryClient = yield* makeDeliveryClient({ baseUrl: ORIGIN }).pipe(
		Effect.provideService(HttpClient.HttpClient, inProcess),
	)

	/** Stable ids per login and per webhook, so a redelivered webhook is byte for byte the same. */
	const ids = new Map<string, number>()
	const idFor = (key: string) => {
		const known = ids.get(key)
		if (known !== undefined) return known
		const next = 1_000 + ids.size
		ids.set(key, next)
		return next
	}

	const postGitHubMention: ControlLayerDriver['postGitHubMention'] = (input) =>
		Effect.gen(function* () {
			const author = { id: idFor(`user:${input.author}`), login: input.author, type: 'User' }
			const htmlUrl = `https://github.com/acme/web/${input.kind === 'pr' ? 'pull' : 'issues'}/${input.number}`
			const body = JSON.stringify({
				action: 'created',
				installation: { id: repository.installationId },
				repository: { id: repository.repositoryId, name: repository.repository, owner: { login: repository.owner } },
				issue: {
					id: 500_000 + input.number,
					number: input.number,
					title: `Discussion ${input.number}`,
					body: null,
					state: 'open',
					html_url: htmlUrl,
					user: author,
					...(input.kind === 'pr' ? { pull_request: { url: `https://api.github.com/repos/acme/web/pulls/${input.number}` } } : {}),
				},
				comment: {
					id: idFor(`comment:${input.eventId}`),
					body: input.body,
					html_url: `${htmlUrl}#issuecomment-${idFor(`comment:${input.eventId}`)}`,
					user: author,
				},
				sender: author,
			})
			const response = yield* send(
				new Request(`${ORIGIN}/integrations/github/webhook`, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'x-github-delivery': input.eventId,
						'x-github-event': 'issue_comment',
						'x-hub-signature-256': sign(input.signature === 'valid' ? signingKey : 'wrong-key', body),
					},
					body,
				}),
			)
			return { status: response.status }
		})

	const advance = (ms: number) =>
		Effect.gen(function* () {
			for (let left = ms; left > 0; left -= ADVANCE_STEP_MS) {
				yield* TestClock.adjust(Math.min(left, ADVANCE_STEP_MS))
			}
			yield* Effect.yieldNow
		})

	/** What the echo agent's last call does, written against the core `DeliveryApi` port. */
	const completeDelivery = (deliveryId: string) =>
		Effect.gen(function* () {
			const start = (yield* Ref.get(recorded)).starts.find((candidate) => candidate.deliveryId === deliveryId)
			if (start === undefined) return yield* Effect.die(new Error(`No agent start for delivery ${deliveryId}`))
			const api = yield* DeliveryApi
			yield* api
				.complete({
					deliveryId,
					accessToken: Redacted.make(start.accessToken),
					payload: { markdown: echoReply(start.prompt) },
				})
				.pipe(
					Effect.catchIf(
						(error) => error instanceof DeliveryClosed || error instanceof DeliveryTerminalConflict,
						(error) => Effect.logInfo('control-layer driver: the delivery already ended', error),
					),
					Effect.orDie,
				)
		}).pipe(Effect.provideService(DeliveryApi, deliveryClient))

	return {
		postGitHubMention,
		advance,
		agentStarts: Ref.get(recorded).pipe(
			Effect.map((current) =>
				current.starts.map(({ deliveryId, mailboxKey, prompt }) => ({ deliveryId, mailboxKey, prompt })),
			),
		),
		completeDelivery,
		output: Ref.get(recorded).pipe(
			Effect.map((current) => ({
				reactions: current.reactions.map((request) => request.reaction),
				comments: current.comments.map((comment) => comment.body),
			})),
		),
		failNextCommentPosts: (count) => Ref.update(recorded, (current) => ({ ...current, failCommentPosts: count })),
		setAuthorAccess: (login, access) =>
			Ref.update(recorded, (current) => ({ ...current, access: new Map(current.access).set(login, access) })),
		restart: Effect.gen(function* () {
			yield* Scope.close(yield* Ref.get(processing), Exit.void)
			yield* Ref.set(processing, yield* startProcessing)
		}),
	} satisfies ControlLayerDriver
})

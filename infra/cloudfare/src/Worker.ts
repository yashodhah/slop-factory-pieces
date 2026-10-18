import * as NodeCrypto from '@effect/platform-node/NodeCrypto'
import { ChannelsCloudflare, DeliveryMailboxes } from '@humanlayer/channels-alchemy-cloudflare'
import { GitHubApiLive } from '@humanlayer/channels-github'
import * as Cloudflare from 'alchemy/Cloudflare'
import { Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'

import { AgentSessionDOLive, AgentSessions } from './AgentSessionDO'
import { DELIVERY_API_BINDING, DeliveryApi } from './DeliveryApi'
import { DeliveryMailbox, DeliveryMailboxDOLive } from './DeliveryMailboxDO'
import { bot } from './GithubBot'

/** Give Channels access to this application's Durable Object mailbox namespace. */
const ChannelsDeliveryMailboxesLive = Layer.effect(DeliveryMailboxes, DeliveryMailbox)

/** Provider webhooks and the delivery API. */
const RoutesLive = Layer.merge(bot.routes, bot.deliveryApi)

/** Everything the Worker and its Durable Objects need. */
const WorkerLive = ChannelsDeliveryMailboxesLive.pipe(
	Layer.provideMerge(DeliveryMailboxDOLive),
	Layer.provideMerge(AgentSessions.layer),
	Layer.provideMerge(AgentSessionDOLive),
	Layer.provideMerge(DeliveryApi.layerSelfBinding),
	Layer.provideMerge(GitHubApiLive),
	Layer.provideMerge(FetchHttpClient.layer),
	Layer.provideMerge(NodeCrypto.layer),
)

/**
 * The Worker and the Durable Objects it hosts run at one pinned compatibility date, so an Alchemy
 * upgrade cannot change their behavior. 2026-10-01 turns on `durable_object_io_tasks_prevent_eviction`:
 * pending I/O, such as an RPC to another Durable Object or a timer, keeps an object alive for up to 15
 * minutes. Listing that flag as well is an error, because the date already includes it.
 */
export default Cloudflare.Worker(
	'IngressWorker',
	{
		main: import.meta.url,
		compatibility: { date: '2026-10-01' },
		name: 'slop-code-factory',
		/** AgentSession reaches this Worker's delivery API through this binding. */
		env: { [DELIVERY_API_BINDING]: Cloudflare.Workers.Self },
	},
	Effect.gen(function* () {
		const fetch = yield* ChannelsCloudflare.serve(RoutesLive)
		return { fetch }
	}).pipe(Effect.provide(WorkerLive)),
)

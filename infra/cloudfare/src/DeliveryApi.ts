/**
 * How AgentSession reports on the deliveries handed to it: through the delivery API that `bot.deliveryApi`
 * serves on the Ingress Worker, with the client generated from the same `HttpApi`, as any remote worker does.
 */
import { makeDeliveryClient } from '@humanlayer/channels-delivery'
import { DeliveryApi } from '@slop/core'
import * as Cloudflare from 'alchemy/Cloudflare'
import { Effect, Layer } from 'effect'
import { HttpClient } from 'effect/http'

/** The Ingress Worker's service binding to itself, declared on its `env`. */
export const DELIVERY_API_BINDING = 'DELIVERY_API'

/** Requests through a service binding never reach this host; the binding decides where they go. */
const BINDING_BASE_URL = 'http://localhost'

/**
 * An `HttpClient` that sends each request to the Ingress Worker through its self service binding, never over
 * the public internet. The binding exists only on the deployed Worker, so it is read when a request is made.
 */
const selfBindingHttpClient = Layer.effect(
	HttpClient.HttpClient,
	Effect.gen(function* () {
		const env = yield* Cloudflare.Workers.WorkerEnvironment
		return HttpClient.make((request) =>
			Effect.suspend(() =>
				Cloudflare.toHttpClient(Cloudflare.fromCloudflareFetcher(env[DELIVERY_API_BINDING])).execute(request),
			),
		)
	}),
)

/** Fills the core `DeliveryApi` port with the client over the Ingress Worker's self service binding. */
export const DeliveryApiCloudflare = Layer.effect(DeliveryApi, makeDeliveryClient({ baseUrl: BINDING_BASE_URL })).pipe(
	Layer.provide(selfBindingHttpClient),
)

/**
 * The Jira seam, end to end without the Worker runtime: a signed webhook goes through the provider that
 * `jira` (src/JiraBot.ts) builds from configuration, and the admission it produces goes through the SDK's
 * event processor with the broker's real `jiraHandlers`. Only `JiraApi`, `AgentSessions` and the delivery
 * context are faked.
 */
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as NodeCrypto from '@effect/platform-node/NodeCrypto'
import { describe, it } from '@effect/vitest'
import {
	type DeliveryAdmission,
	deliveryMailboxKey,
	ProviderDeliveryExecution,
	ProviderEventHandled,
	type ProviderWebhookOutcome,
} from '@humanlayer/channels-delivery'
import { JiraAccountId, JiraApi, makeJiraEventProcessor } from '@humanlayer/channels-jira'
import { Config, ConfigProvider, Effect, Layer, Option, Ref } from 'effect'
import { Headers } from 'effect/http'

import { type AgentSessionMessage, AgentSessions } from '@slop/core'
import { jira, jiraHandlers } from '../src/JiraBot'
import { makeFakeDeliveryContext } from './support/delivery-context'

const namespace = 'slop-code-factory'
const seamWebhookKey = 'jira-seam-test-key'
const botAccountId = '5b10ac8d82e05b22cc7d4ef5'
const fakeApiCredential = 'not-a-real-value'
const fakeCloudId = '11111111-2222-4333-8444-555555555555'

/** The five values the Jira provider reads, as the Worker's environment would hold them. */
const jiraEnvironment: Readonly<Record<string, string>> = {
	JIRA_WEBHOOK_SECRET: seamWebhookKey,
	JIRA_BASE_URL: 'https://Example.Atlassian.NET/',
	JIRA_CLOUD_ID: fakeCloudId,
	JIRA_API_TOKEN: fakeApiCredential,
	JIRA_BOT_ACCOUNT_ID: botAccountId,
}

const withEnvironment = (environment: Readonly<Record<string, string>>) =>
	ConfigProvider.layer(ConfigProvider.fromUnknown(environment))

/** Signed the way Jira signs (and the SDK's test helper signs): `sha256=` + hex HMAC-SHA256 of the raw body. */
const signedFixture = () => {
	const body = new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', 'jira-comment-created-mention.json')))
	return {
		headers: Headers.fromInput({
			'x-hub-signature': `sha256=${createHmac('sha256', seamWebhookKey).update(body).digest('hex')}`,
		}),
		body,
	}
}

const buildWebhookProvider = (environment: Readonly<Record<string, string>>) =>
	jira.webhookProvider({ namespace }).pipe(Effect.scoped, Effect.provide(withEnvironment(environment)))

const admitted = (outcome: ProviderWebhookOutcome): DeliveryAdmission => {
	if (outcome._tag !== 'Event') throw new Error(`Expected the webhook to be admitted, got ${outcome._tag}`)
	return outcome.event
}

describe('Jira seam: signed webhook -> provider -> event processor -> jiraHandlers', () => {
	it.effect('sends the AgentSession a message for the admission mailbox, then hands off for 10 minutes', ({ expect }) =>
		Effect.gen(function* () {
			const provider = yield* buildWebhookProvider(jiraEnvironment)
			const admission = admitted(yield* provider.handle(signedFixture()).pipe(Effect.provide(NodeCrypto.layer)))
			const mailboxKey = deliveryMailboxKey(admission)
			expect(admission.installationId).toBe('example.atlassian.net')
			expect(admission.eventId).toBe('comment_created:10100')

			const sent = yield* Ref.make<ReadonlyArray<{ readonly name: string; readonly message: typeof AgentSessionMessage.Encoded }>>([])
			const fetched = yield* Ref.make<ReadonlyArray<string>>([])
			const posted = yield* Ref.make<ReadonlyArray<{ readonly issueKey: string; readonly markdown: string }>>([])
			const delivery = yield* makeFakeDeliveryContext(mailboxKey)
			const execution = new ProviderDeliveryExecution({
				deliveryId: delivery.context.deliveryId,
				idempotencyKey: 'jira-seam-test',
				prepared: Option.none(),
				prepare: (invocation) => Effect.succeed(invocation),
				context: delivery.context,
			})
			const processor = makeJiraEventProcessor({
				namespace,
				bot: { accountId: JiraAccountId.make(botAccountId) },
				handlers: jiraHandlers,
			})
			const fakes = Layer.mergeAll(
				Layer.mock(JiraApi, {
					fetchIssue: (key) =>
						Ref.update(fetched, (keys) => [...keys, key]).pipe(
							Effect.as({ key, title: 'Add rate limiting', description: null }),
						),
					postComment: (input) =>
						Ref.update(posted, (all) => [...all, input]).pipe(Effect.as({ commentId: '20001' })),
				}),
				Layer.succeed(
					AgentSessions,
					AgentSessions.of({
						getByName: (name: string) => ({
							send: (message: typeof AgentSessionMessage.Encoded) =>
								Ref.update(sent, (all) => [...all, { name, message }]),
						}),
					}),
				),			)

			const result = yield* processor.process([admission], execution).pipe(Effect.provide(fakes))

			expect(result).toEqual(ProviderEventHandled.make({}))
			expect(yield* Ref.get(fetched)).toEqual(['ABC-7'])
			expect(yield* Ref.get(posted)).toEqual([{ issueKey: 'ABC-7', markdown: '👀 On it' }])
			const messages = yield* Ref.get(sent)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.name).toBe(mailboxKey)
			expect(messages[0]?.message.discussion).toEqual({ id: '10042', key: 'ABC-7', mailboxKey })
			expect(messages[0]?.message.prompt).toBe('Add rate limiting\nhow should we do this?')
			expect(yield* delivery.handoffOptions).toEqual([{ failAfter: '10 minutes' }])
		}),
	)
})

describe('Jira provider configuration', () => {
	it.effect('builds both halves from the five JIRA_* values', ({ expect }) =>
		Effect.gen(function* () {
			const provider = yield* buildWebhookProvider(jiraEnvironment)
			expect(provider.providerName).toBe('jira')
			const processor = yield* jira
				.eventProcessor({ namespace })
				.pipe(Effect.scoped, Effect.provide(withEnvironment(jiraEnvironment)))
			expect(processor.providerName).toBe('jira')
		}),
	)

	for (const missing of Object.keys(jiraEnvironment)) {
		it.effect(`fails with a ConfigError naming ${missing} when it is absent`, ({ expect }) =>
			Effect.gen(function* () {
				const { [missing]: _absent, ...rest } = jiraEnvironment
				const error = yield* buildWebhookProvider(rest).pipe(Effect.flip)
				expect(error).toBeInstanceOf(Config.ConfigError)
				expect(String(error)).toContain(missing)
			}),
		)
	}

	it.effect('requires exactly these five variables, and no JIRA_BOT_EMAIL', ({ expect }) =>
		Effect.gen(function* () {
			expect(Object.keys(jiraEnvironment).sort()).toEqual([
				'JIRA_API_TOKEN',
				'JIRA_BASE_URL',
				'JIRA_BOT_ACCOUNT_ID',
				'JIRA_CLOUD_ID',
				'JIRA_WEBHOOK_SECRET',
			])
			expect(jiraEnvironment).not.toHaveProperty('JIRA_BOT_EMAIL')
			const provider = yield* buildWebhookProvider(jiraEnvironment)
			expect(provider.providerName).toBe('jira')
		}),
	)

	it.effect('fails with a ConfigError naming JIRA_CLOUD_ID when it is not a UUID', ({ expect }) =>
		Effect.gen(function* () {
			const error = yield* buildWebhookProvider({ ...jiraEnvironment, JIRA_CLOUD_ID: 'your-site.atlassian.net' }).pipe(
				Effect.flip,
			)
			expect(error).toBeInstanceOf(Config.ConfigError)
			expect(String(error)).toContain('JIRA_CLOUD_ID')
		}),
	)

	it.effect('uses the lowercase host of JIRA_BASE_URL as the site', ({ expect }) =>
		Effect.gen(function* () {
			const provider = yield* buildWebhookProvider(jiraEnvironment)
			const admission = admitted(yield* provider.handle(signedFixture()).pipe(Effect.provide(NodeCrypto.layer)))
			expect(admission.installationId).toBe('example.atlassian.net')
		}),
	)
})

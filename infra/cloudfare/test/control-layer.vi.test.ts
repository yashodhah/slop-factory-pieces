/**
 * The shared control-layer behaviours (`@slop/core/conformance/suite`) on Cloudflare's bot configuration, run over
 * the SDK's in-memory store by `makeMemoryDriver`.
 */
import { describe, expect, it } from '@effect/vitest'
import { deliveryMailboxKey } from '@humanlayer/channels-delivery'
import { GitHubId, githubDiscussionResourceId } from '@humanlayer/channels-github'
import { botMention } from '@slop/core/conformance/driver'
import { B12_PULL_REQUEST, defineControlLayerSuite } from '@slop/core/conformance/suite'
import { Effect } from 'effect'

import { botSettings } from '../src/GithubBot'
import { makeMemoryDriver } from './support/memory-driver'

defineControlLayerSuite('cloudflare', makeMemoryDriver)

describe('control layer on cloudflare: mailbox keys', () => {
	it.effect("B12's pull request gets the mailbox key the SDK computes for that pull request", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const driver = yield* makeMemoryDriver
				const { status } = yield* driver.postGitHubMention({
					eventId: 'b12-key',
					kind: 'pr',
					number: B12_PULL_REQUEST,
					author: 'maintainer-1',
					body: `${botMention} review this pull request`,
					signature: 'valid',
				})
				expect(status).toBe(200)
				yield* driver.advance(5_000)
				const starts = yield* driver.agentStarts
				expect(starts).toHaveLength(1)
				/** The memory driver's repository: installation 100, repository 200. */
				expect(starts[0]?.mailboxKey).toBe(
					deliveryMailboxKey({
						namespace: botSettings.namespace,
						provider: 'github',
						installationId: '100',
						resourceId: githubDiscussionResourceId({
							repositoryId: GitHubId.make(200),
							kind: 'pull-request',
							number: GitHubId.make(B12_PULL_REQUEST),
						}),
					}),
				)
			}),
		),
	)
})

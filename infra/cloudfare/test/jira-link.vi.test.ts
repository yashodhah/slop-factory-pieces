import { describe, expect, it } from 'vitest'
import { JiraApiLive, JiraBot } from '@humanlayer/channels-jira'

describe('Jira channel package link', () => {
	it('resolves JiraBot.make and JiraApiLive', () => {
		expect(typeof JiraBot.make).toBe('function')
		expect(JiraApiLive).toBeDefined()
	})
})

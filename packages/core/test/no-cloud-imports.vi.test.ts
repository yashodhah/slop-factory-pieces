import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from '@effect/vitest'

const srcDir = join(import.meta.dirname, '..', 'src')

const forbiddenPrefixes = [
	'alchemy',
	'cloudflare:',
	'@cloudflare/',
	'@aws-sdk/',
	'@aws/',
	'aws-lambda',
	'@humanlayer/channels-alchemy-cloudflare',
]

/** Module specifiers named by `import ... from '...'`, `export ... from '...'`, `import('...')` and bare `import '...'`. */
const importPaths = (source: string): string[] =>
	[...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '')

const sourceFiles = readdirSync(srcDir, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.ts'))

describe('packages/core stays cloud neutral', () => {
	it('has source files to check', () => {
		expect(sourceFiles.length).toBeGreaterThan(0)
	})

	it.each(sourceFiles)('%s imports no cloud-specific package', (file) => {
		const offending = importPaths(readFileSync(join(srcDir, file), 'utf8')).filter((path) =>
			forbiddenPrefixes.some((prefix) => path.startsWith(prefix)),
		)
		expect(offending).toEqual([])
	})
})

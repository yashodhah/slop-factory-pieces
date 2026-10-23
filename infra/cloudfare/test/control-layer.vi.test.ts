/**
 * The shared control-layer behaviours (`@slop/core/conformance/suite`) on Cloudflare's bot configuration, run over
 * the SDK's in-memory store by `makeMemoryDriver`.
 */
import { defineControlLayerSuite } from '@slop/core/conformance/suite'

import { makeMemoryDriver } from './support/memory-driver'

defineControlLayerSuite('cloudflare', makeMemoryDriver)

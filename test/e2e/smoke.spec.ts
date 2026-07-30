// SPDX-License-Identifier: Apache-2.0

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const pages = [
  { path: '/', title: /TiCity/ },
  { path: '/machine/', title: /Machine · TiCity/ },
  { path: '/diagnose/', title: /Diagnose · TiCity/ },
] as const

const TIFLASH_MPP_SCENARIO = 'tiflash-mpp'
const TIFLASH_MPP_TRANSITION_EVENT = 'trace-1-event-37'
const TIFLASH_MPP_FINAL_EVENT = 'trace-1-event-56'

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze()
  const violations = result.violations.filter(({ impact }) =>
    impact === 'serious' || impact === 'critical',
  )
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
}

interface CameraSnapshot {
  readonly position: readonly [number, number, number]
  readonly direction: readonly [number, number, number]
  readonly quaternion: readonly [number, number, number, number]
}

async function cameraSnapshot(page: Page): Promise<CameraSnapshot> {
  return page.evaluate(() => {
    const { camera } = window.TICITY.world!.shell
    camera.updateMatrixWorld(true)
    const matrix = camera.matrixWorld.elements
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      direction: [-matrix[8], -matrix[9], -matrix[10]],
      quaternion: [
        camera.quaternion.x,
        camera.quaternion.y,
        camera.quaternion.z,
        camera.quaternion.w,
      ],
    }
  })
}

function distance3(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
}

async function expectRaftVoteCity(page: Page): Promise<void> {
  const eventId = 'trace-1-event-16'
  await page.goto(`/?lang=en&scenario=tikv-failover&event=${eventId}`)
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  })

  const layout = page.locator('.tidb-layout')
  const raftLab = page.locator('[data-raft-lab]')
  const election = raftLab.locator('[data-election-phase]')
  const request = raftLab.locator('.tidb-raft-lab__request')
  const dock = page.locator('[data-trace-dock]')
  await expect(layout).toHaveAttribute('data-active-lab', 'raft')
  await expect(layout).toHaveAttribute('data-inspect', 'open')
  await expect(raftLab).toBeVisible()
  await expect(raftLab).toHaveAttribute('tabindex', '0')
  await raftLab.focus()
  await expect(raftLab).toBeFocused()
  await expect(raftLab.locator('[data-raft-phase]')).toHaveAttribute(
    'data-raft-phase',
    'vote',
  )
  await expect(election).toHaveAttribute('data-election-candidate', 'tikv-2')
  await expect(election).toHaveAttribute('data-election-quorum', '2')
  await expect(election).toContainText('Votes granted')
  await expect(election).toContainText('2/2')
  await expect(election).toContainText(
    'Lowest live, up-to-date Store ID (TiCity MODEL POLICY)',
  )
  await expect(raftLab.locator('[data-raft-peer]')).toHaveCount(3)
  await expect(raftLab.locator('[data-raft-peer="tikv-1"]'))
    .toHaveAttribute('data-peer-health', 'down')
  await expect(raftLab.locator('[data-raft-peer="tikv-2"]'))
    .toHaveAttribute('data-peer-role', 'candidate')
  await expect(request).toHaveAttribute('data-retry-source', 'tidb_internal')
  await expect(request).toHaveAttribute('data-client-visible-error', 'false')
  await expect(request).toContainText('TiDB internal')
  await expect(request).toContainText('not an application retry')

  await expect(page.locator('[data-transaction-lab]')).toBeHidden()
  await expect(page.locator('[data-lock-lab]')).toBeHidden()
  await expect(dock).toHaveAttribute('data-phase', 'paused')
  await expect(dock).toHaveAttribute('data-event-index', '15')
  await expect(dock).toHaveAttribute('data-event-count', '27')
  await expect(dock).toHaveAttribute('data-looping', 'true')
  await expect(page.locator('[data-action="trace-loop"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const [labBox, dockBox] = await Promise.all([
    raftLab.boundingBox(),
    dock.boundingBox(),
  ])
  expect(labBox).not.toBeNull()
  expect(dockBox).not.toBeNull()
  if (!labBox || !dockBox) throw new Error('Raft Lab overlays have no layout box')
  expect(labBox.y + labBox.height).toBeLessThanOrEqual(dockBox.y + 1)
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
}

async function expectTraceLink(
  page: Page,
  selector: string,
  scenario: string,
  eventId: string,
  locale: 'en' | 'ja',
): Promise<void> {
  const href = await page.locator(selector).getAttribute('href')
  if (!href) throw new Error(`Trace link ${selector} has no href`)
  const url = new URL(href, page.url())
  expect(url.searchParams.get('scenario')).toBe(scenario)
  expect(url.searchParams.get('event')).toBe(eventId)
  expect(url.searchParams.get('lang')).toBe(locale)
}

for (const surface of pages) {
  test(`${surface.path} boots offline and passes the accessibility gate`, async ({ page }) => {
    const thirdPartyRequests: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (
        url.protocol !== 'data:' &&
        url.protocol !== 'blob:' &&
        url.hostname !== '127.0.0.1'
      ) {
        thirdPartyRequests.push(request.url())
      }
    })

    await page.goto(surface.path)
    await expect(page).toHaveTitle(surface.title)
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('.tidb-wordmark strong')).toHaveText('TiCity')
    await expectNoSeriousAccessibilityViolations(page)
    expect(thirdPartyRequests).toEqual([])
  })
}

test('city exposes the documented model API and defaults to Japanese', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')

  const publicApi = await page.evaluate(() => {
    const api = (
      window as typeof window & {
        TICITY?: Record<string, unknown>
      }
    ).TICITY
    const retiredGlobalName = ['TIDB', 'CITY'].join('')
    return {
      keys: api ? Object.keys(api).sort() : [],
      retiredGlobalPresent: Object.prototype.hasOwnProperty.call(window, retiredGlobalName),
    }
  })

  expect(publicApi.keys).toEqual(
    expect.arrayContaining(['model', 'runScenario', 'submitSql', 'trace']),
  )
  expect(publicApi.retiredGlobalPresent).toBe(false)

  const snapshot = await page.evaluate(() => {
    const state = window.TICITY.model.state
    const before = state.controls.qps
    try {
      state.controls.qps = 9_999
    } catch {
      // Frozen snapshots throw in module strict mode; either way the model
      // itself must remain unchanged.
    }
    return {
      frozen: Object.isFrozen(state) && Object.isFrozen(state.controls),
      before,
      after: window.TICITY.model.state.controls.qps,
    }
  })
  expect(snapshot.frozen).toBe(true)
  expect(snapshot.after).toBe(snapshot.before)
})

test('the language query parameter selects English', async ({ page }) => {
  await page.goto('/?lang=en')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('Machine and Diagnose share the same detailed event cursor through the URL', async ({
  page,
}) => {
  const eventId = 'trace-1-event-7'
  await page.goto(
    `/machine/?lang=en&scenario=cross-region-transaction&event=${eventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('[data-event-index][aria-current="step"]'))
    .toHaveAttribute('data-event-domain', 'txn2pc')
  await expect(page.locator('.tidb-machine__detail')).toContainText('pessimistic lock')
  expect(new URL(page.url()).searchParams.get('event')).toBe(eventId)

  await page.goto(
    `/diagnose/?lang=en&scenario=cross-region-transaction&event=${eventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('select[aria-label="State at event"]')).toHaveValue(eventId)
  const regionTable = page.locator('[data-table-section="regions"]')
  await expect(regionTable).toContainText('cfLock')
  await expect(regionTable).toContainText('empty')
  await expect(regionTable).toContainText('leader_memory')
})

test('Lock Lab exact cursor stays exclusive, readable, and operable on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const eventId = 'trace-1-event-9'
  await page.goto(
    `/?lang=en&scenario=lock-deadlock&event=${eventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const layout = page.locator('.tidb-layout')
  const lockLab = page.locator('[data-lock-lab]')
  const transactionLab = page.locator('[data-transaction-lab]')
  const dock = page.locator('[data-trace-dock]')
  await expect(layout).toHaveAttribute('data-active-lab', 'lock')
  await expect(layout).toHaveAttribute('data-inspect', 'open')
  await expect(lockLab).toBeVisible()
  await expect(lockLab).toHaveAttribute('tabindex', '0')
  await expect(lockLab).toContainText('Not returned yet')
  await expect(transactionLab).toBeHidden()
  await expect(dock).toHaveAttribute('data-phase', 'paused')
  await expect(dock).toHaveAttribute('data-event-index', '8')
  await expect(dock).toHaveAttribute('data-event-count', '25')
  await expect(page.locator('[data-action="trace-loop"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const [labBox, dockBox] = await Promise.all([
    lockLab.boundingBox(),
    dock.boundingBox(),
  ])
  expect(labBox).not.toBeNull()
  expect(dockBox).not.toBeNull()
  if (!labBox || !dockBox) throw new Error('Lock Lab overlays have no layout box')
  expect(labBox.y + labBox.height).toBeLessThanOrEqual(dockBox.y + 1)

  const machineHref = await page.locator(
    '.tidb-topbar [data-nav="machine"]',
  ).getAttribute('href')
  expect(machineHref).toContain('scenario=lock-deadlock')
  expect(machineHref).toContain(`event=${eventId}`)
  expect(machineHref).toContain('lang=en')
  await expectNoSeriousAccessibilityViolations(page)
})

test('Lock Lab Machine and Diagnose preserve graph and Error 1213 event time', async ({
  page,
}) => {
  const detectedEventId = 'trace-1-event-9'
  await page.goto(
    `/machine/?lang=en&scenario=lock-deadlock&event=${detectedEventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('[data-graph-kind="causal-dag"]')).toBeVisible()
  const waitGraph = page.locator('[data-wait-for-graph="semantic"]')
  await expect(waitGraph).toBeVisible()
  await expect(waitGraph).toHaveAttribute('tabindex', '0')
  await expect(waitGraph.locator('path[data-wait-for-edge]')).toHaveCount(2)
  await expect(page.locator('.skip-link')).toHaveText('Skip to main content')

  await page.goto(
    `/diagnose/?lang=en&scenario=lock-deadlock&event=${detectedEventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('select[aria-label="State at event"]'))
    .toHaveValue(detectedEventId)
  const deadlocks = page.locator('[data-diagnose-section="deadlocks"]')
  await expect(deadlocks).toContainText('Not returned yet')
  await expect(deadlocks).not.toContainText('Error 1213')
  await expect(page.locator('.tidb-diagnose__summary'))
    .toHaveAttribute('data-tone', 'critical')
  await expect(page.locator('[data-summary-metric="transactions"]'))
    .toContainText('2 active · 2 lock waits')

  const errorEventId = 'trace-1-event-13'
  await page.goto(
    `/diagnose/?lang=en&scenario=lock-deadlock&event=${errorEventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('select[aria-label="State at event"]'))
    .toHaveValue(errorEventId)
  await expect(page.locator('[data-diagnose-section="deadlocks"]'))
    .toContainText('Error 1213')

  await page.goto('/diagnose/?lang=en&scenario=lock-deadlock')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('[data-summary-metric="transactions"]'))
    .toContainText('0 active · 0 lock waits')
  await expect(page.locator('.tidb-diagnose__summary'))
    .not.toHaveAttribute('data-tone', 'critical')
  await expectNoSeriousAccessibilityViolations(page)
})

test('Raft Failure Lab exact vote cursor stays exclusive and clear on desktop and mobile', async ({
  page,
}) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1_440, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    await expectRaftVoteCity(page)
  }
  await expectNoSeriousAccessibilityViolations(page)
})

test('Raft Failure Lab Machine separates the causal DAG from the election graph', async ({
  page,
}) => {
  const eventId = 'trace-1-event-16'
  await page.goto(
    `/machine/?lang=en&scenario=tikv-failover&event=${eventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  expect(new URL(page.url()).searchParams.get('event')).toBe(eventId)

  const current = page.locator('[data-event-index][aria-current="step"]')
  await expect(current).toHaveAttribute('data-event-index', '15')
  await expect(current).toHaveAttribute('data-event-domain', 'raft')
  await expect(current).toHaveAttribute('data-event-kind', 'raft_vote_granted')
  await expect(current).toHaveAttribute('data-event-has-raft-snapshot', 'true')

  const causal = page.locator('[data-graph-kind="causal-dag"]')
  const election = page.locator('[data-raft-election-graph="semantic"]')
  await expect(causal).toBeVisible()
  await expect(election).toBeVisible()
  await expect(election).toHaveAttribute('tabindex', '0')
  await expect(election).toHaveAttribute('data-graph-kind', 'raft-election')
  await expect(election).toHaveAttribute('data-election-candidate', 'tikv-2')
  await expect(election).toHaveAttribute('data-election-quorum', '2')
  await expect(causal.locator('[data-raft-election-graph]')).toHaveCount(0)
  await expect(election.locator('[data-raft-peer-node]')).toHaveCount(3)
  await expect(election.locator('path[data-raft-grant="pre_vote"]')).toHaveCount(2)
  await expect(election.locator('path[data-raft-grant="vote"]')).toHaveCount(2)
  await expect(election).toContainText(
    'This election semantic graph is separate from the causal DAG above.',
  )

  const raftState = page.locator('[data-raft-lab-state="true"]')
  await expect(raftState).toHaveAttribute('data-raft-event-id', eventId)
  await expect(raftState).toHaveAttribute('data-raft-phase', 'vote')
  await expect(raftState.locator('[data-raft-peer]')).toHaveCount(3)
  await expect(raftState.locator('[data-raft-policy="model-policy"]'))
    .toHaveAttribute(
      'data-candidate-policy',
      'lowest_live_up_to_date_store_id_model_policy',
    )
  await expect(raftState.locator('[data-pd-role="observer_and_routing_only"]'))
    .toHaveAttribute('data-pd-votes', 'false')
  const retry = raftState.locator('[data-same-logical-request="true"]')
  await expect(retry).toHaveAttribute('data-retry-source', 'tidb_internal')
  await expect(retry).toHaveAttribute('data-application-retry', 'false')
  await expect(retry).toHaveAttribute('data-client-visible-error', 'false')
  await expectNoSeriousAccessibilityViolations(page)
})

test('Raft Failure Lab Diagnose preserves election and final retry snapshots', async ({
  page,
}) => {
  const voteEventId = 'trace-1-event-16'
  await page.goto(
    `/diagnose/?lang=en&scenario=tikv-failover&event=${voteEventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('select[aria-label="State at event"]'))
    .toHaveValue(voteEventId)

  const peersAtVote = page.locator('[data-table-section="raft-peers"]')
  const electionAtVote = page.locator('[data-table-section="raft-election"]')
  const retryAtVote = page.locator(
    '[data-table-section="region-request-retry"]',
  )
  await expect(peersAtVote.locator('tbody tr')).toHaveCount(3)
  await expect(peersAtVote).toContainText('tikv-1')
  await expect(peersAtVote).toContainText('down')
  await expect(electionAtVote).toContainText('vote')
  await expect(electionAtVote).toContainText('tikv-2')
  await expect(electionAtVote).toContainText('2/2')
  await expect(electionAtVote).toContainText(
    'MODEL POLICY: lowest live, up-to-date Store ID',
  )
  await expect(electionAtVote).toContainText('Observe and route metadata only')
  await expect(page.locator('[data-diagnose-section="raft-election"]'))
    .toHaveAttribute('data-tone', 'attention')
  await expect(retryAtVote).toContainText('TiDB internal')
  await expect(retryAtVote).toContainText('backoff')
  await expect(retryAtVote).toContainText('same logical Region request')
  await expect(retryAtVote).toContainText('false')
  await expect(page.locator('[data-diagnose-section="region-request-retry"]'))
    .toHaveAttribute('data-tone', 'attention')
  await expect(page.locator('.tidb-diagnose__summary'))
    .toHaveAttribute('data-tone', 'critical')

  const finalEventId = 'trace-1-event-27'
  await page.goto(
    `/diagnose/?lang=en&scenario=tikv-failover&event=${finalEventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('select[aria-label="State at event"]'))
    .toHaveValue(finalEventId)
  const electionAtEnd = page.locator('[data-table-section="raft-election"]')
  const retryAtEnd = page.locator(
    '[data-table-section="region-request-retry"]',
  )
  await expect(electionAtEnd).toContainText('elected')
  await expect(electionAtEnd).toContainText('tikv-2')
  await expect(electionAtEnd).toContainText('Observe and route metadata only')
  await expect(electionAtEnd).toContainText('true')
  await expect(retryAtEnd).toContainText('region-request-1')
  await expect(retryAtEnd).toContainText('TiDB internal')
  await expect(retryAtEnd).toContainText('2')
  await expect(retryAtEnd).toContainText('refreshed')
  await expect(retryAtEnd).toContainText('completed')
  await expect(retryAtEnd).toContainText('false')
  await expect(page.locator('[data-diagnose-section="raft-election"]'))
    .toHaveAttribute('data-tone', 'healthy')
  await expect(page.locator('[data-diagnose-section="region-request-retry"]'))
    .toHaveAttribute('data-tone', 'healthy')
  await expectNoSeriousAccessibilityViolations(page)
})

test('Protocol Lab exact Async response stays exclusive and readable on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const eventId = 'trace-1-event-32'
  await page.goto(
    `/?lang=en&scenario=commit-protocols&event=${eventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  })

  const layout = page.locator('.tidb-layout')
  const protocolLab = page.locator('[data-protocol-lab]')
  const asyncLane = protocolLab.locator(
    '[data-protocol-lane="async_commit"]',
  )
  const dock = page.locator('[data-trace-dock]')
  await expect(layout).toHaveAttribute('data-active-lab', 'protocol')
  await expect(layout).toHaveAttribute('data-inspect', 'open')
  await expect(protocolLab).toBeVisible()
  await expect(protocolLab).toHaveAttribute('tabindex', '0')
  await protocolLab.focus()
  await expect(protocolLab).toBeFocused()
  await expect(protocolLab).toHaveAttribute('data-protocol-phase', 'running')
  await expect(protocolLab.locator('[data-protocol-lane]')).toHaveCount(3)

  await expect(asyncLane).toHaveAttribute(
    'data-selected-protocol',
    'async_commit',
  )
  await expect(asyncLane).toHaveAttribute('data-client-responded', 'true')
  await expect(asyncLane).toHaveAttribute('data-background-complete', 'false')
  await expect(asyncLane.locator('[data-client-state="responded"]'))
    .toContainText('Committed response sent')
  await expect(asyncLane.locator('[data-background-state="pending"]'))
    .toContainText('Pending after client response')
  await expect(asyncLane.locator('[data-protocol-region]')).toHaveCount(2)
  await expect(asyncLane.locator('[data-mvcc-lock="prewrite"]')).toHaveCount(2)

  await expect(page.locator('[data-transaction-lab]')).toBeHidden()
  await expect(page.locator('[data-lock-lab]')).toBeHidden()
  await expect(page.locator('[data-raft-lab]')).toBeHidden()
  await expect(dock).toHaveAttribute('data-phase', 'paused')
  await expect(dock).toHaveAttribute('data-event-index', '31')
  await expect(dock).toHaveAttribute('data-event-count', '74')
  await expect(dock).toHaveAttribute('data-looping', 'true')
  await expect(page.locator('[data-action="trace-loop"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const [labBox, dockBox] = await Promise.all([
    protocolLab.boundingBox(),
    dock.boundingBox(),
  ])
  expect(labBox).not.toBeNull()
  expect(dockBox).not.toBeNull()
  if (!labBox || !dockBox) {
    throw new Error('Protocol Lab overlays have no layout box')
  }
  expect(labBox.y + labBox.height).toBeLessThanOrEqual(dockBox.y + 1)
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)

  await expectTraceLink(
    page,
    '.tidb-topbar [data-nav="machine"]',
    'commit-protocols',
    eventId,
    'en',
  )
  await expectTraceLink(
    page,
    '.tidb-topbar [data-nav="diagnose"]',
    'commit-protocols',
    eventId,
    'en',
  )
  await expectNoSeriousAccessibilityViolations(page)
})

test('Protocol Lab Machine separates its semantic graph at the regular 2PC boundary', async ({
  page,
}) => {
  const eventId = 'trace-1-event-67'
  await page.goto(
    `/machine/?lang=en&scenario=commit-protocols&event=${eventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  expect(new URL(page.url()).searchParams.get('event')).toBe(eventId)

  const current = page.locator('[data-event-index][aria-current="step"]')
  await expect(current).toHaveAttribute('data-event-index', '66')
  await expect(current).toHaveAttribute(
    'data-event-kind',
    'protocol_client_response',
  )
  await expect(current).toHaveAttribute('data-event-branch', 'two_pc')
  await expect(current).toHaveAttribute(
    'data-event-has-protocol-snapshot',
    'true',
  )

  const causal = page.locator('[data-graph-kind="causal-dag"]')
  const protocolGraph = page.locator(
    '[data-protocol-graph="semantic"]',
  )
  await expect(causal).toBeVisible()
  await expect(protocolGraph).toBeVisible()
  await expect(protocolGraph).toHaveAttribute(
    'data-graph-kind',
    'commit-protocol-comparison',
  )
  await expect(protocolGraph).toHaveAttribute('data-lane-count', '3')
  await expect(protocolGraph).toHaveAttribute('data-focus-lane', 'two_pc')
  await expect(protocolGraph).toHaveAttribute('tabindex', '0')
  await protocolGraph.focus()
  await expect(protocolGraph).toBeFocused()
  await expect(protocolGraph.locator('[data-protocol-lane]')).toHaveCount(3)
  await expect(causal.locator('[data-protocol-graph]')).toHaveCount(0)
  await expect(protocolGraph.locator('[data-protocol-edge]')).not.toHaveCount(0)
  await expect(protocolGraph.locator(
    '[data-protocol-edge][data-causal-from], ' +
    '[data-protocol-edge][data-causal-to], ' +
    '[data-protocol-edge][data-causal-domain], ' +
    '[data-protocol-edge][data-causal-path]',
  )).toHaveCount(0)

  const state = page.locator('[data-protocol-lab-state="true"]')
  await expect(state).toHaveAttribute('data-protocol-event-id', eventId)
  await expect(state).toHaveAttribute(
    'data-protocol-event-kind',
    'protocol_client_response',
  )
  await expect(state).toHaveAttribute('data-protocol-event-branch', 'two_pc')
  await expect(state).toHaveAttribute('data-protocol-phase', 'running')
  await expect(state).toHaveAttribute('data-protocol-focus', 'two_pc')
  await expect(state).toHaveAttribute(
    'data-client-boundary',
    'response_before_cleanup_completion',
  )
  const twoPcLane = state.locator('[data-protocol-lane="two_pc"]')
  await expect(twoPcLane).toHaveAttribute(
    'data-protocol-stage',
    'client_acknowledged',
  )
  await expect(twoPcLane).toHaveAttribute('data-client-responded', 'true')
  await expect(twoPcLane).toHaveAttribute('data-background-complete', 'false')
  await expect(twoPcLane.locator(
    '[data-region-role="primary"][data-mvcc-write-cf="commit"]',
  )).toHaveCount(1)
  await expect(twoPcLane.locator(
    '[data-region-role="secondary"][data-mvcc-lock-cf="prewrite"]',
  )).toHaveCount(1)
  await expect(state.locator('[data-aggregate-counts-only="true"]'))
    .toContainText('no SQL literals, keys, values, or result rows')

  await expectTraceLink(
    page,
    '.tidb-page-nav [data-nav="city"]',
    'commit-protocols',
    eventId,
    'en',
  )
  await expectTraceLink(
    page,
    '.tidb-page-nav [data-nav="diagnose"]',
    'commit-protocols',
    eventId,
    'en',
  )
  await expectNoSeriousAccessibilityViolations(page)
})

test('Protocol Lab Diagnose preserves response and final snapshots in English and Japanese', async ({
  page,
}) => {
  const scenario = 'commit-protocols'
  const asyncEventId = 'trace-1-event-32'
  await page.goto(
    `/diagnose/?lang=en&scenario=${scenario}&event=${asyncEventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('select[aria-label="State at event"]'))
    .toHaveValue(asyncEventId)
  await expect(page.locator('.tidb-diagnose'))
    .toHaveAttribute('data-active-lab', 'protocol')

  const selection = page.locator(
    '[data-table-section="protocol-selection"]',
  )
  const clientPath = page.locator(
    '[data-table-section="protocol-client-path"]',
  )
  const regionState = page.locator(
    '[data-table-section="protocol-region-state"]',
  )
  await expect(page.locator(
    '[data-diagnose-section="protocol-selection"]',
  )).toContainText('Declared fixture profile / outcome (static)')
  await expect(page.locator(
    '[data-diagnose-section="protocol-client-path"]',
  )).toBeVisible()
  await expect(page.locator(
    '[data-diagnose-section="protocol-region-state"]',
  )).toBeVisible()
  await expect(selection.locator('tbody tr')).toHaveCount(3)
  await expect(clientPath.locator('tbody tr')).toHaveCount(3)
  await expect(regionState.locator('tbody tr')).toHaveCount(5)
  await expect(selection).toContainText(
    'aggregate counts only (no SQL, keys, values, or rows)',
  )
  await expect(clientPath.locator('tbody tr').nth(1))
    .toContainText('client acknowledged')
  await expect(clientPath.locator('tbody tr').nth(1))
    .toContainText('running after client response')
  await expect(regionState.locator('tbody tr').filter({
    hasText: 'Async Commit',
  })).toHaveCount(2)
  await expect(regionState.locator('tbody tr').filter({
    hasText: 'Async Commit',
  }).filter({
    hasText: 'Prewrite lock',
  })).toHaveCount(2)
  await expectTraceLink(
    page,
    '.tidb-page-nav [data-nav="machine"]',
    scenario,
    asyncEventId,
    'en',
  )

  const finalEventId = 'trace-1-event-74'
  await page.goto(
    `/diagnose/?lang=en&scenario=${scenario}&event=${finalEventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('select[aria-label="State at event"]'))
    .toHaveValue(finalEventId)
  const finalClientPath = page.locator(
    '[data-table-section="protocol-client-path"]',
  )
  const finalRegionState = page.locator(
    '[data-table-section="protocol-region-state"]',
  )
  await expect(finalClientPath.locator('tbody tr')).toHaveCount(3)
  await expect(finalClientPath.locator('tbody tr').nth(1)).toContainText(
    'complete',
  )
  await expect(finalClientPath.locator('tbody tr').nth(2)).toContainText(
    'complete',
  )
  await expect(finalRegionState.locator('tbody tr')).toHaveCount(5)
  await expect(finalRegionState).not.toContainText('Prewrite lock')
  await expect(finalRegionState.locator('tbody tr').filter({
    hasText: 'commit record',
  })).toHaveCount(5)
  await expectTraceLink(
    page,
    '.tidb-page-nav [data-nav="city"]',
    scenario,
    finalEventId,
    'en',
  )

  await page.goto(
    `/diagnose/?lang=ja&scenario=${scenario}&event=${finalEventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(page.locator('select[aria-label="投影するイベント時点"]'))
    .toHaveValue(finalEventId)
  await expect(page.locator(
    '[data-diagnose-section="protocol-selection"]',
  )).toContainText('宣言済みfixture profile / outcome（固定）')
  await expect(page.locator(
    '[data-diagnose-section="protocol-client-path"]',
  )).toContainText('Exact-event client応答 / timestamp')
  await expect(page.locator(
    '[data-diagnose-section="protocol-region-state"]',
  )).toContainText('Exact-event Region Raft / MVCC状態')
  await expect(page.locator(
    '[data-table-section="protocol-selection"]',
  )).toContainText('集計数のみ（SQL・key・value・rowなし）')
  await expect(page.locator(
    '[data-table-section="protocol-region-state"]',
  )).not.toContainText('Prewrite lock')
  await expectTraceLink(
    page,
    '.tidb-page-nav [data-nav="machine"]',
    scenario,
    finalEventId,
    'ja',
  )
  expect(new URL(page.url()).searchParams.get('event')).toBe(finalEventId)
  await expectNoSeriousAccessibilityViolations(page)
})

test('GC/Storage Lab exact Compaction Filter cursor stays exclusive and preserves navigation', async ({
  page,
}) => {
  const scenario = 'gc-safe-point'
  const eventId = 'trace-1-event-22'
  await page.goto(`/?lang=en&scenario=${scenario}&event=${eventId}`)
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  })

  const layout = page.locator('.tidb-layout')
  const gcLab = page.locator('[data-gc-storage-lab]')
  const dock = page.locator('[data-trace-dock]')
  await expect(layout).toHaveAttribute('data-active-lab', 'gc-storage')
  await expect(layout).toHaveAttribute('data-inspect', 'open')
  await expect(gcLab).toBeVisible()
  await expect(gcLab).toHaveAttribute('tabindex', '0')
  await gcLab.focus()
  await expect(gcLab).toBeFocused()
  await expect(gcLab.locator('[data-gc-round]')).toHaveAttribute(
    'data-gc-round',
    '1',
  )
  await expect(gcLab.locator('[data-gc-phase]')).toHaveAttribute(
    'data-gc-phase',
    'compacting',
  )
  await expect(gcLab.locator('[data-safe-point-published]')).toHaveAttribute(
    'data-safe-point-published',
    '1000079999',
  )
  await expect(gcLab.locator(
    '[data-gc-version-id="b-v1"]',
  )).toHaveAttribute('data-gc-version-state', 'filtered')
  await expect(gcLab.locator(
    '[data-gc-store-id][data-compaction-state="running"]' +
    '[data-filter-active="true"]',
  )).toHaveCount(3)

  await expect(page.locator('[data-transaction-lab]')).toBeHidden()
  await expect(page.locator('[data-lock-lab]')).toBeHidden()
  await expect(page.locator('[data-raft-lab]')).toBeHidden()
  await expect(page.locator('[data-protocol-lab]')).toBeHidden()
  await expect(dock).toHaveAttribute('data-phase', 'paused')
  await expect(dock).toHaveAttribute('data-event-index', '21')
  await expect(dock).toHaveAttribute('data-event-count', '43')
  await expect(dock).toHaveAttribute('data-looping', 'true')
  await expect(page.locator('[data-action="trace-loop"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(new URL(page.url()).searchParams.get('scenario')).toBe(scenario)
  expect(new URL(page.url()).searchParams.get('event')).toBe(eventId)

  await expectTraceLink(
    page,
    '.tidb-topbar [data-nav="machine"]',
    scenario,
    eventId,
    'en',
  )
  await expectTraceLink(
    page,
    '.tidb-topbar [data-nav="diagnose"]',
    scenario,
    eventId,
    'en',
  )
  await expect(gcLab.locator('.tidb-gc-storage-lab__privacy')).toContainText(
    'Only aggregate counts and synthetic IDs are shown.',
  )
  await expectNoSeriousAccessibilityViolations(page)
})

test('GC/Storage Lab Machine keeps its semantic pipeline beside the causal DAG', async ({
  page,
}) => {
  const scenario = 'gc-safe-point'
  const eventId = 'trace-1-event-22'
  await page.goto(
    `/machine/?lang=en&scenario=${scenario}&event=${eventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  expect(new URL(page.url()).searchParams.get('event')).toBe(eventId)

  const current = page.locator('[data-event-index][aria-current="step"]')
  await expect(current).toHaveAttribute('data-event-index', '21')
  await expect(current).toHaveAttribute('data-event-domain', 'kv')
  await expect(current).toHaveAttribute(
    'data-event-kind',
    'gc_compaction_filter_apply',
  )
  await expect(current).toHaveAttribute('data-event-has-gc-snapshot', 'true')

  const causal = page.locator('[data-graph-kind="causal-dag"]')
  const state = page.locator('[data-gc-machine-state="true"]')
  const pipeline = state.locator('[data-gc-semantic-graph="pipeline"]')
  await expect(causal).toBeVisible()
  await expect(state).toHaveAttribute('data-gc-event-id', eventId)
  await expect(state).toHaveAttribute(
    'data-gc-event-kind',
    'gc_compaction_filter_apply',
  )
  await expect(state).toHaveAttribute('data-gc-phase', 'compacting')
  await expect(state).toHaveAttribute('data-gc-round', '1')
  await expect(state).toHaveAttribute('data-gc-model', 'model-6')
  await expect(pipeline).toBeVisible()
  await expect(pipeline).toHaveAttribute('tabindex', '0')
  await expect(pipeline).toHaveAttribute('data-causal-dag-replaced', 'false')
  await pipeline.focus()
  await expect(pipeline).toBeFocused()
  await expect(causal.locator('[data-gc-semantic-graph]')).toHaveCount(0)

  const roundOne = pipeline.locator('[data-gc-pipeline-round="1"]')
  await expect(roundOne).toHaveAttribute('data-gc-round-state', 'current')
  await expect(roundOne.locator(
    '[data-gc-pipeline-stage="compaction_filter"]',
  )).toHaveAttribute('data-gc-pipeline-state', 'current')
  await expect(state.locator(
    '[data-safe-point-store][data-safe-point-value="1000079999"]',
  )).toHaveCount(3)
  await expect(state.locator(
    '[data-gc-tikv-store][data-compaction-state="running"]' +
    '[data-filter-active="true"]',
  )).toHaveCount(3)
  await expect(state.locator('[data-gc-version="b-v1"]')).toHaveAttribute(
    'data-gc-version-state',
    'filtered',
  )
  await expect(state.locator('[data-storage-representation]')).toHaveAttribute(
    'data-storage-representation',
    'logical_chains_counted_once',
  )
  await expect(state.locator('.tidb-machine__gc-boundaries')).toHaveAttribute(
    'data-real-key-material',
    'false',
  )

  await expectTraceLink(
    page,
    '.tidb-page-nav [data-nav="city"]',
    scenario,
    eventId,
    'en',
  )
  await expectTraceLink(
    page,
    '.tidb-page-nav [data-nav="diagnose"]',
    scenario,
    eventId,
    'en',
  )
  await expectNoSeriousAccessibilityViolations(page)
})

test('GC/Storage Lab Diagnose preserves the exact Compaction Filter snapshot', async ({
  page,
}) => {
  const scenario = 'gc-safe-point'
  const eventId = 'trace-1-event-22'
  await page.goto(
    `/diagnose/?lang=en&scenario=${scenario}&event=${eventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('select[aria-label="State at event"]'))
    .toHaveValue(eventId)
  await expect(page.locator('.tidb-diagnose')).toHaveAttribute(
    'data-active-lab',
    'gc-storage',
  )

  const safePoint = page.locator(
    '[data-table-section="gc-safe-point-stores"]',
  )
  const coordinator = page.locator(
    '[data-table-section="gc-coordinator-path"]',
  )
  const resolveLocks = page.locator(
    '[data-table-section="gc-resolve-locks"]',
  )
  const deleteRanges = page.locator(
    '[data-table-section="gc-delete-ranges"]',
  )
  const storeCompaction = page.locator(
    '[data-table-section="gc-store-compaction"]',
  )
  const mvccChains = page.locator(
    '[data-table-section="gc-mvcc-chains"]',
  )
  await expect(safePoint.locator('tbody tr')).toHaveCount(1)
  await expect(coordinator.locator('tbody tr')).toHaveCount(5)
  await expect(resolveLocks.locator('tbody tr')).toHaveCount(2)
  await expect(deleteRanges.locator('tbody tr')).toHaveCount(3)
  await expect(storeCompaction.locator('tbody tr')).toHaveCount(3)
  await expect(mvccChains.locator('tbody tr')).toHaveCount(4)

  await expect(safePoint.locator('[data-column="phase"]')).toContainText(
    'compacting',
  )
  await expect(safePoint.locator(
    '[data-column="transactionBound"]',
  )).toContainText('1000079999')
  await expect(safePoint.locator(
    '[data-column="visibilitySafePoint"]',
  )).toContainText('1000079999')
  await expect(safePoint.locator(
    '[data-column="pdGlobalSafePoint"]',
  )).toContainText('1000079999')
  await expect(coordinator.locator(
    '[data-column="pipelineState"]',
  )).toHaveText(['complete', 'complete', 'complete', 'complete', 'complete'])
  await expect(resolveLocks.locator(
    '[data-column="implementation"]',
  )).toHaveText(['Region ScanLock', 'Region ScanLock'])
  await expect(resolveLocks.locator(
    '[data-column="pendingLocks"]',
  )).toHaveText(['0', '0'])
  await expect(deleteRanges.locator('[data-column="request"]')).toHaveText([
    'UnsafeDestroyRange',
    'UnsafeDestroyRange',
    'UnsafeDestroyRange',
  ])
  await expect(storeCompaction.locator(
    '[data-column="compaction"]',
  )).toHaveText(['running', 'running', 'running'])
  await expect(storeCompaction.locator(
    '[data-column="filterActive"]',
  )).toHaveText(['true', 'true', 'true'])
  await expect(mvccChains.locator(
    '[data-column="eligibility"]',
  ).first()).toContainText('commit_ts <= published safe point')

  const gcSections = page.locator(
    '[data-diagnose-section^="gc-"]',
  )
  await expect(gcSections).toHaveCount(6)
  await expect(page.locator(
    '[data-diagnose-section^="gc-"]' +
    '[data-privacy-boundary="synthetic-aggregate-only"]',
  )).toHaveCount(6)
  await expect(deleteRanges.locator(
    '[data-column="privacyBoundary"]',
  )).toHaveText([
    'no real key-range boundaries retained',
    'no real key-range boundaries retained',
    'no real key-range boundaries retained',
  ])

  await expectTraceLink(
    page,
    '.tidb-page-nav [data-nav="machine"]',
    scenario,
    eventId,
    'en',
  )
  await expectTraceLink(
    page,
    '.tidb-page-nav [data-nav="city"]',
    scenario,
    eventId,
    'en',
  )
  await expectNoSeriousAccessibilityViolations(page)
})

test('TiFlash/MPP Lab keeps the exact learner-apply cursor responsive and loops one immutable receipt', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(
    `/?lang=en&scenario=${TIFLASH_MPP_SCENARIO}` +
    `&event=${TIFLASH_MPP_TRANSITION_EVENT}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  })

  const layout = page.locator('.tidb-layout')
  const lab = page.locator('[data-tiflash-mpp-lab]')
  const dock = page.locator('[data-trace-dock]')
  await expect(layout).toHaveAttribute('data-active-lab', 'tiflash-mpp')
  await expect(layout).toHaveAttribute('data-inspect', 'open')
  await expect(lab).toBeVisible()
  await expect(lab).toHaveAttribute('tabindex', '0')
  await expect(lab).toHaveAttribute(
    'data-tiflash-mpp-phase',
    'snapshot_gating',
  )
  await expect(lab).toHaveAttribute(
    'data-result-representation',
    'aggregate_counts_only',
  )
  await expect(lab).toHaveAttribute('data-result-rows-projected', 'false')
  await lab.focus()
  await expect(lab).toBeFocused()

  const storeMetric = lab.locator(
    '.tidb-tiflash-mpp-lab__provisioning ' +
    '.tidb-tiflash-mpp-lab__metric',
  ).filter({ hasText: 'TiFlash stores' })
  await expect(storeMetric.locator('dd')).toHaveText('2')
  await expect(lab.locator('[data-region-id]')).toHaveCount(3)
  await expect(lab.locator(
    '.tidb-tiflash-mpp-lab__fragment[data-fragment-id]',
  )).toHaveCount(2)
  await expect(lab.locator('[data-task-id]')).toHaveCount(4)
  await expect(lab.locator('[data-tunnel-id]')).toHaveCount(6)

  const region26 = lab.locator(
    '[data-region-id="26"][data-read-gate="waiting_applied"]',
  )
  await expect(region26).toHaveAttribute('data-gate-reason', 'none')
  await expect(region26).toContainText('261')
  await expect(region26).toContainText(
    'Applied index reached required ReadIndex',
  )

  const planes = lab.locator('.tidb-tiflash-mpp-lab__planes')
  await expect(planes).toContainText('persistent_region_raft')
  await expect(planes).toContainText('ephemeral_query_blocks')
  await expect(planes).toContainText(
    'Persistent Region Raft replication and per-query ephemeral MPP block exchange are separate paths.',
  )

  await expect(page.locator('[data-transaction-lab]')).toBeHidden()
  await expect(page.locator('[data-lock-lab]')).toBeHidden()
  await expect(page.locator('[data-raft-lab]')).toBeHidden()
  await expect(page.locator('[data-protocol-lab]')).toBeHidden()
  await expect(page.locator('[data-gc-storage-lab]')).toBeHidden()
  await expect(dock).toHaveAttribute('data-phase', 'paused')
  await expect(dock).toHaveAttribute('data-event-index', '36')
  await expect(dock).toHaveAttribute('data-event-count', '56')
  await expect(dock).toHaveAttribute('data-looping', 'true')
  await expect(page.locator('[data-action="trace-loop"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await expect.poll(async () =>
    page.evaluate(() => {
      const city = window.TICITY.world?.shell.city
      if (!city) return null
      return {
        tiflashVisible: city.tiflashMppLab.object.visible,
        transactionVisible: city.transactionLab.object.visible,
        lockVisible: city.lockLab.object.visible,
        raftVisible: city.raftLab.object.visible,
        protocolVisible: city.protocolLab.object.visible,
        gcVisible: city.gcStorageLab.object.visible,
        capacities: {
          stores: city.tiflashMppLab.debug.resources.storeCapacity,
          learners: city.tiflashMppLab.debug.resources.learnerCapacity,
          tasks: city.tiflashMppLab.debug.resources.taskCapacity,
          tunnels: city.tiflashMppLab.debug.resources.tunnelCapacity,
        },
      }
    })).toEqual({
      tiflashVisible: true,
      transactionVisible: false,
      lockVisible: false,
      raftVisible: false,
      protocolVisible: false,
      gcVisible: false,
      capacities: {
        stores: 2,
        learners: 3,
        tasks: 4,
        tunnels: 6,
      },
    })

  expect(new URL(page.url()).searchParams.get('scenario'))
    .toBe(TIFLASH_MPP_SCENARIO)
  expect(new URL(page.url()).searchParams.get('event'))
    .toBe(TIFLASH_MPP_TRANSITION_EVENT)
  await expectTraceLink(
    page,
    '.tidb-topbar [data-nav="machine"]',
    TIFLASH_MPP_SCENARIO,
    TIFLASH_MPP_TRANSITION_EVENT,
    'en',
  )
  await expectTraceLink(
    page,
    '.tidb-topbar [data-nav="diagnose"]',
    TIFLASH_MPP_SCENARIO,
    TIFLASH_MPP_TRANSITION_EVENT,
    'en',
  )

  await expect(lab.locator('.tidb-tiflash-mpp-lab__privacy')).toContainText(
    'SQL text, literals, real or encoded keys, values, rows, and result rows are neither retained nor projected.',
  )
  const receiptPrivacy = await page.evaluate(() => {
    const receipt = window.TICITY.trace
    if (!receipt) throw new Error('Expected the TiFlash/MPP receipt.')
    const serialized = JSON.stringify(receipt.events)
    const forbiddenPayloadFields: string[] = []
    const visit = (value: unknown, path = 'events'): void => {
      if (!value || typeof value !== 'object') return
      for (const [key, nested] of Object.entries(value)) {
        const nextPath = `${path}.${key}`
        if (
          /^(?:sql|sqlText|statement|literal|address|host|key|encodedKey|value|row|resultRow|resultRows)$/i
            .test(key)
        ) {
          forbiddenPayloadFields.push(nextPath)
        }
        visit(nested, nextPath)
      }
    }
    visit(receipt.events)
    const retainedValues = receipt.events.flatMap((event) => {
      const metadata = event.metadata ?? {}
      return [
        metadata.rowValuesRetained,
        metadata.resultValuesRetained,
        metadata.exactValuesRetained,
      ].filter((value) => value !== undefined)
    })
    return {
      forbiddenPayloadFields,
      networkAddress:
        /(?:\d{1,3}\.){3}\d{1,3}:\d+|https?:\/\//i.test(serialized),
      retainedValues,
    }
  })
  expect(receiptPrivacy).toEqual({
    forbiddenPayloadFields: [],
    networkAddress: false,
    retainedValues: [false, false, false],
  })

  const [labBox, dockBox] = await Promise.all([
    lab.boundingBox(),
    dock.boundingBox(),
  ])
  expect(labBox).not.toBeNull()
  expect(dockBox).not.toBeNull()
  if (!labBox || !dockBox) {
    throw new Error('TiFlash/MPP Lab overlays have no layout box')
  }
  expect(labBox.y + labBox.height).toBeLessThanOrEqual(dockBox.y + 1)
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
  await expectNoSeriousAccessibilityViolations(page)

  const loop = await page.evaluate(() => {
    const receipt = window.TICITY.trace
    const world = window.TICITY.world
    if (!receipt || !world) {
      throw new Error('Expected an active TiFlash/MPP receipt and world.')
    }
    const serializedBefore = JSON.stringify(receipt)
    const finalBefore = receipt.events.at(-1)?.snapshot?.tiflashMppLab
    world.shell.stop()
    const flows = world.shell.flows
    flows.replay()
    flows.update(flows.playback.durationMs / 1_000 + 1)
    const holding = {
      phase: flows.playback.phase,
      atEnd: flows.playback.atEnd,
      iteration: flows.playback.iteration,
    }
    flows.update(3)
    const finalAfter = window.TICITY.trace?.events.at(-1)
      ?.snapshot?.tiflashMppLab
    return {
      holding,
      looped: {
        phase: flows.playback.phase,
        atEnd: flows.playback.atEnd,
        iteration: flows.playback.iteration,
        currentIndex: flows.playback.currentIndex,
      },
      sameReceiptReference: window.TICITY.trace === receipt,
      sameReceiptValue: JSON.stringify(window.TICITY.trace) === serializedBefore,
      sameFinalSnapshotReference: finalAfter === finalBefore,
      receiptFrozen:
        Object.isFrozen(receipt.events) &&
        Object.isFrozen(finalBefore) &&
        Object.isFrozen(finalBefore?.learners),
      finalState: {
        phase: finalAfter?.phase,
        appliedIndexes: finalAfter?.learners.map((learner) =>
          learner.learnerAppliedIndex),
        clientComplete: finalAfter?.result.clientComplete,
      },
    }
  })
  expect(loop.holding).toEqual({
    phase: 'holding',
    atEnd: true,
    iteration: 1,
  })
  expect(loop.looped).toEqual({
    phase: 'playing',
    atEnd: false,
    iteration: 2,
    currentIndex: 0,
  })
  expect(loop.sameReceiptReference).toBe(true)
  expect(loop.sameReceiptValue).toBe(true)
  expect(loop.sameFinalSnapshotReference).toBe(true)
  expect(loop.receiptFrozen).toBe(true)
  expect(loop.finalState).toEqual({
    phase: 'complete',
    appliedIndexes: [241, 251, 261],
    clientComplete: true,
  })
  await expect(dock).toHaveAttribute('data-iteration', '2')
})

test('TiFlash/MPP Machine separates the causal DAG from the fragment-task graph', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(
    `/machine/?lang=en&scenario=${TIFLASH_MPP_SCENARIO}` +
    `&event=${TIFLASH_MPP_TRANSITION_EVENT}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  expect(new URL(page.url()).searchParams.get('event'))
    .toBe(TIFLASH_MPP_TRANSITION_EVENT)

  const current = page.locator('[data-event-index][aria-current="step"]')
  await expect(current).toHaveAttribute('data-event-index', '36')
  await expect(current).toHaveAttribute('data-event-domain', 'tiflash')
  await expect(current).toHaveAttribute(
    'data-event-kind',
    'tiflash_learner_applied_advance',
  )
  await expect(current).toHaveAttribute(
    'data-event-has-tiflash-mpp-snapshot',
    'true',
  )

  const causal = page.locator('[data-graph-kind="causal-dag"]')
  const state = page.locator('[data-tiflash-mpp-machine-state="true"]')
  const semantic = state.locator(
    '[data-tiflash-mpp-semantic-graph="fragment-task"]',
  )
  await expect(causal).toBeVisible()
  await expect(state).toHaveAttribute(
    'data-tiflash-mpp-event-id',
    TIFLASH_MPP_TRANSITION_EVENT,
  )
  await expect(state).toHaveAttribute(
    'data-tiflash-mpp-event-kind',
    'tiflash_learner_applied_advance',
  )
  await expect(state).toHaveAttribute(
    'data-tiflash-mpp-phase',
    'snapshot_gating',
  )
  await expect(state).toHaveAttribute('data-tiflash-mpp-model', 'model-7')
  await expect(semantic).toBeVisible()
  await expect(semantic).toHaveAttribute('tabindex', '0')
  await expect(semantic).toHaveAttribute(
    'data-causal-dag-replaced',
    'false',
  )
  await expect(semantic).toHaveAttribute('data-fragment-count', '2')
  await expect(semantic).toHaveAttribute('data-task-count', '4')
  await expect(semantic).toHaveAttribute('data-tunnel-count', '6')
  await semantic.focus()
  await expect(semantic).toBeFocused()
  await expect(causal.locator('[data-tiflash-mpp-semantic-graph]'))
    .toHaveCount(0)

  const replication = state.locator(
    '[data-tiflash-plane="persistent_region_raft"]',
  )
  await expect(replication).toBeVisible()
  await expect(replication).toHaveAttribute(
    'data-initial-snapshot-modeled',
    'false',
  )
  await expect(replication.locator('[data-tiflash-learner-region]'))
    .toHaveCount(3)
  await expect(replication.locator(
    '[data-tiflash-learner-region="26"]' +
    '[data-tiflash-read-gate="waiting_applied"]' +
    '[data-applied-index="261"]' +
    '[data-required-read-index="261"]',
  )).toHaveCount(1)
  await expect(semantic.locator('[data-mpp-fragment]')).toHaveCount(2)
  await expect(semantic.locator('[data-mpp-task]')).toHaveCount(4)
  await expect(semantic.locator(
    '[data-mpp-tunnel][data-mpp-persistent="false"]',
  )).toHaveCount(6)
  await expect(state.locator('.tidb-machine__tiflash-boundary')).toContainText(
    'MPP Exchange carries ephemeral query blocks and never changes Raft or MVCC state.',
  )
  await expect(state.locator('.tidb-machine__tiflash-boundary')).toContainText(
    'no raw SQL, address, real key/value, group value, result row, session ID, or production TSO is retained.',
  )

  await expectTraceLink(
    page,
    '.tidb-page-nav [data-nav="city"]',
    TIFLASH_MPP_SCENARIO,
    TIFLASH_MPP_TRANSITION_EVENT,
    'en',
  )
  await expectTraceLink(
    page,
    '.tidb-page-nav [data-nav="diagnose"]',
    TIFLASH_MPP_SCENARIO,
    TIFLASH_MPP_TRANSITION_EVENT,
    'en',
  )
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
  await expectNoSeriousAccessibilityViolations(page)

  await page.goto(
    `/machine/?lang=en&scenario=${TIFLASH_MPP_SCENARIO}` +
    `&event=${TIFLASH_MPP_FINAL_EVENT}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  const finalCurrent = page.locator(
    '[data-event-index][aria-current="step"]',
  )
  await expect(finalCurrent).toHaveAttribute('data-event-index', '55')
  await expect(finalCurrent).toHaveAttribute(
    'data-event-kind',
    'tiflash_client_query_complete',
  )
  const finalState = page.locator(
    '[data-tiflash-mpp-machine-state="true"]',
  )
  await expect(finalState).toHaveAttribute('data-tiflash-mpp-phase', 'complete')
  await expect(finalState.locator(
    '[data-mpp-task][data-mpp-task-stage="complete"]',
  )).toHaveCount(4)
  await expect(finalState.locator(
    '[data-mpp-tunnel][data-mpp-tunnel-state="received"]',
  )).toHaveCount(6)
  await expect(finalState.locator('.tidb-machine__tiflash-root'))
    .toHaveAttribute('data-mpp-result-stage', 'client_complete')
  await expect(finalState.locator('.tidb-machine__tiflash-root'))
    .toHaveAttribute('data-mpp-client-complete', 'true')
  await expect(finalState.locator('.tidb-machine__tiflash-root'))
    .toHaveAttribute('data-mpp-retry-count', '0')
  await expect(finalState.locator('.tidb-machine__tiflash-root'))
    .toHaveAttribute('data-mpp-fallback', 'false')
})

test('TiFlash/MPP Diagnose preserves exact rows, final completion, and invalid-event fallback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(
    `/diagnose/?lang=en&scenario=${TIFLASH_MPP_SCENARIO}` +
    `&event=${TIFLASH_MPP_TRANSITION_EVENT}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('select[aria-label="State at event"]'))
    .toHaveValue(TIFLASH_MPP_TRANSITION_EVENT)
  await expect(page.locator('.tidb-diagnose')).toHaveAttribute(
    'data-active-lab',
    'tiflash-mpp',
  )

  const replication = page.locator(
    '[data-table-section="tiflash-replication"]',
  )
  const gates = page.locator(
    '[data-table-section="tiflash-read-gates"]',
  )
  const tasks = page.locator(
    '[data-table-section="tiflash-mpp-tasks"]',
  )
  const tunnels = page.locator(
    '[data-table-section="tiflash-mpp-tunnels"]',
  )
  const root = page.locator(
    '[data-table-section="tiflash-mpp-root"]',
  )
  await expect(replication.locator('tbody tr')).toHaveCount(3)
  await expect(gates.locator('tbody tr')).toHaveCount(3)
  await expect(tasks.locator('tbody tr')).toHaveCount(4)
  await expect(tunnels.locator('tbody tr')).toHaveCount(6)
  await expect(root.locator('tbody tr')).toHaveCount(1)

  const region26Replication = replication.locator('tbody tr').nth(2)
  await expect(region26Replication.locator(
    '[data-column="learnerAppliedIndex"]',
  )).toHaveText('261')
  await expect(region26Replication.locator(
    '[data-column="replicationPlane"]',
  )).toHaveText('persistent_region_raft')
  await expect(region26Replication.locator(
    '[data-column="exchangeMutation"]',
  )).toHaveText('false')
  const region26Gate = gates.locator('tbody tr').nth(2)
  await expect(region26Gate.locator('[data-column="gateState"]'))
    .toHaveText('waiting_applied')
  await expect(region26Gate.locator(
    '[data-column="requiredReadIndex"]',
  )).toHaveText('261')
  await expect(region26Gate.locator(
    '[data-column="learnerAppliedIndex"]',
  )).toHaveText('261')
  await expect(tunnels.locator('[data-column="exchangePlane"]'))
    .toHaveText([
      'ephemeral_query_blocks',
      'ephemeral_query_blocks',
      'ephemeral_query_blocks',
      'ephemeral_query_blocks',
      'ephemeral_query_blocks',
      'ephemeral_query_blocks',
    ])
  await expect(tunnels.locator('[data-column="raftOrMvccMutation"]'))
    .toHaveText(['false', 'false', 'false', 'false', 'false', 'false'])
  await expect(root.locator('[data-column="phase"]'))
    .toContainText('snapshot_gating')
  await expect(root.locator('[data-column="resultStage"]'))
    .toHaveText('idle')
  await expect(root.locator('[data-column="clientComplete"]'))
    .toHaveText('false')

  await expectTraceLink(
    page,
    '.tidb-page-nav [data-nav="machine"]',
    TIFLASH_MPP_SCENARIO,
    TIFLASH_MPP_TRANSITION_EVENT,
    'en',
  )
  await expectTraceLink(
    page,
    '.tidb-page-nav [data-nav="city"]',
    TIFLASH_MPP_SCENARIO,
    TIFLASH_MPP_TRANSITION_EVENT,
    'en',
  )
  expect(new URL(page.url()).searchParams.get('event'))
    .toBe(TIFLASH_MPP_TRANSITION_EVENT)
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
  await expectNoSeriousAccessibilityViolations(page)

  await page.goto(
    `/diagnose/?lang=en&scenario=${TIFLASH_MPP_SCENARIO}` +
    `&event=${TIFLASH_MPP_FINAL_EVENT}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('select[aria-label="State at event"]'))
    .toHaveValue(TIFLASH_MPP_FINAL_EVENT)
  const finalTasks = page.locator(
    '[data-table-section="tiflash-mpp-tasks"]',
  )
  const finalTunnels = page.locator(
    '[data-table-section="tiflash-mpp-tunnels"]',
  )
  const finalRoot = page.locator(
    '[data-table-section="tiflash-mpp-root"]',
  )
  await expect(finalTasks.locator('[data-column="stage"]'))
    .toHaveText(['complete', 'complete', 'complete', 'complete'])
  await expect(finalTunnels.locator('[data-column="state"]'))
    .toHaveText([
      'received',
      'received',
      'received',
      'received',
      'received',
      'received',
    ])
  await expect(finalRoot.locator('[data-column="phase"]'))
    .toContainText('complete')
  await expect(finalRoot.locator('[data-column="resultStage"]'))
    .toHaveText('client_complete')
  await expect(finalRoot.locator('[data-column="rootStreams"]'))
    .toHaveText('2')
  await expect(finalRoot.locator('[data-column="clientComplete"]'))
    .toHaveText('true')
  await expect(finalRoot.locator('[data-column="retryCount"]'))
    .toHaveText('0')
  await expect(finalRoot.locator('[data-column="fallbackToTiKV"]'))
    .toHaveText('false')

  const invalidEvent = 'trace-1-event-999'
  await page.goto(
    `/diagnose/?lang=en&scenario=${TIFLASH_MPP_SCENARIO}` +
    `&event=${invalidEvent}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('select[aria-label="State at event"]'))
    .toHaveValue('')
  await expect(page.locator('.tidb-diagnose-cursor-note'))
    .toHaveAttribute('data-cursor-resolution', 'final')
  await expect(page.locator(
    '[data-table-section="tiflash-mpp-root"] ' +
    '[data-column="clientComplete"]',
  )).toHaveText('true')
  expect(new URL(page.url()).searchParams.get('event')).toBe(invalidEvent)
})

test('desktop controls start collapsed and toggle the panel accessibly', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const layout = page.locator('.tidb-layout')
  const panel = page.locator('[data-action="panel"]')
  const controls = page.locator('#tidb-control-panel')
  await expect(layout).toHaveAttribute('data-panel', 'closed')
  await expect(panel).toHaveAttribute('aria-expanded', 'false')
  await expect(panel).toHaveAttribute('aria-pressed', 'false')
  await expect(controls).toBeHidden()

  await panel.click()
  await expect(layout).toHaveAttribute('data-panel', 'open')
  await expect(panel).toHaveAttribute('aria-expanded', 'true')
  await expect(panel).toHaveAttribute('aria-pressed', 'true')
  await expect(controls).toBeVisible()

  await panel.click()
  await expect(layout).toHaveAttribute('data-panel', 'closed')
  await expect(panel).toHaveAttribute('aria-expanded', 'false')
  await expect(controls).toBeHidden()
})

test('orbit view can zoom out to a city-scale overview without clipping the atmosphere', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const canvas = page.locator('.tidb-world canvas')
  await expect(canvas).toBeVisible()
  const initial = await page.evaluate(() => {
    const { camera } = window.TICITY.world!.shell
    const target = { x: 0, y: 14, z: 30 }
    return {
      distance: Math.hypot(
        camera.position.x - target.x,
        camera.position.y - target.y,
        camera.position.z - target.z,
      ),
      far: camera.far,
    }
  })

  const orbitBeforeDrag = await cameraSnapshot(page)
  const canvasBox = await canvas.boundingBox()
  if (!canvasBox) throw new Error('Orbit canvas has no layout box')
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.62,
    canvasBox.y + canvasBox.height * 0.48,
  )
  await page.mouse.down()
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.68,
    canvasBox.y + canvasBox.height * 0.52,
    { steps: 4 },
  )
  await page.mouse.up()
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const orbitAfterDrag = await cameraSnapshot(page)
  expect(distance3(orbitAfterDrag.position, orbitBeforeDrag.position)).toBeGreaterThan(1)
  expect(distance3(orbitAfterDrag.direction, orbitBeforeDrag.direction)).toBeGreaterThan(0.01)

  // One high-resolution trackpad gesture should be enough to exercise the
  // configured OrbitControls ceiling, independent of browser wheel batching.
  await canvas.dispatchEvent('wheel', {
    clientX: 720,
    clientY: 450,
    deltaMode: 0,
    deltaY: 2_000,
  })
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))

  const overview = await page.evaluate(() => {
    const { camera, scene, city } = window.TICITY.world!.shell
    const target = { x: 0, y: 14, z: 30 }
    const sky = city.root.getObjectByName('city:sky-dome')
    const fogFar = 'far' in (scene.fog ?? {}) ? scene.fog?.far ?? 0 : 0
    return {
      distance: Math.hypot(
        camera.position.x - target.x,
        camera.position.y - target.y,
        camera.position.z - target.z,
      ),
      far: camera.far,
      fogFar,
      skyDistance: sky ? sky.position.distanceTo(camera.position) : Number.POSITIVE_INFINITY,
      labelsDistant: document.querySelector('.tidb-world-labels')
        ?.classList.contains('is-distant') ?? false,
    }
  })

  expect(initial.distance).toBeGreaterThan(590)
  expect(initial.distance).toBeLessThan(610)
  expect(overview.distance).toBeGreaterThan(initial.distance * 2.7)
  expect(overview.distance).toBeLessThanOrEqual(1_651)
  expect(overview.far).toBeGreaterThanOrEqual(4_000)
  expect(overview.fogFar).toBeGreaterThanOrEqual(2_800)
  expect(overview.skyDistance).toBeLessThan(0.01)
  expect(overview.labelsDistant).toBe(true)
})

test('fly keeps the overview pose, follows the full view vector, and clears movement on blur', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  // Stop the render clock so every camera integration below is explicit and
  // independent of browser scheduling.
  await page.evaluate(() => window.TICITY.world!.shell.stop())
  const canvas = page.locator('.tidb-world canvas')
  const canvasBox = await canvas.boundingBox()
  if (!canvasBox) throw new Error('Fly canvas has no layout box')
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.52,
    canvasBox.y + canvasBox.height * 0.46,
  )
  await page.mouse.down()
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.58,
    canvasBox.y + canvasBox.height * 0.49,
  )
  await page.mouse.up()
  // Because the render loop is stopped, OrbitControls still has a damping
  // remainder here. A mode round-trip must not apply that private residue.
  const overview = await cameraSnapshot(page)

  const fly = page.locator('[data-view="fly"]')
  await fly.click()
  await expect(fly).toHaveAttribute('aria-pressed', 'true')
  const idle = await page.evaluate(() => {
    const shell = window.TICITY.world!.shell
    shell.controls.update(1 / 60)
    return shell.controls.mode
  })
  expect(idle).toBe('fly')

  const flyStart = await cameraSnapshot(page)
  expect(distance3(flyStart.position, overview.position)).toBeLessThan(0.001)
  expect(distance3(flyStart.direction, overview.direction)).toBeLessThan(0.001)

  const orbit = page.locator('[data-view="orbit"]')
  await orbit.click()
  await page.evaluate(() => {
    const controls = window.TICITY.world!.shell.controls
    for (let frame = 0; frame < 60; frame++) controls.update(1 / 60)
  })
  const orbitRestored = await cameraSnapshot(page)
  expect(distance3(orbitRestored.position, overview.position)).toBeLessThan(0.01)
  expect(distance3(orbitRestored.direction, overview.direction)).toBeLessThan(0.001)
  await fly.click()

  const lookStartX = canvasBox.x + canvasBox.width * 0.55
  const lookStartY = canvasBox.y + canvasBox.height * 0.5
  const beforeDragLook = await cameraSnapshot(page)
  // Start with a trusted mouse press so the canvas owns pointer capture, then
  // send an unlocked move whose raw movement is deliberately zero. The camera
  // must derive the drag from client coordinates for touch/Safari parity.
  await page.mouse.move(lookStartX, lookStartY)
  await page.mouse.down()
  await canvas.dispatchEvent('pointermove', {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: lookStartX + 80,
    clientY: lookStartY,
    movementX: 0,
    movementY: 0,
  })
  await page.mouse.up()
  const afterDragLook = await cameraSnapshot(page)
  expect(distance3(afterDragLook.direction, beforeDragLook.direction)).toBeGreaterThan(0.05)

  const forward = await page.evaluate(() => {
    const { camera, controls: controller } = window.TICITY.world!.shell
    camera.updateMatrixWorld(true)
    const matrix = camera.matrixWorld.elements
    const direction = [-matrix[8], -matrix[9], -matrix[10]] as const
    const before = [camera.position.x, camera.position.y, camera.position.z] as const

    controller.setMovement('forward', true)
    controller.update(0.05)
    controller.setMovement('forward', false)

    const displacement = [
      camera.position.x - before[0],
      camera.position.y - before[1],
      camera.position.z - before[2],
    ] as const
    const length = Math.hypot(...displacement)
    const alignment =
      (displacement[0] * direction[0] +
        displacement[1] * direction[1] +
        displacement[2] * direction[2]) /
      Math.max(1e-9, length)
    return { direction, displacement, length, alignment }
  })
  expect(forward.direction[1]).toBeLessThan(-0.3)
  expect(forward.displacement[1]).toBeLessThan(-0.5)
  expect(forward.length).toBeGreaterThan(1)
  expect(forward.alignment).toBeGreaterThan(0.995)

  const beforeBlur = await cameraSnapshot(page)
  await page.keyboard.down('w')
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
    window.TICITY.world!.shell.controls.update(0.05)
  })
  await page.keyboard.up('w')
  const afterBlur = await cameraSnapshot(page)
  expect(distance3(afterBlur.position, beforeBlur.position)).toBeLessThan(0.001)
})

test('walk starts safely, moves at pedestrian height, and returns to the saved orbit view', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => window.TICITY.world!.shell.stop())
  const overview = await cameraSnapshot(page)

  const walk = page.locator('[data-view="walk"]')
  await walk.click()
  await expect(walk).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.tidb-world-labels')).toBeHidden()

  const pedestrian = await page.evaluate(() => {
    const { camera, city, controls: controller } = window.TICITY.world!.shell
    controller.update(1 / 60)
    camera.updateMatrixWorld(true)
    const matrix = camera.matrixWorld.elements
    const start = [camera.position.x, camera.position.y, camera.position.z] as const
    const insideCollider = city.colliders.some((box) =>
      camera.position.x > box.minX - 0.58 &&
      camera.position.x < box.maxX + 0.58 &&
      camera.position.z > box.minZ - 0.58 &&
      camera.position.z < box.maxZ + 0.58
    )

    controller.setMovement('forward', true)
    controller.update(0.05)
    controller.setMovement('forward', false)
    const end = [camera.position.x, camera.position.y, camera.position.z] as const
    return {
      mode: controller.mode,
      start,
      end,
      directionY: -matrix[9],
      insideCollider,
      horizontalTravel: Math.hypot(end[0] - start[0], end[2] - start[2]),
    }
  })

  expect(pedestrian.mode).toBe('walk')
  expect(Math.abs(pedestrian.start[0])).toBeLessThanOrEqual(355)
  expect(Math.abs(pedestrian.start[2])).toBeLessThanOrEqual(355)
  expect(pedestrian.start[1]).toBeCloseTo(1.7, 3)
  expect(Math.abs(pedestrian.directionY)).toBeLessThan(0.2)
  expect(pedestrian.insideCollider).toBe(false)
  expect(pedestrian.horizontalTravel).toBeGreaterThan(0.2)
  expect(pedestrian.end[1]).toBeCloseTo(1.7, 3)

  const orbit = page.locator('[data-view="orbit"]')
  await orbit.click()
  await expect(orbit).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.tidb-world-labels')).toBeVisible()
  await page.evaluate(() => {
    const controls = window.TICITY.world!.shell.controls
    for (let frame = 0; frame < 120; frame++) controls.update(1 / 60)
  })
  const restored = await cameraSnapshot(page)
  const quaternionDot = Math.abs(
    overview.quaternion[0] * restored.quaternion[0] +
    overview.quaternion[1] * restored.quaternion[1] +
    overview.quaternion[2] * restored.quaternion[2] +
    overview.quaternion[3] * restored.quaternion[3],
  )
  expect(distance3(restored.position, overview.position)).toBeLessThan(0.01)
  expect(1 - quaternionDot).toBeLessThan(1e-6)
})

test('short 390px mobile exposes Fly and a non-overlapping movement pad', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const fly = page.locator('[data-view="fly"]')
  await expect(fly).toBeVisible()
  await fly.click()
  await expect(fly).toHaveAttribute('aria-pressed', 'true')

  const forward = page.locator('[data-camera-move="forward"]')
  await expect(forward).toBeVisible()
  const padLayout = await forward.evaluate((control) => {
    const box = control.getBoundingClientRect()
    const pad = control.closest('.tidb-movement-pad')!
    const padBox = pad.getBoundingClientRect()
    const dockBox = document.querySelector('[data-trace-dock]')!.getBoundingClientRect()
    const viewBox = document.querySelector('.tidb-view-actions')!.getBoundingClientRect()
    const targets = [...pad.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => !button.hidden)
      .map((button) => {
        const target = button.getBoundingClientRect()
        return {
          width: target.width,
          height: target.height,
          topHit: button.contains(document.elementFromPoint(
            target.left + target.width / 2,
            target.top + target.height / 2,
          )),
        }
      })
    return {
      width: box.width,
      height: box.height,
      label: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '',
      noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
      clearOfViewControls: padBox.top >= viewBox.bottom,
      clearOfTraceDock:
        padBox.right <= dockBox.left ||
        dockBox.right <= padBox.left ||
        padBox.bottom <= dockBox.top ||
        dockBox.bottom <= padBox.top,
      targets,
    }
  })
  expect(padLayout.width).toBeGreaterThanOrEqual(44)
  expect(padLayout.height).toBeGreaterThanOrEqual(44)
  expect(padLayout.label).not.toBe('')
  expect(padLayout.noHorizontalScroll).toBe(true)
  expect(padLayout.clearOfViewControls).toBe(true)
  expect(padLayout.clearOfTraceDock).toBe(true)
  expect(
    padLayout.targets.every(({ width, height, topHit }) =>
      width >= 44 && height >= 44 && topHit
    ),
  ).toBe(true)

  await page.evaluate(() => window.TICITY.world!.shell.stop())
  const before = await cameraSnapshot(page)
  const box = await forward.boundingBox()
  if (!box) throw new Error('Forward camera movement control has no layout box')
  const pointer = {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  }
  await forward.dispatchEvent('pointerdown', pointer)
  await page.evaluate(() => window.TICITY.world!.shell.controls.update(0.05))
  await forward.dispatchEvent('pointerup', pointer)
  const moved = await cameraSnapshot(page)
  expect(distance3(moved.position, before.position)).toBeGreaterThan(1)

  await page.evaluate(() => window.TICITY.world!.shell.controls.update(0.05))
  const released = await cameraSnapshot(page)
  expect(distance3(released.position, moved.position)).toBeLessThan(0.001)
})

test('day is the default theme and the selected theme survives reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const root = page.locator('html')
  const theme = page.locator('[data-nav="theme"]')
  await expect(root).toHaveAttribute('data-theme', 'day')
  await expect(theme).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => localStorage.getItem('ticity:theme'))).toBe('day')

  await theme.click()
  await expect(root).toHaveAttribute('data-theme', 'night')
  await expect(theme).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => localStorage.getItem('ticity:theme'))).toBe('night')

  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(root).toHaveAttribute('data-theme', 'night')
  await expect(theme).toHaveAttribute('aria-pressed', 'true')
})

test('overview labels remain present without selection across visual updates', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const labels = page.locator('.tidb-world-label')
  const names = page.locator('.tidb-world-label strong')
  await expect(page.locator('.tidb-world-labels')).toBeVisible()
  await expect(page.locator('.tidb-inspector')).toBeHidden()
  await expect(labels).toHaveCount(9)
  expect(await names.allTextContents()).toEqual(expect.arrayContaining([
    'CLIENTS',
    'TiProxy',
    'TiDB SQL',
    'PD / TSO',
    'TiKV STORE 1',
    'TiKV STORE 2',
    'TiKV STORE 3',
    'MVCC GC',
    'TiFlash',
  ]))

  await page.evaluate(() => {
    window.TICITY.runScenario('hotspot-split')
    window.TICITY.setTheme('night')
  })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  await expect(labels).toHaveCount(9)
  await expect(page.getByText('PD / TSO', { exact: true })).toBeVisible()
  await expect(page.getByText('TiFlash', { exact: true })).toBeVisible()
})

test('overview labels do not overlap in a short desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1_200, height: 630 })
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const verticalLayout = await page.evaluate(() => ({
    viewport: window.innerHeight,
    document: document.documentElement.scrollHeight,
  }))
  expect(verticalLayout.document).toBeLessThanOrEqual(verticalLayout.viewport + 1)

  const rectangles = await page.locator('.tidb-world-label').evaluateAll((labels) =>
    labels
      .filter((label) => {
        const element = label as HTMLElement
        return !element.hidden && getComputedStyle(element).display !== 'none'
      })
      .map((label) => {
        const rectangle = label.getBoundingClientRect()
        return {
          name: label.querySelector('strong')?.textContent ?? '',
          left: rectangle.left,
          right: rectangle.right,
          top: rectangle.top,
          bottom: rectangle.bottom,
        }
      }),
  )
  expect(rectangles.length).toBeGreaterThanOrEqual(8)

  const overlaps: string[] = []
  for (let left = 0; left < rectangles.length; left++) {
    for (let right = left + 1; right < rectangles.length; right++) {
      const horizontal =
        Math.min(rectangles[left].right, rectangles[right].right) -
        Math.max(rectangles[left].left, rectangles[right].left)
      const vertical =
        Math.min(rectangles[left].bottom, rectangles[right].bottom) -
        Math.max(rectangles[left].top, rectangles[right].top)
      // Fractional CSS pixels differ slightly across browser rasterizers.
      if (horizontal > 1 && vertical > 1) {
        overlaps.push(`${rectangles[left].name} / ${rectangles[right].name}`)
      }
    }
  }
  expect(overlaps).toEqual([])
})

test('trace replay keeps the causal route readable and supports transport controls', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => {
    window.TICITY.runScenario('cross-region-transaction')
  })

  const dock = page.locator('[data-trace-dock]')
  const eventCount = await page.evaluate(() => window.TICITY.trace?.events.length ?? 0)
  expect(eventCount).toBeGreaterThanOrEqual(32)
  await expect(dock).toBeVisible()
  await expect(dock).toHaveAttribute('data-event-count', String(eventCount))
  await expect(dock).toHaveAttribute('data-phase', 'playing')
  expect(Number(await dock.getAttribute('data-presentation-duration-ms'))).toBeGreaterThan(6_000)
  await expect(page.locator('[data-trace-label]')).not.toBeEmpty()
  await expect(page.locator('[data-trace-route]')).toContainText('→')
  await expect(page.locator('[data-action="inspect"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-transaction-lab]')).toBeVisible()

  // One presentation second must not collapse the detailed trace.
  await page.evaluate(() => window.TICITY.world!.shell.flows.update(1))
  await expect(dock).not.toHaveAttribute('data-phase', 'complete')

  await page.locator('[data-action="trace-toggle"]').click()
  await expect(dock).toHaveAttribute('data-phase', 'paused')
  const pausedIndex = Number(await dock.getAttribute('data-event-index'))
  await page.evaluate(() => window.TICITY.world!.shell.flows.update(5))
  await expect(dock).toHaveAttribute('data-event-index', String(pausedIndex))

  await page.locator('[data-action="trace-next"]').click()
  await expect.poll(async () => Number(await dock.getAttribute('data-event-index')))
    .toBeGreaterThan(pausedIndex)
  await expect(dock).toHaveAttribute('data-phase', 'paused')
  if (await page.locator('[data-trace-route]').getAttribute('data-local') === 'true') {
    await page.locator('[data-action="trace-next"]').click()
  }

  const visual = await page.evaluate(() => {
    const { city, flows } = window.TICITY.world!.shell
    return {
      guide: (flows.object.getObjectByName('trace-flow:route-guide') as {
        count?: number
      } | undefined)?.count ?? 0,
      endpoints: (flows.object.getObjectByName('trace-flow:endpoints') as {
        count?: number
      } | undefined)?.count ?? 0,
      networkOpacity: city.materials.dataLine.opacity,
      dropped: flows.dropped,
    }
  })
  expect(visual.guide).toBeGreaterThan(0)
  expect(visual.endpoints).toBe(2)
  expect(visual.networkOpacity).toBeLessThan(0.12)
  expect(visual.dropped).toBe(0)

  await page.locator('[data-action="trace-replay"]').click()
  await expect(dock).toHaveAttribute('data-phase', 'playing')
  await expect(dock).toHaveAttribute('data-event-index', '0')

  const loop = await page.evaluate(() => {
    const receipt = window.TICITY.trace
    if (!receipt) throw new Error('Expected an active TraceReceipt')
    const flows = window.TICITY.world!.shell.flows
    const receiptBefore = JSON.stringify(receipt)
    const presentationDurationBefore = flows.playback.durationMs

    flows.update(presentationDurationBefore / 1_000 + 1)
    const holding = {
      phase: flows.playback.phase,
      atEnd: flows.playback.atEnd,
      iteration: flows.playback.iteration,
      currentIndex: flows.playback.currentIndex,
      total: flows.playback.total,
    }

    // The longest end hold is 2.6 seconds for a failed trace. Advancing three
    // real seconds therefore starts the next presentation iteration.
    flows.update(3)
    return {
      holding,
      looped: {
        phase: flows.playback.phase,
        atEnd: flows.playback.atEnd,
        iteration: flows.playback.iteration,
        currentIndex: flows.playback.currentIndex,
        presentationDuration: flows.playback.durationMs,
      },
      sameReceiptReference: window.TICITY.trace === receipt,
      sameReceiptValue: JSON.stringify(window.TICITY.trace) === receiptBefore,
    }
  })
  expect(loop.holding).toEqual({
    phase: 'holding',
    atEnd: true,
    iteration: 1,
    currentIndex: loop.holding.total - 1,
    total: loop.holding.total,
  })
  expect(loop.looped).toMatchObject({
    phase: 'playing',
    atEnd: false,
    iteration: 2,
    currentIndex: 0,
  })
  expect(loop.looped.presentationDuration).toBeGreaterThan(6_000)
  expect(loop.sameReceiptReference).toBe(true)
  expect(loop.sameReceiptValue).toBe(true)
  await expect(dock).toHaveAttribute('data-looping', 'true')
  await expect(dock).toHaveAttribute('data-iteration', '2')
  await expect(page.locator('[data-action="trace-loop"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.locator('[data-action="trace-replay"]').click()
  await expect(dock).toHaveAttribute('data-iteration', '1')

  // A trace is historical presentation data: it can resume and replay even
  // while the deterministic workload remains held in model step mode.
  await page.evaluate(() => window.TICITY.model.setPlayback('step'))
  await expect(dock).toHaveAttribute('data-phase', 'paused')
  await page.locator('[data-action="trace-toggle"]').click()
  await expect(dock).toHaveAttribute('data-phase', 'playing')
  await page.locator('[data-action="trace-replay"]').click()
  await expect(dock).toHaveAttribute('data-phase', 'playing')
  await expect(dock).toHaveAttribute('data-event-index', '0')
})

test('mobile reduced-motion keeps a static route and usable trace controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const dock = page.locator('[data-trace-dock]')
  await expect(dock).toBeVisible()
  await expect(dock).toHaveAttribute('data-motion', 'reduced')
  await expect(dock).toHaveAttribute('data-looping', 'false')
  await expect(page.locator('[data-action="trace-loop"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(page.locator('[data-trace-label]')).not.toBeEmpty()
  await expect(page.locator('[data-trace-route]')).toBeVisible()

  const layout = await page.evaluate(() => {
    const dock = document.querySelector<HTMLElement>('[data-trace-dock]')!
    const world = document.querySelector<HTMLElement>('.tidb-world')!
    const dockBox = dock.getBoundingClientRect()
    const worldBox = world.getBoundingClientRect()
    const controls = [...dock.querySelectorAll<HTMLButtonElement>('[data-action]')]
      .filter((control) => getComputedStyle(control).display !== 'none')
      .map((control) => {
        const box = control.getBoundingClientRect()
        return { width: box.width, height: box.height }
      })
    const flows = window.TICITY.world!.shell.flows
    const guideMesh = flows.object.getObjectByName('trace-flow:route-guide') as {
      count: number
      instanceMatrix: { array: ArrayLike<number> }
      instanceColor?: { array: ArrayLike<number> } | null
    }
    // Freeze the presentation clock so this assertion measures reduced-motion
    // rendering, not an incidental event-boundary transition.
    flows.setPaused(true)
    flows.update(0.05)
    const before = Array.from(flows.mesh.instanceMatrix.array.slice(0, 16))
    const guideBefore = Array.from(guideMesh.instanceMatrix.array).slice(
      0,
      guideMesh.count * 16,
    )
    const guideColorBefore = guideMesh.instanceColor
      ? Array.from(guideMesh.instanceColor.array).slice(0, guideMesh.count * 3)
      : []
    flows.update(0.1)
    const after = Array.from(flows.mesh.instanceMatrix.array.slice(0, 16))
    const guideAfter = Array.from(guideMesh.instanceMatrix.array).slice(
      0,
      guideMesh.count * 16,
    )
    const guideColorAfter = guideMesh.instanceColor
      ? Array.from(guideMesh.instanceColor.array).slice(0, guideMesh.count * 3)
      : []
    flows.setPaused(false)
    return {
      dockInsideWorld:
        dockBox.left >= worldBox.left - 1 &&
        dockBox.right <= worldBox.right + 1 &&
        dockBox.top >= worldBox.top - 1 &&
        dockBox.bottom <= worldBox.bottom + 1,
      controls,
      noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
      staticPacket: before.every((value, index) => value === after[index]),
      staticGuide:
        guideBefore.every((value, index) => value === guideAfter[index]) &&
        guideColorBefore.every((value, index) => value === guideColorAfter[index]),
      guide: guideMesh.count,
      endpoints: (flows.object.getObjectByName('trace-flow:endpoints') as {
        count?: number
      } | undefined)?.count ?? 0,
    }
  })
  expect(layout.dockInsideWorld).toBe(true)
  expect(layout.controls).toHaveLength(5)
  expect(layout.controls.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  expect(layout.noHorizontalScroll).toBe(true)
  expect(layout.staticPacket).toBe(true)
  expect(layout.staticGuide).toBe(true)
  expect(layout.guide).toBeGreaterThan(0)
  expect(layout.endpoints).toBe(2)
})

test('city rendering stays within the desktop frame budget', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))

  const metrics = await page.evaluate(() => {
    const renderer = window.TICITY.world?.shell.renderer
    if (!renderer) return null
    return {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      programs: renderer.info.programs?.length ?? 0,
      pixelRatio: renderer.getPixelRatio(),
      backingPixels: renderer.domElement.width * renderer.domElement.height,
      cssPixels: renderer.domElement.clientWidth * renderer.domElement.clientHeight,
      dropped: window.TICITY.world?.shell.flows.dropped ?? 0,
    }
  })

  expect(metrics).not.toBeNull()
  if (!metrics) throw new Error('WebGL renderer did not start')
  // Broad ceilings catch multiplicative regressions without snapshotting
  // driver-specific renderer counters.
  expect(metrics.calls).toBeGreaterThan(0)
  expect(metrics.calls).toBeLessThanOrEqual(280)
  expect(metrics.triangles).toBeLessThanOrEqual(80_000)
  expect(metrics.geometries).toBeLessThanOrEqual(225)
  expect(metrics.programs).toBeLessThanOrEqual(32)
  expect(metrics.pixelRatio).toBeLessThanOrEqual(1.5)
  expect(metrics.backingPixels).toBeLessThanOrEqual(metrics.cssPixels * 2.25)
  expect(metrics.dropped).toBe(0)
})

test('SQL analysis stays local and does not retain a submitted literal', async ({ page }) => {
  const outbound: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (
      url.protocol !== 'data:' &&
      url.protocol !== 'blob:' &&
      url.hostname !== '127.0.0.1'
    ) {
      outbound.push(request.url())
    }
  })
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  const panel = page.locator('[data-action="panel"]')
  if (await panel.getAttribute('aria-expanded') === 'false') await panel.click()

  const secret = 'customer-secret-425'
  await page.locator('.tidb-sql-textarea').fill(
    `SELECT * FROM accounts WHERE note = '${secret}' AND id = 7`,
  )
  await page.locator('[data-action="analyze"]').click()
  await expect(page.locator('.tidb-sql-output')).toContainText('point_read')
  await page.locator('[data-locale="en"]').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  const retained = await page.evaluate(() => ({
    trace: JSON.stringify(window.TICITY.trace),
    storage: JSON.stringify({ ...localStorage }),
  }))
  expect(retained.trace).not.toContain(secret)
  expect(retained.storage).not.toContain(secret)
  expect(outbound).toEqual([])
})

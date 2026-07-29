// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { mountDiagnose } from '../diagnose'
import { mountMachine } from '../machine'
import { createTiDBSimulation } from '../model'
import { mountCityUi } from './index'

describe('TiDB surface model integration', () => {
  it('uses one simulation API for SQL, replay, and diagnostics', () => {
    const dom = installTestDom()
    const simulation = createTiDBSimulation({ seed: 425 })

    const city = dom.mount('city') as unknown as HTMLElement
    mountCityUi(city, { simulation })
    expect(city.querySelectorAll('[data-ui-jump]')).toHaveLength(4)
    expect(city.querySelector('[data-ui-jump="sql"]')?.getAttribute('href')).toBe('#tidb-sql-title')
    expect(city.querySelector('#tidb-controls-title')).not.toBeNull()
    expect(city.querySelector('#tidb-tour-title')).not.toBeNull()
    const sql = city.querySelector<HTMLTextAreaElement>('textarea')!
    sql.value = 'SELECT * FROM accounts WHERE id = 42'
    city.querySelector<HTMLButtonElement>('[data-action="analyze"]')!.click()
    expect(city.textContent).toContain('Point_Get')
    expect(simulation.state.lastTrace).not.toBeNull()

    const receipt = simulation.runScenario('cross-region-transaction')
    const machine = dom.mount('machine') as unknown as HTMLElement
    mountMachine(machine, { locale: 'en', receipt })
    expect(machine.querySelectorAll('[data-event-domain="txn2pc"]').length).toBeGreaterThan(0)
    expect(machine.querySelectorAll('[data-event-domain="raft"]').length).toBeGreaterThan(0)

    const diagnose = dom.mount('diagnose') as unknown as HTMLElement
    mountDiagnose(diagnose, { locale: 'en', snapshot: simulation.state })
    expect(diagnose.textContent).toContain('tikv-1')
    expect(diagnose.textContent).toContain('MODEL / SIMULATED')
  })
})

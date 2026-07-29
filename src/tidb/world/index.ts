/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import type { TiCityState, TraceReceipt } from '../model/types'
import { createCityShell } from '../engine/shell'
import type { CityShell } from '../engine/shell'
import type { CityViewMode } from '../engine/camera'
import type { CityComponent } from './city'
import type { CityTheme } from './palette'

export interface WorldOptions {
  readonly theme?: CityTheme
  readonly mode?: CityViewMode
  readonly hudExpanded?: boolean
  readonly autoStart?: boolean
  readonly onSelect?: (component: CityComponent | null) => void
}

export interface WorldHandle {
  /** Advanced integration surface; ordinary callers use the methods below. */
  readonly shell: CityShell
  update(state: TiCityState, trace?: TraceReceipt | null): void
  focus(targetId: string): boolean
  setTheme(theme: CityTheme): void
  setMode(mode: CityViewMode): void
  setHudExpanded(expanded: boolean): void
  resize(): void
  enableAudio(): Promise<boolean>
  dispose(): void
}

/**
 * Mount the standalone TiCity visual runtime.
 *
 * `update` only projects model state and TraceReceipt events. It never mutates
 * the simulation, issues SQL, or constructs a second transaction model.
 */
export function createTiDBWorld(
  container: HTMLElement,
  options: WorldOptions = {},
): WorldHandle {
  const shell = createCityShell(container, options)
  return {
    shell,
    update(state: TiCityState, trace?: TraceReceipt | null): void {
      shell.update(state, trace)
    },
    focus(targetId: string): boolean {
      return shell.focus(targetId)
    },
    setTheme(theme: CityTheme): void {
      shell.setTheme(theme)
    },
    setMode(mode: CityViewMode): void {
      shell.setMode(mode)
    },
    setHudExpanded(expanded: boolean): void {
      shell.setHudExpanded(expanded)
    },
    resize(): void {
      shell.resize()
    },
    enableAudio(): Promise<boolean> {
      return shell.audio.enable()
    },
    dispose(): void {
      shell.dispose()
    },
  }
}

export { createTiDBSceneGraph } from './city'
export type {
  CityCollider,
  CityComponent,
  CityNetwork,
  CityRegistry,
  TiDBSceneGraph,
} from './city'
export { COMPONENT_ANCHORS, DISTRICT_BOUNDS, TICITY_LAYOUT, regionPeerPosition } from './layout'
export type { CityTheme, SemanticDomain } from './palette'

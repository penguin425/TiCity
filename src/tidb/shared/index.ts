/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compatibility entry point for presentation code that treats model contracts
 * as shared state. New code may import the same contracts from ../model.
 */

export type {
  ModelPlanNode,
  RegionState,
  ReplaySpec,
  SqlAnalysis,
  TiDBCityState,
  TiDBControls,
  TiDBSimulationApi,
  TraceDomain,
  TraceEvent,
  TraceReceipt,
} from '../model/types'

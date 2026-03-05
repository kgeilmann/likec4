import type { scalar } from '@likec4/core/types'

export interface ColaNode {
  id: scalar.NodeId
  width: number
  height: number
  parent?: scalar.NodeId | null
  index: number
  x?: number
  y?: number
}

export interface ColaEdge {
  source: number
  target: number
}

export interface ColaOptions {
  linkDistance?: number
  nodeSpacing?: number
  direction?: 'TB' | 'BT' | 'LR' | 'RL'
  rankSep?: number
  nodeSep?: number
}

export interface ColaGraph {
  nodes: ColaNode[]
  edges: ColaEdge[]
  options: ColaOptions
}

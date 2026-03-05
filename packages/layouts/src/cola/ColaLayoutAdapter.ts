import {
  type AnyAux,
  type ComputedView,
  type DiagramEdge,
  type DiagramNode,
  type LikeC4Styles,
  type Point,
  _stage,
} from '@likec4/core'
import type { LayoutedView } from '@likec4/core'
import type { ComputedEdge, ComputedNode, NonEmptyArray } from '@likec4/core/types'
import { loggable, rootLogger as mainLogger } from '@likec4/log'
import * as d3 from 'd3'
import { randomString } from 'remeda'
import { d3adaptor } from 'webcola'
import type { LayoutResult, LayoutTaskParams } from '../graphviz/GraphvizLayoter'
import type { DotSource } from '../graphviz/types'
import type { ColaGraph, ColaNode } from './types'

const rootLogger = mainLogger.getChild(['cola', 'layouter'])

const isDynamicView = (view: { _type: string }) => view._type === 'dynamic'

export class ColaLayoutAdapter {
  async layout<A extends AnyAux>(params: LayoutTaskParams<A>): Promise<LayoutResult<A>> {
    const logger = rootLogger.getChild(['layout', randomString(3)])
    try {
      logger.debug`layouting view ${params.view.id} with cola...`

      const input = this.computeInput(params.view, params.styles)
      const output = await this.runCola(input)

      const diagram = this.computeDiagram(params.view, output, params.styles)

      logger.debug`layouting view ${params.view.id} done`
      return { dot: '' as DotSource, diagram }
    } catch (e) {
      logger.warn(loggable(e))
      throw e
    }
  }

  private computeInput(view: ComputedView, styles: LikeC4Styles): ColaGraph {
    const nodeMap = new Map<string, ColaNode>()

    const nodes: ColaGraph['nodes'] = view.nodes.map((node, i) => {
      const { values: { padding, sizes: { width, height } } } = styles.nodeSizes(node.style)
      var n = {
        id: node.id,
        width: width + padding,
        height: height + padding,
        parent: node.parent ?? null,
        index: i,
      }
      nodeMap.set(n.id, n)
      return n
    })

    const edges: ColaGraph['edges'] = view.edges.map((edge) => {
      const source = nodeMap.get(edge.source)
      const target = nodeMap.get(edge.target)
      if (!source || !target) {
        throw new Error(`Invalid edge from ${edge.source} to ${edge.target} found`)
      }

      return {
        source: source.index,
        target: target.index,
      }
    })

    const options: ColaGraph['options'] = {
      linkDistance: view.autoLayout.rankSep ?? 100,
      nodeSpacing: view.autoLayout.nodeSep ?? 50,
      direction: view.autoLayout.direction,
    }

    return { nodes, edges, options }
  }

  private async runCola(input: ColaGraph): Promise<ColaGraph> {
    const logger = rootLogger.getChild(['runCola', randomString(4)])

    var cola = d3adaptor(d3)
      .size([1000, 1000])
      .nodes(input.nodes)
      .links(input.edges)
      .avoidOverlaps(true)

    if (input.options.linkDistance) {
      cola.linkDistance(input.options.linkDistance!)
    }

    cola.start(30, 30, 30)

    logger.trace`cola done`

    return input
  }

  private computeDiagram<A extends AnyAux>(
    view: ComputedView<A>,
    colaOutput: ColaGraph,
    styles: LikeC4Styles,
  ): LayoutedView<A> {
    const nodes = this.computeNodes(view.nodes, colaOutput, styles)
    const edges = this.computeEdges(view.edges, nodes)
    const bounds = this.computeBounds(nodes)

    const result = {
      ...view,
      [_stage]: 'layouted' as const,
      bounds,
      nodes,
      edges,
    }

    if (isDynamicView(result)) {
      throw new Error(`ColaLayoutAdapter does not support dynamic views: ${view.id}`)
    }

    return result as LayoutedView<A>
  }

  private computeNodes(
    computedNodes: readonly ComputedNode[],
    colaOutput: ColaGraph,
    styles: LikeC4Styles,
  ): DiagramNode[] {
    const nodeMap = new Map(colaOutput.nodes.map(n => [n.id, n] as const))

    return computedNodes.map(node => {
      const colaNode = nodeMap.get(node.id)
      if (!colaNode || !colaNode.x || !colaNode.y) {
        throw new Error(`No valid Node with id ${node.id} found after cola layout`)
      }

      const { values: { sizes, padding } } = styles.nodeSizes(node.style)
      const width = sizes.width
      const height = sizes.height

      const labelBBox = {
        x: colaNode.x + padding,
        y: colaNode.y + padding,
        width: width - padding * 2,
        height: height - padding * 2,
      }

      return {
        ...node,
        x: colaNode.x,
        y: colaNode.y,
        width,
        height,
        labelBBox,
      }
    })
  }

  private computeEdges(
    computedEdges: readonly ComputedEdge[],
    nodes: DiagramNode[],
  ): DiagramEdge[] {
    const nodeMap = new Map(nodes.map(n => [n.id, n] as const))

    return computedEdges.map(edge => {
      const sourceNode = nodeMap.get(edge.source)
      const targetNode = nodeMap.get(edge.target)

      if (!sourceNode || !targetNode) {
        throw new Error(`Edge ${edge.id}: source or target node not found`)
      }

      const points = this.calculateEdgePoints(sourceNode, targetNode)

      return {
        ...edge,
        points,
      }
    })
  }

  private calculateEdgePoints(source: DiagramNode, target: DiagramNode): NonEmptyArray<Point> {
    const sx = source.x + source.width / 2
    const sy = source.y + source.height / 2
    const tx = target.x + target.width / 2
    const ty = target.y + target.height / 2

    const dx = tx - sx
    const dy = ty - sy

    const sourceRight = source.x + source.width
    const sourceBottom = source.y + source.height
    const targetRight = target.x + target.width
    const targetBottom = target.y + target.height

    let startX: number
    let startY: number
    let endX: number
    let endY: number

    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) {
        startX = sourceRight
        startY = sy
        endX = target.x
        endY = ty
      } else {
        startX = source.x
        startY = sy
        endX = targetRight
        endY = ty
      }
    } else {
      if (dy > 0) {
        startX = sx
        startY = sourceBottom
        endX = tx
        endY = target.y
      } else {
        startX = sx
        startY = source.y
        endX = tx
        endY = targetBottom
      }
    }

    const midX = (startX + endX) / 2
    const midY = (startY + endY) / 2

    const controlOffset = Math.min(Math.abs(endX - startX), Math.abs(endY - startY)) / 3

    return [
      [startX, startY],
      [startX, startY],
      // [startX + controlOffset, startY],
      // [endX - controlOffset, endY],
      [endX, endY],
      [endX, endY],
    ]
  }

  private computeBounds(nodes: DiagramNode[]): { x: number; y: number; width: number; height: number } {
    if (nodes.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 }
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const node of nodes) {
      minX = Math.min(minX, node.x)
      minY = Math.min(minY, node.y)
      maxX = Math.max(maxX, node.x + node.width)
      maxY = Math.max(maxY, node.y + node.height)
    }

    return {
      x: Math.round(minX),
      y: Math.round(minY),
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY),
    }
  }
}

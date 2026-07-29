// SPDX-License-Identifier: Apache-2.0

export type Child = Node | string | null | undefined | false

export interface ElementProps {
  className?: string
  text?: string
  attrs?: Record<string, string>
}

function setAttributeWithDataset(node: Element, name: string, value: string): void {
  node.setAttribute(name, value)
  if (!name.startsWith('data-')) return
  const key = name
    .slice(5)
    .replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
  ;(node as HTMLElement | SVGElement).dataset[key] = value
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props.className) node.className = props.className
  if (props.text != null) node.textContent = props.text
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    setAttributeWithDataset(node, name, value)
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

export function installStyle(id: string, css: string, doc: Document = document): void {
  if (doc.getElementById(id)) return
  const style = doc.createElement('style')
  style.id = id
  style.textContent = css
  doc.documentElement.append(style)
}

export function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [name, value] of Object.entries(attrs)) setAttributeWithDataset(node, name, value)
  return node
}

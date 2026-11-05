type RecordValue = Record<string, any>;
export interface SelectionRect { left: number; top: number; width: number; height: number }

export function getAxureSelectionRoots(elements: readonly Element[]): Element[] {
  const unique = [...new Set(elements)];
  return unique.filter((element) => !unique.some((parent) => parent !== element && parent.contains(element)))
    .sort(comparePaintOrder);
}

function createsStackingContext(element: Element): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return Boolean(style && ((style.zIndex !== 'auto' && style.zIndex !== '' &&
    (style.position !== 'static' || /flex|grid/u.test(element.parentElement ? element.ownerDocument.defaultView?.getComputedStyle(element.parentElement).display || '' : '')))
    || Number(style.opacity || 1) < 1 || (style.transform && style.transform !== 'none')
    || (style.filter && style.filter !== 'none') || style.isolation === 'isolate'
    || style.position === 'fixed' || style.position === 'sticky'));
}

function paintStage(element: Element): number {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return 1;
  const z = createsStackingContext(element) ? Number.parseInt(style.zIndex, 10) || 0 : 0;
  if (z < 0) return 0;
  if (z > 0) return 5;
  if (createsStackingContext(element) || (style.position && style.position !== 'static')) return 4;
  if (style.float && style.float !== 'none') return 2;
  if (style.display.startsWith('inline')) return 3;
  return element.parentElement && !createsStackingContext(element.parentElement)
    ? Math.max(1, paintStage(element.parentElement)) : 1;
}

/** Refuse cross-root interleaving rather than flattening it into a different visual result. */
export function assertMergeableSelection(roots: readonly Element[]): void {
  if (roots.length < 2) return;
  function overlaps(a: SelectionRect, b: SelectionRect) {
    return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
  }
  for (const root of roots) {
    if (createsStackingContext(root)) continue;
    const descendants = Array.from(root.querySelectorAll?.('*') || []).filter((node) => {
      const style = node.ownerDocument.defaultView?.getComputedStyle(node);
      return createsStackingContext(node) || (style?.position && style.position !== 'static') || (style?.float && style.float !== 'none');
    });
    if (descendants.some((child) => roots.some((other) => other !== root && overlaps(child.getBoundingClientRect(), other.getBoundingClientRect())))) {
      throw new Error('选区包含跨容器交错层叠，请选择共同容器或分别导出这些元素。');
    }
  }
}

/** Compare stacking contexts before DOM order, independent of Command-click order. */
function comparePaintOrder(a: Element, b: Element): number {
  function path(element: Element): Element[] {
    const contexts = [element];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (createsStackingContext(parent)) contexts.unshift(parent);
    }
    return contexts;
  }
  const aPath = path(a), bPath = path(b);
  let index = 0;
  while (index < aPath.length - 1 && index < bPath.length - 1 && aPath[index] === bPath[index]) index++;
  const first = aPath[index], second = bPath[index];
  const z = (element: Element) => createsStackingContext(element)
    ? Number.parseInt(element.ownerDocument.defaultView?.getComputedStyle(element).zIndex || '0', 10) || 0 : 0;
  return paintStage(first) - paintStage(second) || z(first) - z(second) || (first.compareDocumentPosition(second) & 4 ? -1 : 1);
}

export function readSelectionRect(element: Element): SelectionRect {
  const { left, top, width, height } = element.getBoundingClientRect();
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('选中元素不可见或尺寸无效，请重新选择。');
  }
  return { left, top, width, height };
}

/** htmlToAxure uses root-relative coordinates at every scene/maskedScene depth. */
export function mergeAxureSelectionPayloads(captures: Array<{ payload: unknown; rect: SelectionRect }>): unknown {
  const parsed = captures.map(({ payload, rect }) => {
    const value = payload as RecordValue;
    const board = value?.scene?.items?.[0];
    if (value?.scene?.items?.length !== 1 || board?.itemType !== 2 || !Array.isArray(board.scene?.items)) {
      throw new Error('选区采集数据无效，请重新选择后重试。');
    }
    return { value, board, rect };
  });
  if (!parsed.length) throw new Error('当前没有可导出的元素。');
  const left = Math.min(...parsed.map(({ board }) => board.rect.location.x));
  const top = Math.min(...parsed.map(({ board }) => board.rect.location.y));
  const right = Math.max(...parsed.map(({ board, rect }) => board.rect.location.x + rect.width));
  const bottom = Math.max(...parsed.map(({ board, rect }) => board.rect.location.y + rect.height));
  const size = { width: right - left, height: bottom - top };
  const result = structuredClone(parsed[0].value);
  result.imageMap = {};
  result.masters = {};
  const board = structuredClone(parsed[0].board);
  board.id = 'selection-page'; board.name = `选中元素（${parsed.length} 个根节点）`;
  board.rect = { location: { x: 0, y: 0 }, size };
  if (board.backgroundFill) board.backgroundFill.enabled = false;
  if (board.backgroundShape) {
    board.backgroundShape.id = 'selection-background';
    board.backgroundShape.rect = { location: { x: 0, y: 0 }, size: { ...size } };
    board.backgroundShape.backgroundFills = (board.backgroundShape.backgroundFills || []).map((fill: RecordValue) => ({ ...fill, enabled: false }));
  }
  board.scene = { items: [] };
  for (const [index, capture] of parsed.entries()) {
    for (const key of ['imageMap', 'masters']) {
      for (const [id, asset] of Object.entries(capture.value[key] || {})) {
        if (Object.hasOwn(result[key], id) && JSON.stringify(result[key][id]) !== JSON.stringify(asset)) {
          throw new Error('选区资源标识冲突，请分别导出或重试。');
        }
        Object.defineProperty(result[key], id, { value: structuredClone(asset), enumerable: true, configurable: true, writable: true });
      }
    }
    let counter = 0;
    const dx = capture.board.rect.location.x - left, dy = capture.board.rect.location.y - top;
    function move(node: RecordValue): void {
      node.id = `selection-${index}-${counter++}`;
      if (node.rect?.location) {
        node.rect.location.x += dx; node.rect.location.y += dy;
      }
      for (const child of [...(node.scene?.items || []), ...(node.maskedScene?.items || [])]) move(child);
      if (node.backgroundShape) move(node.backgroundShape);
    }
    const items = structuredClone(capture.board.scene.items) as RecordValue[];
    items.forEach(move);
    board.scene.items.push(...items);
  }
  result.scene = { items: [board] };
  return result;
}

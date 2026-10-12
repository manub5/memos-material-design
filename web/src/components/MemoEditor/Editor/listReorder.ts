import { type ChangeSpec, EditorSelection } from "@codemirror/state";
import type { List, ListItem, Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export interface ListReorderItem {
  /** Full source line start, including indentation. */
  from: number;
  to: number;
  listFrom: number;
  index: number;
}

interface ListGroup {
  items: ListReorderItem[];
  signatures: string[];
  node: List;
  root: Root;
}

function signature(item: ListItem | Root, permutation?: { node: List; children: ListItem[] }): string {
  // Positions and the ordered-list start are source metadata, not item content.
  return JSON.stringify(item, (key, value) => {
    if (key === "position" || key === "start") return undefined;
    if (permutation && value === permutation.node) return { ...value, children: permutation.children };
    return value;
  });
}

function groups(source: string): ListGroup[] {
  const result: ListGroup[] = [];
  const root = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const visit = (node: RootContent | typeof root): void => {
    // Code and quotes are opaque even when their text looks like a list.
    if (node.type === "blockquote" || node.type === "code" || node.type === "html") return;
    if (node.type === "list") {
      const list: List = node;
      const items: ListReorderItem[] = [];
      for (const [index, item] of list.children.entries()) {
        const start = item.position?.start.offset;
        const to = item.position?.end.offset;
        if (start === undefined || to === undefined || item.children.length === 0) return;
        const from = source.lastIndexOf("\n", start - 1) + 1;
        // A structural item must begin on its own line with only indentation.
        if (!/^[ \t]*$/.test(source.slice(from, start))) return;
        const spelling = source.slice(start, to);
        if (!/^(?:[-+*]|\d{1,9}[.)])[ \t]+\S/.test(spelling)) return;
        let safe = true;
        const check = (child: RootContent): void => {
          if (child.type === "code") {
            const text = source.slice(child.position?.start.offset, child.position?.end.offset);
            const fence = /^(?:`{3,}|~{3,})/.exec(text)?.[0];
            if (fence) {
              const lines = text.split(/\r?\n/);
              const closing = lines.at(-1)?.trim() ?? "";
              const closingFence = /^(`{3,}|~{3,})[ \t]*$/.exec(closing)?.[1];
              if (lines.length < 2 || !closingFence || closingFence[0] !== fence[0] || closingFence.length < fence.length) safe = false;
            }
          }
          if ("children" in child) child.children.forEach((nested) => check(nested as RootContent));
        };
        item.children.forEach(check);
        if (!safe) return;
        items.push({ from, to, listFrom: list.position?.start.offset ?? start, index });
      }
      // Separators belong to slots, not to items. This retains terminal newlines,
      // blank lines, CRLF, and loose-list spacing without merging final entries.
      if (items.some((item, index) => index > 0 && !/^[ \t\r\n]+$/.test(source.slice(items[index - 1].to, item.from)))) return;
      if (items.length > 1) result.push({ items, signatures: list.children.map((item) => signature(item)), node: list, root });
    }
    if ("children" in node) node.children.forEach((child) => visit(child as RootContent));
  };
  visit(root);
  return result;
}

/** Identify safe list siblings using the existing CommonMark/GFM source parser. */
export function identifyListItems(source: string): ListReorderItem[] {
  return groups(source)
    .flatMap((group) => group.items)
    .sort((a, b) => a.from - b.from);
}

export interface ListReorderChange {
  from: number;
  to: number;
  insert: string;
  positionMap?: { from: number; to: number; newFrom: number; kind: "block" | "separator" }[];
}

export interface ListReorderIndex {
  readonly source: string;
  readonly items: readonly ListReorderItem[];
  validate: (from: number, target: number, side: "before" | "after") => ListReorderChange | null;
}

/** Parse an immutable document once; subsequent destination checks reuse its source AST. */
export function createListReorderIndex(source: string): ListReorderIndex {
  const parsed = groups(source);
  return {
    source,
    items: parsed.flatMap((group) => group.items).sort((a, b) => a.from - b.from),
    validate: (from, target, side) => validateMove(source, parsed, from, target, side),
  };
}

function validateMove(
  source: string,
  parsed: ListGroup[],
  from: number,
  target: number,
  side: "before" | "after",
): ListReorderChange | null {
  const group = parsed.find((candidate) => candidate.items.some((item) => item.from === from));
  if (!group || from === target) return null;
  const sourceIndex = group.items.findIndex((item) => item.from === from);
  const targetIndex = group.items.findIndex((item) => item.from === target);
  if (targetIndex < 0) return null;
  const order = group.items.map((_, index) => index);
  order.splice(sourceIndex, 1);
  order.splice(order.indexOf(targetIndex) + (side === "after" ? 1 : 0), 0, sourceIndex);
  if (order.every((index, slot) => index === slot)) return null;
  const first = group.items[0];
  const last = group.items.at(-1)!;
  const positionMap: NonNullable<ListReorderChange["positionMap"]> = [];
  let newFrom = first.from;
  const insert = order
    .map((index, slot) => {
      const item = group.items[index];
      const separator = slot < order.length - 1 ? source.slice(group.items[slot].to, group.items[slot + 1].from) : "";
      positionMap.push({ from: item.from, to: item.to, newFrom, kind: "block" });
      newFrom += item.to - item.from;
      if (separator) positionMap.push({ from: group.items[slot].to, to: group.items[slot + 1].from, newFrom, kind: "separator" });
      newFrom += separator.length;
      return source.slice(item.from, item.to) + separator;
    })
    .join("");
  const candidate = source.slice(0, first.from) + insert + source.slice(last.to);
  const reparsed = groups(candidate);
  const moved = reparsed.find((entry) => entry.items[0].from === first.from);
  if (!moved || moved.items.length !== order.length || moved.signatures.some((value, slot) => value !== group.signatures[order[slot]]))
    return null;
  // Compare the entire document AST with only the intended sibling permutation.
  // Parent moves can legitimately permute nested groups of different sizes.
  const children = order.map((index) => group.node.children[index]);
  if (signature(group.root, { node: group.node, children }) !== signature(moved.root)) return null;
  const change = { from: first.from, to: last.to, insert } satisfies ChangeSpec;
  return { ...change, positionMap };
}

/** Return one safe replacement. Preview may reuse an index; drop should validate with a fresh index. */
export function reorderListItem(
  source: string,
  from: number,
  target: number,
  side: "before" | "after",
  index?: ListReorderIndex,
): ListReorderChange | null {
  return (index?.source === source ? index : createListReorderIndex(source)).validate(from, target, side);
}

/**
 * Remap every anchor/head by its original source block, including block endpoints.
 * Separator interiors retain their slot and relative offset; external positions
 * remain unchanged because a permutation keeps the replacement's total length.
 * Independently mapped endpoints retain non-empty selections even across blocks.
 */
export function remapListReorderSelection(selection: EditorSelection, change: ListReorderChange): EditorSelection {
  const mapPosition = (pos: number): number => {
    const entries = change.positionMap ?? [];
    const block = entries.find((entry) => entry.kind === "block" && pos >= entry.from && pos <= entry.to);
    const separator = block ?? entries.find((entry) => entry.kind === "separator" && pos > entry.from && pos < entry.to);
    return separator ? separator.newFrom + pos - separator.from : pos;
  };
  return EditorSelection.create(
    selection.ranges.map((range) =>
      EditorSelection.range(
        mapPosition(range.anchor),
        mapPosition(range.head),
        range.goalColumn,
        range.bidiLevel ?? undefined,
        range.assoc,
      ),
    ),
    selection.mainIndex,
  );
}

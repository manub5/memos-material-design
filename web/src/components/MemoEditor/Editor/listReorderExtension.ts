import { isolateHistory } from "@codemirror/commands";
import { EditorState, type Extension, Text, Transaction } from "@codemirror/state";
import { EditorView, GutterMarker, gutter, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  createListReorderIndex,
  type ListReorderIndex,
  type ListReorderItem,
  remapListReorderSelection,
  reorderListItem,
} from "./listReorder";

export interface ListReorderLabels {
  handle: () => string;
  target: () => string;
}

const cache = new WeakMap<Text, ListReorderIndex>();
function index(state: EditorState): ListReorderIndex {
  let value = cache.get(state.doc);
  if (!value) {
    value = createListReorderIndex(state.doc.toString());
    cache.set(state.doc, value);
  }
  return value;
}
function items(state: EditorState): readonly ListReorderItem[] {
  return index(state).items;
}
function editable(view: EditorView): boolean {
  return !view.state.readOnly && view.state.facet(EditorView.editable);
}

class Handle extends GutterMarker {
  constructor(
    readonly from: number,
    readonly labels: ListReorderLabels,
  ) {
    super();
  }
  eq(other: Handle) {
    return this.from === other.from && this.labels === other.labels;
  }
  toDOM(view: EditorView) {
    const button = view.dom.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "cm-list-reorder-handle";
    button.dataset.listFrom = String(this.from);
    button.setAttribute("aria-label", this.labels.handle());
    button.setAttribute("aria-pressed", "false");
    button.title = this.labels.handle();
    button.textContent = "⠿";
    button.style.touchAction = "none";
    return button;
  }
}

/** Dedicated gutter handles: document mutations only happen once on a valid drop. */
export function listReorderExtension(labels: ListReorderLabels): Extension {
  return [
    gutter({
      class: "cm-list-reorder-gutter",
      lineMarker(view, line) {
        if (!editable(view)) return null;
        const item = items(view.state).find((entry) => entry.from === line.from);
        return item ? new Handle(item.from, labels) : null;
      },
      lineMarkerChange: (update) =>
        update.docChanged ||
        update.startState.readOnly !== update.state.readOnly ||
        update.startState.facet(EditorView.editable) !== update.state.facet(EditorView.editable),
    }),
    ViewPlugin.fromClass(
      class {
        drag: {
          handle: HTMLButtonElement;
          id: number;
          from: number;
          x: number;
          y: number;
          active: boolean;
          state: EditorState;
          index: ListReorderIndex;
          validated: Map<string, boolean>;
        } | null = null;
        destination: { from: number; side: "before" | "after" } | null = null;
        indicator: HTMLDivElement;
        frame = 0;
        lastY = 0;
        constructor(readonly view: EditorView) {
          this.indicator = view.dom.ownerDocument.createElement("div");
          this.indicator.className = "cm-list-reorder-target";
          this.indicator.setAttribute("role", "status");
          view.dom.addEventListener("pointerdown", this.down);
        }
        down = (event: PointerEvent) => {
          const handle = (event.target as Element).closest<HTMLButtonElement>(".cm-list-reorder-handle");
          if (!handle || !editable(this.view) || event.button !== 0 || event.isPrimary === false || this.drag) return;
          const from = Number(handle.dataset.listFrom);
          if (!items(this.view.state).some((entry) => entry.from === from)) return;
          event.preventDefault();
          this.drag = {
            handle,
            id: event.pointerId,
            from,
            x: event.clientX,
            y: event.clientY,
            active: false,
            state: this.view.state,
            index: index(this.view.state),
            validated: new Map(),
          };
          try {
            handle.setPointerCapture(event.pointerId);
          } catch {
            this.cancel();
            return;
          }
          const doc = this.view.dom.ownerDocument;
          doc.addEventListener("pointermove", this.move);
          doc.addEventListener("pointerup", this.up);
          doc.addEventListener("pointercancel", this.pointerCancel);
          doc.addEventListener("keydown", this.key, true);
          handle.addEventListener("lostpointercapture", this.pointerCancel);
        };
        move = (event: PointerEvent) => {
          const drag = this.drag;
          if (!drag || event.pointerId !== drag.id) return;
          event.preventDefault();
          this.lastY = event.clientY;
          if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
          drag.active = true;
          drag.handle.setAttribute("aria-pressed", "true");
          this.measureTarget();
          if (!this.frame) this.frame = requestAnimationFrame(this.scroll);
        };
        measureTarget() {
          const drag = this.drag;
          if (!drag) return;
          const source = items(drag.state).find((entry) => entry.from === drag.from);
          const group = items(drag.state).filter((entry) => entry.listFrom === source?.listFrom);
          // CodeMirror virtualizes long documents. Boundary lines need not be
          // rendered; measured/estimated block geometry still bounds the list.
          const bounds = (pos: number) => {
            const coords = this.view.coordsAtPos(pos);
            if (coords) return coords;
            const block = this.view.lineBlockAt(pos);
            return { top: this.view.documentTop + block.top, bottom: this.view.documentTop + block.bottom };
          };
          const groupStart = group[0] && bounds(group[0].from);
          const groupEnd = group.at(-1) && bounds(group.at(-1)!.to);
          const margin = groupStart ? (groupStart.bottom - groupStart.top) / 2 : 0;
          if (!groupStart || !groupEnd || this.lastY < groupStart.top - margin || this.lastY > groupEnd.bottom + margin) {
            this.destination = null;
            this.indicator.remove();
            return;
          }
          // A hit on the source subtree or another list is not a sibling target.
          // Do not silently snap those drops back into the source list.
          const hovered = items(drag.state)
            .filter((entry) => {
              const start = bounds(entry.from);
              const end = bounds(entry.to);
              return start && end && this.lastY >= start.top && this.lastY <= end.bottom;
            })
            .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
          const sourceStart = source && bounds(source.from);
          const sourceEnd = source && bounds(source.to);
          if (
            (hovered && hovered.listFrom !== source?.listFrom) ||
            (sourceStart && sourceEnd && this.lastY >= sourceStart.top && this.lastY <= sourceEnd.bottom)
          ) {
            this.destination = null;
            this.indicator.remove();
            return;
          }
          const siblings = items(drag.state).filter((entry) => entry.listFrom === source?.listFrom && entry.from !== drag.from);
          let closest: { item: ListReorderItem; top: number; bottom: number; distance: number } | null = null;
          for (const item of siblings) {
            const start = bounds(item.from);
            const end = bounds(item.to);
            const distance = Math.min(Math.abs(this.lastY - start.top), Math.abs(this.lastY - end.bottom));
            if (!closest || distance < closest.distance) closest = { item, top: start.top, bottom: end.bottom, distance };
          }
          if (!closest) {
            this.destination = null;
            this.indicator.remove();
            return;
          }
          const side = this.lastY < (closest.top + closest.bottom) / 2 ? "before" : "after";
          this.destination = { from: closest.item.from, side };
          const key = `${closest.item.from}:${side}`;
          if (!drag.validated.has(key)) {
            drag.validated.set(key, !!reorderListItem(drag.index.source, drag.from, closest.item.from, side, drag.index));
          }
          if (!drag.validated.get(key)) {
            this.destination = null;
            this.indicator.remove();
            return;
          }
          this.indicator.textContent = labels.target();
          this.indicator.style.top = `${(side === "before" ? closest.top : closest.bottom) - this.view.dom.getBoundingClientRect().top}px`;
          if (!this.indicator.isConnected) this.view.dom.append(this.indicator);
        }
        scroll = () => {
          this.frame = 0;
          if (!this.drag?.active) return;
          const scroller = this.view.scrollDOM;
          const rect = scroller.getBoundingClientRect();
          const edge = Math.min(40, rect.height / 4);
          const velocity =
            this.lastY < rect.top + edge
              ? -Math.min(16, (rect.top + edge - this.lastY) / 2)
              : this.lastY > rect.bottom - edge
                ? Math.min(16, (this.lastY - rect.bottom + edge) / 2)
                : 0;
          if (velocity) {
            scroller.scrollTop += velocity;
            this.measureTarget();
          }
          this.frame = requestAnimationFrame(this.scroll);
        };
        up = (event: PointerEvent) => {
          const drag = this.drag;
          if (!drag || event.pointerId !== drag.id) return;
          const destination = this.destination;
          const change =
            drag.active && destination && editable(this.view) && this.view.state.doc === drag.state.doc
              ? reorderListItem(drag.state.doc.toString(), drag.from, destination.from, destination.side)
              : null;
          this.cancel();
          if (change)
            this.view.dispatch({
              // The operation uses CM's canonical LF offsets. A Text insertion
              // also works when the state's serialized separator is CRLF.
              changes: { ...change, insert: Text.of(change.insert.split("\n")) },
              selection: remapListReorderSelection(this.view.state.selection, change),
              annotations: [Transaction.userEvent.of("move.list"), isolateHistory.of("full")],
            });
        };
        pointerCancel = (event: PointerEvent) => {
          if (event.pointerId === this.drag?.id) this.cancel();
        };
        key = (event: KeyboardEvent) => {
          if (event.key === "Escape" && this.drag) {
            event.preventDefault();
            event.stopPropagation();
            this.cancel();
          }
        };
        cancel() {
          const drag = this.drag;
          this.drag = null;
          this.destination = null;
          this.indicator.remove();
          cancelAnimationFrame(this.frame);
          this.frame = 0;
          const doc = this.view.dom.ownerDocument;
          doc.removeEventListener("pointermove", this.move);
          doc.removeEventListener("pointerup", this.up);
          doc.removeEventListener("pointercancel", this.pointerCancel);
          doc.removeEventListener("keydown", this.key, true);
          if (drag) {
            drag.handle.removeEventListener("lostpointercapture", this.pointerCancel);
            drag.handle.setAttribute("aria-pressed", "false");
            try {
              drag.handle.releasePointerCapture(drag.id);
            } catch {
              /* Capture may already have been released by the browser. */
            }
          }
        }
        update(update: ViewUpdate) {
          if (update.docChanged || !editable(this.view)) this.cancel();
        }
        destroy() {
          this.cancel();
          this.view.dom.removeEventListener("pointerdown", this.down);
        }
      },
    ),
  ];
}

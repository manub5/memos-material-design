import { undo } from "@codemirror/commands";
import { Compartment, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEditorExtensions } from "@/components/MemoEditor/Editor/extensions";
import * as listReorder from "@/components/MemoEditor/Editor/listReorder";

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((view) => view.destroy()));
function setup(readOnly = false, lineSeparator?: string) {
  const onChange = vi.fn();
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: ["- a", "- b", "- c"].join(lineSeparator ?? "\n"),
      extensions: [
        ...buildEditorExtensions({
          placeholder: "",
          onChange,
          onFiles: () => {},
          onUpdate: () => {},
          onSubmit: () => {},
          getTags: () => [],
          listReorderLabels: { handle: () => "Move list item", target: () => "Drop here" },
        }),
        EditorState.readOnly.of(readOnly),
        ...(lineSeparator ? [EditorState.lineSeparator.of(lineSeparator)] : []),
      ],
    }),
  });
  views.push(view);
  vi.spyOn(view, "coordsAtPos").mockImplementation((pos) => ({
    left: 50,
    right: 100,
    top: view.state.doc.lineAt(pos).number * 30,
    bottom: view.state.doc.lineAt(pos).number * 30 + 20,
  }));
  vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue({
    top: 0,
    bottom: 200,
    left: 0,
    right: 300,
    width: 300,
    height: 200,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
  return { view, onChange };
}
function pointer(target: EventTarget, type: string, y: number, pointerType = "mouse") {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 7, pointerType, button: 0, isPrimary: true, clientX: 20, clientY: y });
  target.dispatchEvent(event);
  return event;
}
function start(view: EditorView, type = "mouse", from = 0) {
  const handle = view.dom.querySelector<HTMLButtonElement>(`.cm-list-reorder-handle[data-list-from="${from}"]`)!;
  expect(handle).not.toBeNull();
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  pointer(handle, "pointerdown", view.state.doc.lineAt(from).number * 30 + 10, type);
  return handle;
}
describe("CodeMirror list pointer handles", () => {
  it.each([
    [3, 3, 11, 11],
    [7, 7, 3, 3],
    [2, 3, 10, 11],
    [7, 2, 3, 10],
  ])("remaps anchor/head %i/%i into the same blocks and restores them on undo", (anchor, head, expectedAnchor, expectedHead) => {
    const { view } = setup();
    view.dispatch({ selection: { anchor, head } });
    const handle = start(view);
    pointer(handle, "pointermove", 115);
    pointer(handle, "pointerup", 115);
    expect(view.state.selection.main.anchor).toBe(expectedAnchor);
    expect(view.state.selection.main.head).toBe(expectedHead);
    expect(view.state.selection.main.empty).toBe(anchor === head);
    undo(view);
    expect(view.state.selection.main.anchor).toBe(anchor);
    expect(view.state.selection.main.head).toBe(head);
  });

  it("keeps a cursor inside a separator in its original slot after differently sized blocks move", () => {
    const { view } = setup();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "- alpha\n\n- b\n\n- charlie" } });
    view.dispatch({ selection: { anchor: 8 } });
    const handle = start(view);
    pointer(handle, "pointermove", 175);
    pointer(handle, "pointerup", 175);
    expect(view.state.doc.toString()).toBe("- b\n\n- charlie\n\n- alpha");
    expect(view.state.selection.main.head).toBe(4);
    undo(view);
    expect(view.state.selection.main.head).toBe(8);
  });

  it("validates each destination once across repeated pointer/scroll frames, and revalidates on drop", () => {
    const { view } = setup();
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 120, height: 120 } as DOMRect);
    const validate = vi.spyOn(listReorder, "reorderListItem");
    const handle = start(view);
    for (let i = 0; i < 12; i++) {
      pointer(handle, "pointermove", 115);
      frames.shift()!(i * 16);
    }
    expect(validate).toHaveBeenCalledTimes(1);
    pointer(handle, "pointermove", 85);
    expect(validate).toHaveBeenCalledTimes(2);
    pointer(handle, "pointermove", 115);
    expect(validate).toHaveBeenCalledTimes(2);
    pointer(handle, "pointerup", 115);
    expect(validate).toHaveBeenCalledTimes(3);
    expect(view.state.doc.toString()).toBe("- b\n- c\n- a");
  });

  it.each(["before", "after"])("targets a large nested candidate %s despite its virtualized end", (side) => {
    const { view, onChange } = setup();
    const block = "- parent\n  - child one\n  - child two\n\n  continuation";
    const doc = side === "after" ? `- source\n${block}` : `${block}\n- source`;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
    onChange.mockClear();
    const handle = start(view, "mouse", side === "after" ? 0 : block.length + 1);
    vi.spyOn(view, "coordsAtPos").mockImplementation((pos) =>
      pos === (side === "after" ? doc.length : block.length)
        ? null
        : { left: 50, right: 100, top: view.state.doc.lineAt(pos).number * 30, bottom: view.state.doc.lineAt(pos).number * 30 + 20 },
    );
    vi.spyOn(view, "lineBlockAt").mockImplementation(
      (pos) =>
        ({
          top: view.state.doc.lineAt(pos).number * 30 - view.documentTop,
          bottom: view.state.doc.lineAt(pos).number * 30 + 20 - view.documentTop,
        }) as ReturnType<EditorView["lineBlockAt"]>,
    );
    const y = side === "after" ? 205 : 32;
    pointer(handle, "pointermove", y);
    pointer(handle, "pointerup", y);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe(side === "after" ? `${block}\n- source` : `- source\n${block}`);
    undo(view);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("does not snap a hit inside a virtualized source subtree onto another sibling", () => {
    const { view, onChange } = setup();
    const doc = "- parent\n  - one\n  - two\n\n  continuation\n- other";
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
    onChange.mockClear();
    const handle = start(view);
    const end = doc.indexOf("\n- other");
    vi.spyOn(view, "coordsAtPos").mockImplementation((pos) =>
      pos === end
        ? null
        : { left: 50, right: 100, top: view.state.doc.lineAt(pos).number * 30, bottom: view.state.doc.lineAt(pos).number * 30 + 20 },
    );
    vi.spyOn(view, "lineBlockAt").mockImplementation(
      (pos) =>
        ({
          top: view.state.doc.lineAt(pos).number * 30 - view.documentTop,
          bottom: view.state.doc.lineAt(pos).number * 30 + 20 - view.documentTop,
        }) as ReturnType<EditorView["lineBlockAt"]>,
    );
    pointer(handle, "pointermove", 142);
    pointer(handle, "pointerup", 142);
    expect(onChange).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe(doc);
  });
  it("preserves CodeMirror CRLF serialization and line structure through drop and undo", () => {
    const { view } = setup(false, "\r\n");
    const handle = start(view);
    pointer(handle, "pointermove", 115);
    pointer(handle, "pointerup", 115);
    expect(view.state.doc.lines).toBe(3);
    expect(view.state.sliceDoc()).toBe("- b\r\n- c\r\n- a");
    undo(view);
    expect(view.state.sliceDoc()).toBe("- a\r\n- b\r\n- c");
  });
  it.each(["mouse", "touch"])("commits one %s drop through onChange and one undo", (type) => {
    const { view, onChange } = setup();
    const handle = start(view, type);
    expect(handle.style.touchAction).toBe("none");
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    pointer(handle, "pointermove", 115, type);
    expect(onChange).not.toHaveBeenCalled();
    expect(view.dom.querySelector(".cm-list-reorder-target")?.textContent).toBe("Drop here");
    pointer(handle, "pointerup", 115, type);
    expect(view.state.doc.toString()).toBe("- b\n- c\n- a");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("- b\n- c\n- a");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- a\n- b\n- c");
    expect(undo(view)).toBe(false);
  });
  it.each(["Escape", "pointercancel", "edit", "destroy", "lostpointercapture"])("cancels safely on %s", (reason) => {
    const { view, onChange } = setup();
    const handle = start(view, "touch");
    pointer(handle, "pointermove", 115, "touch");
    if (reason === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    else if (reason === "edit") view.dispatch({ changes: { from: 0, insert: "x" } });
    else if (reason === "destroy") {
      view.destroy();
      views.splice(views.indexOf(view), 1);
    } else pointer(handle, reason, 115);
    pointer(handle, "pointerup", 115);
    expect(onChange).toHaveBeenCalledTimes(reason === "edit" ? 1 : 0);
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(view.dom.querySelector(".cm-list-reorder-target")).toBeNull();
  });
  it("does not intercept content gestures or a below-threshold handle click", () => {
    const { view, onChange } = setup();
    expect(pointer(view.contentDOM, "pointerdown", 40).defaultPrevented).toBe(false);
    const handle = start(view);
    pointer(handle, "pointermove", 42);
    pointer(handle, "pointerup", 42);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("hides handles in read-only editors and non-list syntax", () => {
    const { view } = setup(true);
    expect(view.dom.querySelector(".cm-list-reorder-handle")).toBeNull();
    const editable = setup().view;
    editable.dispatch({ changes: { from: 0, to: editable.state.doc.length, insert: "> - quoted\n\n```\n- code\n```\n\nprose" } });
    expect(editable.dom.querySelector(".cm-list-reorder-handle")).toBeNull();
  });

  it("does not redirect a drop over another list into the source list", () => {
    const { view, onChange } = setup();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "- a\n- b\n\nprose\n\n- c\n- d" } });
    onChange.mockClear();
    const handle = start(view);
    pointer(handle, "pointermove", 190);
    pointer(handle, "pointerup", 190);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not redirect a drop on ordinary prose", () => {
    const { view, onChange } = setup();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "- a\n- b\n\nprose" } });
    onChange.mockClear();
    const handle = start(view);
    pointer(handle, "pointermove", 130);
    pointer(handle, "pointerup", 130);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects dropping a parent into its descendant", () => {
    const { view, onChange } = setup();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "- parent\n  - one\n  - two\n- other" } });
    onChange.mockClear();
    const handle = start(view);
    pointer(handle, "pointermove", 75);
    pointer(handle, "pointerup", 75);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    "1. [x] parent\n   - child\n2. [ ] other\n",
    "- [x] parent\r\n  - child\r\n- [ ] other\r\n",
  ])("moves whole task/ordered blocks in a real editor and isolates undo: %j", (doc) => {
    const { view, onChange } = setup();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
    const before = view.state.doc.toString();
    onChange.mockClear();
    const handle = start(view, "touch");
    pointer(handle, "pointermove", 115, "touch");
    pointer(handle, "pointerup", 115, "touch");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString().split("\n")[0]).toContain("other");
    undo(view);
    expect(view.state.doc.toString()).toBe(before);
    undo(view);
    expect(view.state.doc.toString()).toBe("- a\n- b\n- c");
  });

  it("cancels and removes handles when editable is reconfigured during a drag", () => {
    const { view, onChange } = setup();
    const editable = new Compartment();
    view.dispatch({ effects: StateEffect.appendConfig.of(editable.of(EditorView.editable.of(true))) });
    const handle = start(view);
    pointer(handle, "pointermove", 115);
    view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(false)) });
    pointer(handle, "pointerup", 115);
    expect(view.dom.querySelector(".cm-list-reorder-handle")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("auto-scrolls only after the threshold and stops on cancellation", () => {
    const { view } = setup();
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelled = vi.spyOn(window, "cancelAnimationFrame");
    const handle = start(view, "touch");
    pointer(handle, "pointermove", 42, "touch");
    expect(frames).toHaveLength(0);
    pointer(handle, "pointermove", 195, "touch");
    frames.shift()!(0);
    expect(view.scrollDOM.scrollTop).toBeGreaterThan(0);
    pointer(handle, "pointercancel", 195, "touch");
    expect(cancelled).toHaveBeenCalled();
    const scroll = view.scrollDOM.scrollTop;
    frames.shift()!(16);
    expect(view.scrollDOM.scrollTop).toBe(scroll);
  });

  it("targets visible siblings when list boundaries are outside the viewport", () => {
    const { view, onChange } = setup();
    const handle = start(view);
    vi.spyOn(view, "coordsAtPos").mockImplementation((pos) =>
      pos === 0 || pos === view.state.doc.length
        ? null
        : { left: 50, right: 100, top: view.state.doc.lineAt(pos).number * 30, bottom: view.state.doc.lineAt(pos).number * 30 + 20 },
    );
    vi.spyOn(view, "lineBlockAt").mockImplementation(
      (pos) =>
        ({
          top: view.state.doc.lineAt(pos).number * 30 - view.documentTop,
          bottom: view.state.doc.lineAt(pos).number * 30 + 20 - view.documentTop,
        }) as ReturnType<EditorView["lineBlockAt"]>,
    );
    pointer(handle, "pointermove", 85);
    pointer(handle, "pointerup", 85);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("- b\n- a\n- c");
  });
});

import { DirectionProvider } from "@base-ui/react/direction-provider";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PagedMemoList from "@/components/PagedMemoList";
import type { Memo } from "@/types/proto/api/memo_service_pb";

const state = vi.hoisted(() => ({
  memos: [] as Memo[],
  columns: 1,
  move: vi.fn(),
  refetch: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/hooks/useMemoQueries", () => ({
  useInfiniteMemos: () => ({
    data: { pages: [{ memos: state.memos }] },
    hasNextPage: true,
    isLoading: false,
    isError: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: state.refetch,
  }),
  useMoveMemo: () => ({ mutateAsync: state.move, isPending: false }),
}));
vi.mock("react-hot-toast", () => ({ default: { error: state.toast } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isUserSettingsInitialized: true }) }));
vi.mock("@/contexts/ViewContext", () => ({ useView: () => ({ maxColumns: state.columns, compactMode: false }) }));
vi.mock("@/contexts/NewMemoContext", () => ({ useNewMemo: () => ({ newMemoName: null }) }));
vi.mock("@/contexts/AppSidebarContext", () => ({ useAppSidebar: () => ({ setQuickFindOpen: vi.fn() }) }));
vi.mock("@/contexts/MemoFilterContext", () => ({
  isSearchFilter: () => false,
  useMemoFilterContext: () => ({ filters: [], removeFilter: vi.fn() }),
}));
vi.mock("@/components/MemoContent/MentionResolutionContext", () => ({
  MentionResolutionProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/MemoFilters", () => ({ default: () => null }));
vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string, values?: { position: number; total: number }) =>
    values ? `${key} ${values.position}/${values.total}` : key,
}));

function Card({ memo, handle }: { memo: Memo; handle?: ReactNode }) {
  const [draft, setDraft] = useState("");
  return (
    <article data-testid={memo.name}>
      {handle}
      <a href="#note">{memo.content}</a>
      <input aria-label={`draft ${memo.name}`} value={draft} onChange={(event) => setDraft(event.target.value)} />
    </article>
  );
}
const list = (enabled = true, orderBy = "manual") => (
  <PagedMemoList
    reorderEnabled={enabled}
    orderBy={orderBy}
    renderer={(memo, { dragHandle }) => <Card key={memo.name} memo={memo} handle={dragHandle} />}
  />
);
function pointer(target: Element | Document, type: string, x: number, y: number, pointerType = "mouse", pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId, pointerType, button: 0, isPrimary: true });
  fireEvent(target, event);
}
const handles = () => screen.getAllByRole("button", { name: "memo.reorder" });
const order = () => screen.getAllByRole("article").map((card) => card.dataset.testid);
function drag(from: number, y: number, kind = "mouse") {
  pointer(handles()[from], "pointerdown", 50, from * 120 + 20, kind);
  pointer(document, "pointermove", 50, y, kind);
}

describe("memo card pointer reordering", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    state.memos = ["a", "b", "c"].map((name) => ({ name: `memos/${name}`, content: name }) as Memo);
    state.columns = 1;
    state.move.mockReset().mockResolvedValue({});
    state.refetch.mockReset().mockResolvedValue({});
    state.toast.mockReset();
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const name = this.dataset.memoReorderItem;
      const index = state.memos.findIndex((memo) => memo.name === name);
      const top = Math.max(0, index) * 120;
      return { top, bottom: top + 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: top } as DOMRect;
    });
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = () => true;
  });

  it.each(["mouse", "touch"])("previews %s movement with stable cards, a destination and explicit last-loaded anchor", async (kind) => {
    render(list());
    const card = screen.getByTestId("memos/b");
    const input = screen.getByRole("textbox", { name: "draft memos/b" });
    fireEvent.change(input, { target: { value: "unsaved" } });
    input.focus();
    drag(0, 350, kind);
    expect(order()).toEqual(["memos/b", "memos/c", "memos/a"]);
    expect(screen.getByTestId("memos/b")).toBe(card);
    expect(input).toHaveValue("unsaved");
    expect(input).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("memo.reorder-position 3/3");
    expect(document.querySelector("[data-reorder-placeholder]")).toBeInTheDocument();
    pointer(document, "pointerup", 50, 350, kind);
    // MoveMemo's `before` is the preceding neighbor, not "insert before".
    await waitFor(() => expect(state.move).toHaveBeenCalledWith({ name: "memos/a", before: "memos/c" }));
    expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it.each([
    [2, 0, { name: "memos/c", after: "memos/a" }],
    [2, 130, { name: "memos/c", before: "memos/a", after: "memos/b" }],
  ])("persists neighbors at destination from %i to %i", async (from, y, payload) => {
    render(list());
    drag(from as number, y as number);
    pointer(document, "pointerup", 50, y as number);
    await waitFor(() => expect(state.move).toHaveBeenCalledWith(payload));
  });

  it("keeps another card's focused draft when preview reconciliation moves its DOM node", () => {
    render(list());
    const input = screen.getByRole("textbox", { name: "draft memos/a" });
    fireEvent.change(input, { target: { value: "still editing" } });
    input.focus();
    drag(2, 0);
    expect(order()).toEqual(["memos/c", "memos/a", "memos/b"]);
    expect(screen.getByRole("textbox", { name: "draft memos/a" })).toBe(input);
    expect(input).toHaveValue("still editing");
    expect(input).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(input).toHaveFocus();
  });

  it("re-establishes pointer capture after the captured card's DOM position changes", () => {
    render(list());
    // Native capture can be cleared by a DOM move, despite stable React keys.
    HTMLElement.prototype.hasPointerCapture = () => screen.queryAllByRole("article")[0]?.dataset.testid === "memos/a";
    drag(0, 350);
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledTimes(2);
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(state.move).not.toHaveBeenCalled();
  });

  it.each([
    "threshold",
    "no-op",
    "escape",
    "pointercancel",
    "resize",
    "change",
    "unmount",
  ])("cancels %s without persisting and restores the original order", (reason) => {
    const view = render(list());
    drag(0, reason === "threshold" ? 23 : reason === "no-op" ? 30 : 350);
    if (reason === "escape") fireEvent.keyDown(document, { key: "Escape" });
    if (reason === "pointercancel") pointer(document, "pointercancel", 50, 350);
    if (reason === "resize") fireEvent(window, new Event("resize"));
    if (reason === "change") {
      state.memos = state.memos.map((memo) => ({ ...memo, content: `${memo.content}!` }));
      view.rerender(list());
    }
    if (reason === "unmount") view.unmount();
    pointer(document, "pointerup", 50, 350);
    expect(state.move).not.toHaveBeenCalled();
    if (reason !== "unmount") expect(order()).toEqual(["memos/a", "memos/b", "memos/c"]);
  });

  it("disables handles while saving and reloads authoritative order after a conflict, allowing retry", async () => {
    let reject!: (error: Error) => void;
    state.move.mockImplementationOnce(
      () =>
        new Promise((_, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    state.refetch.mockImplementationOnce(async () => {
      state.memos = [state.memos[2], state.memos[0], state.memos[1]];
    });
    const view = render(list());
    drag(0, 350);
    pointer(document, "pointerup", 50, 350);
    expect(handles().every((handle) => (handle as HTMLButtonElement).disabled)).toBe(true);
    await act(async () => reject(new Error("conflict")));
    view.rerender(list());
    expect(order()).toEqual(["memos/c", "memos/a", "memos/b"]);
    expect(state.refetch).toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledWith("memo.reorder-error");
    expect(handles().every((handle) => !(handle as HTMLButtonElement).disabled)).toBe(true);
    drag(0, 350);
    pointer(document, "pointerup", 50, 350);
    await waitFor(() => expect(state.move).toHaveBeenCalledTimes(2));
  });

  it.each([
    [false, "manual"],
    [true, "create_time desc"],
  ])("omits handles for other views (%s, %s)", (enabled, orderBy) => {
    render(list(enabled as boolean, orderBy as string));
    expect(screen.queryByRole("button", { name: "memo.reorder" })).not.toBeInTheDocument();
  });

  it.each(["ltr", "rtl"])("uses physical %s grid geometry while preserving mounted cards", async (direction) => {
    state.columns = 3;
    // Feed indices deliberately differ from physical x order in RTL.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const index = state.memos.findIndex((memo) => memo.name === this.dataset.memoReorderItem);
      const left = (direction === "rtl" ? 2 - Math.max(0, index) : Math.max(0, index)) * 220;
      return { top: 0, bottom: 100, left, right: left + 200, width: 200, height: 100, x: left, y: 0 } as DOMRect;
    });
    render(<DirectionProvider direction={direction as "ltr" | "rtl"}>{list()}</DirectionProvider>);
    const card = screen.getByTestId("memos/a");
    const startX = direction === "rtl" ? 490 : 50;
    const targetX = direction === "rtl" ? -10 : 650;
    pointer(handles()[0], "pointerdown", startX, 20);
    pointer(document, "pointermove", targetX, 50);
    expect(order()).toEqual(["memos/b", "memos/c", "memos/a"]);
    expect(screen.getByTestId("memos/a")).toBe(card);
    expect(card.closest(".absolute")).not.toBeNull();
    pointer(document, "pointerup", targetX, 50);
    await waitFor(() => expect(state.move).toHaveBeenCalledWith({ name: "memos/a", before: "memos/c" }));
  });

  it("auto-scrolls only active gestures on animation frames and cancels queued work on Escape", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      callbacks.delete(id);
    });
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    render(list());
    pointer(handles()[0], "pointerdown", 50, 20, "touch");
    expect(callbacks.size).toBe(0);
    pointer(document, "pointermove", 50, window.innerHeight - 2, "touch");
    expect(callbacks.size).toBe(1);
    const [id, callback] = [...callbacks][0];
    callbacks.delete(id);
    act(() => callback(16));
    expect(scroll).toHaveBeenCalledWith(0, expect.any(Number));
    expect(callbacks.size).toBe(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(callbacks.size).toBe(0);
    expect(state.move).not.toHaveBeenCalled();
  });

  it("cancels when a new page arrives and releases capture/listeners", () => {
    const view = render(list());
    drag(0, 350);
    state.memos = [...state.memos, { name: "memos/d", content: "d" } as Memo];
    view.rerender(list());
    pointer(document, "pointermove", 50, 500);
    pointer(document, "pointerup", 50, 500);
    expect(state.move).not.toHaveBeenCalled();
    expect(order()).toEqual(["memos/a", "memos/b", "memos/c", "memos/d"]);
    expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(document.querySelector("[data-reorder-placeholder]")).not.toBeInTheDocument();
  });

  it("cancels stale geometry when a loaded card changes size, even at unchanged list width", () => {
    let notify: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    try {
      render(list());
      drag(0, 350);
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        top: 0,
        bottom: 180,
        left: 0,
        right: 200,
        width: 200,
        height: 180,
      } as DOMRect);
      act(() => notify?.([], {} as ResizeObserver));
      pointer(document, "pointerup", 50, 350);
      expect(state.move).not.toHaveBeenCalled();
      expect(order()).toEqual(["memos/a", "memos/b", "memos/c"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores ordinary touch scrolling, links, inputs and other pointers outside the handle", () => {
    render(list());
    const link = screen.getAllByRole("link")[0];
    pointer(link, "pointerdown", 50, 20, "touch");
    pointer(document, "pointermove", 50, 350, "touch");
    pointer(document, "pointerup", 50, 350, "touch");
    drag(0, 350);
    pointer(document, "pointerup", 50, 350, "touch", 2);
    expect(state.move).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(order()).toEqual(["memos/a", "memos/b", "memos/c"]);
  });
});

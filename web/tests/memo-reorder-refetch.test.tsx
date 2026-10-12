import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PagedMemoList from "@/components/PagedMemoList";
import { State } from "@/types/proto/api/common_pb";
import { type Memo, MemoSchema } from "@/types/proto/api/memo_service_pb";

const rpc = vi.hoisted(() => ({ list: vi.fn(), move: vi.fn(), toast: vi.fn() }));
vi.mock("@/connect", () => ({ memoServiceClient: { listMemos: rpc.list, moveMemo: rpc.move } }));
vi.mock("@/hooks/useAttachmentQueries", () => ({ attachmentKeys: { lists: () => ["attachments", "list"] } }));
vi.mock("@/hooks/useUserQueries", () => ({ userKeys: { stats: () => ["users", "stats"] } }));
vi.mock("react-hot-toast", () => ({ default: { error: rpc.toast } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isUserSettingsInitialized: true }) }));
vi.mock("@/contexts/ViewContext", () => ({ useView: () => ({ maxColumns: 1, compactMode: false }) }));
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
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

function DraftCard({ memo, handle }: { memo: Memo; handle?: ReactNode }) {
  const [draft, setDraft] = useState("");
  return (
    <article>
      {handle}
      <input aria-label={`draft ${memo.name}`} value={draft} onChange={(event) => setDraft(event.target.value)} />
    </article>
  );
}

function pointer(target: Element | Document, type: string, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: 50, clientY: y, pointerId: 1, pointerType: "mouse", button: 0, isPrimary: true });
  fireEvent(target, event);
}

describe("manual reorder with cached pages", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps another card's editor and reports a refresh error after a saved move", async () => {
    rpc.toast.mockReset();
    const memos = ["a", "b"].map((id) => create(MemoSchema, { name: `memos/${id}`, content: id, state: State.NORMAL }));
    rpc.list.mockReset().mockResolvedValue({ memos, nextPageToken: "" });
    rpc.move.mockReset().mockImplementation(async () => {
      rpc.list.mockRejectedValue(new ConnectError("Offline after save", Code.Unavailable));
      return {};
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const y = this.dataset.memoReorderItem === "memos/b" ? 120 : 0;
      return { top: y, bottom: y + 100, left: 0, right: 200, width: 200, height: 100, x: 0, y } as DOMRect;
    });
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(900);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = () => true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const rendered = render(
      <QueryClientProvider client={client}>
        <PagedMemoList
          orderBy="manual"
          reorderEnabled
          renderer={(memo, { dragHandle }) => <DraftCard key={memo.name} memo={memo} handle={dragHandle} />}
        />
      </QueryClientProvider>,
    );
    const input = await screen.findByRole("textbox", { name: "draft memos/b" });
    fireEvent.change(input, { target: { value: "unsaved text" } });
    input.focus();
    await act(async () => {
      pointer(screen.getAllByRole("button", { name: "memo.reorder" })[0], "pointerdown", 20);
      pointer(document, "pointermove", 250);
      pointer(document, "pointerup", 250);
    });
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox", { name: "draft memos/b" })).toBe(input);
    expect(input).toHaveValue("unsaved text");
    expect(input).toHaveFocus();
    await waitFor(() => expect(rpc.toast).toHaveBeenCalledWith("search.load-error"));
    expect(rpc.move).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "search.retry" })).toBeEnabled();
    rendered.unmount();
    client.clear();
  });
});

import { Code, ConnectError } from "@connectrpc/connect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moveMemo: vi.fn(),
  listMemos: vi.fn(),
}));

vi.mock("@/connect", () => ({
  memoServiceClient: {
    moveMemo: mocks.moveMemo,
    listMemos: mocks.listMemos,
  },
}));

vi.mock("@/hooks/useAttachmentQueries", () => ({
  attachmentKeys: { lists: () => ["attachments", "list"] },
}));

vi.mock("@/hooks/useUserQueries", () => ({
  userKeys: { stats: () => ["users", "stats"] },
}));

import { useInfiniteMemos, useMoveMemo } from "@/hooks/useMemoQueries";

function createWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

describe("useMoveMemo", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends the target memo with its neighbor anchors and refreshes the lists", async () => {
    mocks.moveMemo.mockResolvedValue({});
    const queryClient = createQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useMoveMemo(), { wrapper: createWrapper(queryClient) });

    await result.current.mutateAsync({ name: "memos/b", before: "memos/a", after: "memos/c" });

    expect(mocks.moveMemo).toHaveBeenCalledTimes(1);
    expect(mocks.moveMemo).toHaveBeenCalledWith({ name: "memos/b", before: "memos/a", after: "memos/c" });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["memos", "list"] }));
  });

  it("refreshes the lists when the move conflicts so the server order wins", async () => {
    mocks.moveMemo.mockRejectedValue(Object.assign(new Error("stale"), { code: 10 }));
    const queryClient = createQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useMoveMemo(), { wrapper: createWrapper(queryClient) });

    await expect(result.current.mutateAsync({ name: "memos/b", after: "memos/a" })).rejects.toThrow();

    expect(mocks.moveMemo).toHaveBeenCalledWith({ name: "memos/b", after: "memos/a" });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["memos", "list"] }));
  });
});

describe("manual pagination recovery", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("restarts from page one when a concurrent move invalidates a next-page token", async () => {
    mocks.listMemos
      .mockResolvedValueOnce({ memos: [{ name: "memos/a" }], nextPageToken: "old-revision" })
      .mockResolvedValueOnce({ memos: [{ name: "memos/b" }], nextPageToken: "old-revision-page-three" })
      .mockRejectedValueOnce(new ConnectError("Order changed", Code.Aborted))
      .mockResolvedValue({ memos: [{ name: "memos/c" }], nextPageToken: "" });
    const queryClient = createQueryClient();
    const { result } = renderHook(() => ({ ...useInfiniteMemos({ orderBy: "manual" }) }), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages[0].memos[0].name).toBe("memos/c"));
    expect(result.current.data?.pages).toHaveLength(1);
    expect(mocks.listMemos).toHaveBeenCalledTimes(4);
    expect(mocks.listMemos.mock.calls.at(-1)?.[0].pageToken).toBe("");
    queryClient.clear();
  });

  it.each([
    ["create_time desc", Code.Aborted],
    ["manual", Code.Unavailable],
  ])("preserves loaded pages for %s with error %s", async (orderBy, code) => {
    mocks.listMemos
      .mockResolvedValueOnce({ memos: [{ name: "memos/a" }], nextPageToken: "next-page" })
      .mockRejectedValue(new ConnectError("Cannot load page", code));
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useInfiniteMemos({ orderBy }), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
    expect(result.current.data?.pages[0].memos[0].name).toBe("memos/a");
    expect(mocks.listMemos).toHaveBeenCalledTimes(2);
    queryClient.clear();
  });
});

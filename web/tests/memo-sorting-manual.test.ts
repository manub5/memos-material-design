import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Memo } from "@/types/proto/api/memo_service_pb";

const mocks = vi.hoisted(() => ({
  view: { orderByTimeAsc: false, timeBasis: "create_time" as const },
}));

vi.mock("@/contexts/ViewContext", () => ({
  useView: () => mocks.view,
}));

import { useMemoSorting } from "@/hooks/useMemoSorting";
import { State } from "@/types/proto/api/common_pb";

const ts = (iso: string) => create(TimestampSchema, { seconds: BigInt(Math.floor(Date.parse(iso) / 1000)) });
const memo = (name: string, iso: string, state = State.NORMAL) => ({ name, createTime: ts(iso), state }) as Memo;

describe("useMemoSorting manual feed", () => {
  it("requests the manual order from the API instead of a time order", () => {
    const { result } = renderHook(() => useMemoSorting({ manual: true, pinnedFirst: true }));
    expect(result.current.orderBy).toBe("manual");
  });

  it("preserves the server order without re-sorting or pinning when manual", () => {
    const { result } = renderHook(() => useMemoSorting({ manual: true, pinnedFirst: true }));
    const list = [memo("memos/second", "2024-01-01T00:00:00Z"), memo("memos/first", "2025-01-01T00:00:00Z")];
    expect(result.current.listSort(list).map((item) => item.name)).toEqual(["memos/second", "memos/first"]);
  });

  it("still drops memos whose state does not match when manual", () => {
    const { result } = renderHook(() => useMemoSorting({ manual: true }));
    const list = [memo("memos/keep", "2024-01-01T00:00:00Z"), memo("memos/archived", "2024-01-01T00:00:00Z", State.ARCHIVED)];
    expect(result.current.listSort(list).map((item) => item.name)).toEqual(["memos/keep"]);
  });

  it("keeps the chronological order when not manual", () => {
    const { result } = renderHook(() => useMemoSorting({}));
    expect(result.current.orderBy).toBe("create_time desc");
  });
});

import { timestampDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { useMemo } from "react";
import { type MemoTimeBasis, useView } from "@/contexts/ViewContext";
import { State } from "@/types/proto/api/common_pb";
import type { Memo } from "@/types/proto/api/memo_service_pb";

export interface UseMemoSortingOptions {
  pinnedFirst?: boolean;
  state?: State;
  /**
   * Owner timeline mode: rely on the server's manual order (rank ASC) instead of
   * the chronological/pinned order kept for shared and mixed-author feeds.
   */
  manual?: boolean;
}

export interface UseMemoSortingResult {
  listSort: (memos: Memo[]) => Memo[];
  orderBy: string;
}

/** The timestamp a memo is ordered and bucketed by under `timeBasis`. */
export const getMemoSortTime = (memo: Memo, timeBasis: MemoTimeBasis): Date | undefined => {
  const timestamp = timeBasis === "update_time" ? memo.updateTime : memo.createTime;
  return timestamp ? timestampDate(timestamp) : undefined;
};

// Moves the memo with the given name to the front of the list, above pinned
// memos, so a freshly created memo is immediately visible. Returns the input
// unchanged when the name is null, absent, or already first.
export const hoistMemoToFront = (memos: Memo[], name: string | null): Memo[] => {
  if (!name) return memos;
  const index = memos.findIndex((memo) => memo.name === name);
  if (index <= 0) return memos;
  const reordered = memos.slice();
  const [memo] = reordered.splice(index, 1);
  reordered.unshift(memo);
  return reordered;
};

export const useMemoSorting = (options: UseMemoSortingOptions = {}): UseMemoSortingResult => {
  const { pinnedFirst = false, state = State.NORMAL, manual = false } = options;
  const { orderByTimeAsc, timeBasis } = useView();

  // Generate orderBy string for API. A manual owner timeline defers entirely to the
  // server's rank order; every other feed keeps its chronological/pinned string.
  const orderBy = useMemo(() => {
    if (manual) {
      return "manual";
    }
    const timeOrder = orderByTimeAsc ? `${timeBasis} asc` : `${timeBasis} desc`;
    return pinnedFirst ? `pinned desc, ${timeOrder}` : timeOrder;
  }, [manual, pinnedFirst, orderByTimeAsc, timeBasis]);

  // Generate listSort function for client-side sorting. Under a manual order the server
  // already sends the exact sequence, so keep it intact and only apply the state filter.
  const listSort = useMemo(() => {
    return (memos: Memo[]): Memo[] => {
      const matching = memos.filter((memo) => memo.state === state);
      if (manual) {
        return matching;
      }
      return matching.sort((a, b) => {
        // First, sort by pinned status if enabled
        if (pinnedFirst && a.pinned !== b.pinned) {
          return b.pinned ? 1 : -1;
        }

        // Then sort by the selected time field.
        const aTime = getMemoSortTime(a, timeBasis);
        const bTime = getMemoSortTime(b, timeBasis);
        return orderByTimeAsc ? dayjs(aTime).unix() - dayjs(bTime).unix() : dayjs(bTime).unix() - dayjs(aTime).unix();
      });
    };
  }, [manual, pinnedFirst, state, orderByTimeAsc, timeBasis]);

  return { listSort, orderBy };
};

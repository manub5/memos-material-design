package test

import (
	"context"
	"fmt"
	"math"
	"slices"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestMemoOrderRevisionTracksCollectionMutations(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)
	revision := func() uint64 {
		value, err := ts.MemoOrderRevision(ctx, user.ID)
		require.NoError(t, err)
		return value
	}
	previous := revision()
	memo, err := ts.CreateMemo(ctx, &store.Memo{UID: "revision-memo", CreatorID: user.ID, Content: "original", Visibility: store.Private})
	require.NoError(t, err)
	require.Greater(t, revision(), previous, "creation changes pagination offsets")
	for _, state := range []store.RowStatus{store.Archived, store.Normal} {
		previous = revision()
		require.NoError(t, ts.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, RowStatus: &state}))
		require.Greater(t, revision(), previous, "archive and restore change collection membership")
	}
	previous = revision()
	require.NoError(t, ts.DeleteMemo(ctx, &store.DeleteMemo{ID: memo.ID}))
	require.Greater(t, revision(), previous, "deletion changes pagination offsets")
}

func TestMoveMemoRebalancePreservesArchivedPosition(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)
	var memos []*store.Memo
	for i, rank := range []int64{200, 201, 400, 3000} {
		memo, err := ts.CreateMemo(ctx, &store.Memo{UID: fmt.Sprintf("rebalance-%d", i), CreatorID: user.ID, Visibility: store.Private})
		require.NoError(t, err)
		_, err = ts.GetDriver().GetDB().ExecContext(ctx, orderRankUpdateQuery(), rank, memo.ID)
		require.NoError(t, err)
		memos = append(memos, memo)
	}
	archived := store.Archived
	require.NoError(t, ts.UpdateMemo(ctx, &store.UpdateMemo{ID: memos[3].ID, RowStatus: &archived}))
	require.NoError(t, ts.MoveMemo(ctx, &store.MoveMemo{ActorID: user.ID, UID: memos[2].UID, Before: &memos[0].UID, After: &memos[1].UID}))
	active := store.Normal
	require.NoError(t, ts.UpdateMemo(ctx, &store.UpdateMemo{ID: memos[3].ID, RowStatus: &active}))
	ordered, err := ts.ListMemos(ctx, &store.FindMemo{CreatorID: &user.ID, OrderByManual: true})
	require.NoError(t, err)
	var got []string
	for _, memo := range ordered {
		got = append(got, memo.UID)
	}
	require.Equal(t, []string{memos[0].UID, memos[2].UID, memos[1].UID, memos[3].UID}, got)
}

func TestMoveMemoConcurrentGapAndRejectedMoves(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)
	var memos []*store.Memo
	for i := range 5 {
		memo, err := ts.CreateMemo(ctx, &store.Memo{UID: fmt.Sprintf("concurrent-%d", i), CreatorID: user.ID, Visibility: store.Private})
		require.NoError(t, err)
		memos = append(memos, memo)
	}
	slices.Reverse(memos)
	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for _, memo := range memos[3:] {
		workers.Go(func() {
			<-start
			results <- ts.MoveMemo(ctx, &store.MoveMemo{ActorID: user.ID, UID: memo.UID, Before: &memos[0].UID, After: &memos[1].UID})
		})
	}
	close(start)
	workers.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		} else {
			require.ErrorIs(t, err, store.ErrMemoOrderConflict)
		}
	}
	require.Equal(t, 1, successes, "only one caller can fill the same stale neighbor pair")
	ordered, err := ts.ListMemos(ctx, &store.FindMemo{CreatorID: &user.ID, OrderByManual: true})
	require.NoError(t, err)
	require.Len(t, ordered, 5)
	revision, err := ts.MemoOrderRevision(ctx, user.ID)
	require.NoError(t, err)
	require.NoError(t, ts.MoveMemo(ctx, &store.MoveMemo{ActorID: user.ID, UID: ordered[1].UID, Before: &ordered[0].UID, After: &ordered[2].UID}))
	require.ErrorIs(t, ts.MoveMemo(ctx, &store.MoveMemo{ActorID: user.ID + 999, UID: ordered[1].UID}), store.ErrMemoOrderPermission)
	after, err := ts.MemoOrderRevision(ctx, user.ID)
	require.NoError(t, err)
	require.Equal(t, revision, after, "replay and rejected moves must not change revision")
	current, err := ts.ListMemos(ctx, &store.FindMemo{CreatorID: &user.ID, OrderByManual: true})
	require.NoError(t, err)
	for i := range ordered {
		require.Equal(t, ordered[i].UID, current[i].UID)
	}
}

func orderRankUpdateQuery() string {
	switch getDriverFromEnv() {
	case "mysql":
		return "UPDATE memo_order SET `rank` = ? WHERE memo_id = ?"
	case "postgres":
		return "UPDATE memo_order SET rank = $1 WHERE memo_id = $2"
	default:
		return "UPDATE memo_order SET rank = ? WHERE memo_id = ?"
	}
}

func TestMoveMemoRebalancesIntegerBoundaries(t *testing.T) {
	for _, edge := range []string{"start", "end"} {
		t.Run(edge, func(t *testing.T) {
			ctx := context.Background()
			ts := NewTestingStore(ctx, t)
			defer ts.Close()
			user, err := createTestingHostUser(ctx, ts)
			require.NoError(t, err)
			var memos []*store.Memo
			for i := range 3 {
				memo, err := ts.CreateMemo(ctx, &store.Memo{UID: fmt.Sprintf("boundary-%d", i), CreatorID: user.ID, Visibility: store.Private})
				require.NoError(t, err)
				memos = append(memos, memo)
			}
			for i, rank := range []int64{math.MinInt64, 0, math.MaxInt64} {
				_, err = ts.GetDriver().GetDB().ExecContext(ctx, orderRankUpdateQuery(), rank, memos[i].ID)
				require.NoError(t, err)
			}
			move := &store.MoveMemo{ActorID: user.ID, UID: memos[2].UID}
			want := []string{memos[2].UID, memos[0].UID, memos[1].UID}
			if edge == "end" {
				move.UID, move.Before = memos[0].UID, &memos[2].UID
				want = []string{memos[1].UID, memos[2].UID, memos[0].UID}
			}
			require.NoError(t, ts.MoveMemo(ctx, move))
			ordered, err := ts.ListMemos(ctx, &store.FindMemo{CreatorID: &user.ID, OrderByManual: true})
			require.NoError(t, err)
			var got []string
			for _, memo := range ordered {
				got = append(got, memo.UID)
			}
			require.Equal(t, want, got)
		})
	}
}

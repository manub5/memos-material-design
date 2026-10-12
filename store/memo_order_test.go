package store

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

type changingOrderDriver struct {
	Driver
	revision         uint64
	changeDuringRead bool
}

func (d *changingOrderDriver) MemoOrderRevision(context.Context, int32) (uint64, error) {
	return d.revision, nil
}

func (d *changingOrderDriver) ListMemos(context.Context, *FindMemo) ([]*Memo, error) {
	if d.changeDuringRead {
		d.revision++
	}
	return []*Memo{{UID: "mixed-revision-row"}}, nil
}

func TestListMemosAtOrderRevisionRejectsConcurrentChange(t *testing.T) {
	for _, change := range []bool{false, true} {
		t.Run(map[bool]string{false: "stable", true: "concurrent"}[change], func(t *testing.T) {
			driver := &changingOrderDriver{revision: 7, changeDuringRead: change}
			s := &Store{driver: driver}
			memos, err := s.ListMemosAtOrderRevision(context.Background(), &FindMemo{CreatorID: new(int32(1)), OrderByManual: true}, 7)
			if change {
				require.ErrorIs(t, err, ErrMemoOrderConflict)
				require.Nil(t, memos, "never expose rows read across two revisions")
			} else {
				require.NoError(t, err)
				require.Len(t, memos, 1)
			}
		})
	}
}

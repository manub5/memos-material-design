package store

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"slices"
)

// ErrMemoOrderPermission indicates a memo is outside the caller's own active timeline.
var ErrMemoOrderPermission = errors.New("memo is not in the owner's active timeline")

// ErrMemoOrderConflict indicates that the proposed neighbors are no longer adjacent.
var ErrMemoOrderConflict = errors.New("memo ordering neighbors have changed")

// MoveMemo represents one owner-scoped repositioning request.
type MoveMemo struct {
	ActorID int32
	UID     string
	Before  *string
	After   *string
}

// MemoOrderDialect specifies the SQL placeholders and locking form used by a driver.
type MemoOrderDialect string

const (
	// MemoOrderSQLite is the SQLite dialect.
	MemoOrderSQLite MemoOrderDialect = "sqlite"
	// MemoOrderMySQL is the MySQL dialect.
	MemoOrderMySQL MemoOrderDialect = "mysql"
	// MemoOrderPostgres is the PostgreSQL dialect.
	MemoOrderPostgres MemoOrderDialect = "postgres"
)

type orderedMemo struct {
	id   int32
	uid  string
	rank int64
}

// MoveMemoInTransaction validates and repositions a memo in a driver-owned transaction.
func MoveMemoInTransaction(ctx context.Context, tx *sql.Tx, dialect MemoOrderDialect, move *MoveMemo) error {
	actorParam, uidParam := "?", "?"
	insertRevision := "INSERT OR IGNORE INTO memo_order_revision (creator_id, revision) VALUES (?, 0)"
	lockSuffix := ""
	rankColumn := "rank"
	if dialect == MemoOrderMySQL {
		insertRevision = "INSERT IGNORE INTO memo_order_revision (creator_id, revision) VALUES (?, 0)"
		lockSuffix = " FOR UPDATE"
		rankColumn = "`rank`"
	} else if dialect == MemoOrderPostgres {
		actorParam, uidParam = "$1", "$2"
		insertRevision = "INSERT INTO memo_order_revision (creator_id, revision) VALUES ($1, 0) ON CONFLICT (creator_id) DO NOTHING"
		lockSuffix = " FOR UPDATE"
	}
	if _, err := tx.ExecContext(ctx, insertRevision, move.ActorID); err != nil {
		return err
	}
	var revision int64
	if err := tx.QueryRowContext(ctx, "SELECT revision FROM memo_order_revision WHERE creator_id = "+actorParam+lockSuffix, move.ActorID).Scan(&revision); err != nil {
		return err
	}
	query := "SELECT m.id, m.uid, o." + rankColumn + ", m.row_status FROM memo m JOIN memo_order o ON o.memo_id = m.id " +
		"WHERE m.creator_id = " + actorParam + " " +
		"AND NOT EXISTS (SELECT 1 FROM memo_relation r WHERE r.memo_id = m.id AND r.type = 'COMMENT') " +
		"ORDER BY o." + rankColumn + " ASC, m.id DESC"
	rows, err := tx.QueryContext(ctx, query, move.ActorID)
	if err != nil {
		return err
	}
	var items []orderedMemo
	var allItems []orderedMemo
	for rows.Next() {
		var item orderedMemo
		var state RowStatus
		if err := rows.Scan(&item.id, &item.uid, &item.rank, &state); err != nil {
			_ = rows.Close()
			return err
		}
		allItems = append(allItems, item)
		if state == Normal {
			items = append(items, item)
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	from := slices.IndexFunc(items, func(item orderedMemo) bool { return item.uid == move.UID })
	if from < 0 {
		return ErrMemoOrderPermission
	}
	item := items[from]
	items = slices.Delete(items, from, from+1)
	to := 0
	if move.Before != nil {
		index := slices.IndexFunc(items, func(item orderedMemo) bool { return item.uid == *move.Before })
		if index < 0 {
			return ErrMemoOrderPermission
		}
		to = index + 1
	}
	if move.After != nil {
		index := slices.IndexFunc(items, func(item orderedMemo) bool { return item.uid == *move.After })
		if index < 0 {
			return ErrMemoOrderPermission
		}
		if move.Before != nil && index != to {
			return ErrMemoOrderConflict
		}
		if move.Before == nil {
			to = index
		}
	}
	if from == to {
		return nil
	}
	items = slices.Insert(items, to, item)
	updateQuery := "UPDATE memo_order SET " + rankColumn + " = " + actorParam + " WHERE memo_id = " + uidParam
	var rank int64
	needsRebalance := false
	switch {
	case to == 0:
		needsRebalance = items[1].rank < math.MinInt64+1024
		rank = items[1].rank - 1024
	case to == len(items)-1:
		needsRebalance = items[to-1].rank > math.MaxInt64-1024
		rank = items[to-1].rank + 1024
	default:
		prev, next := items[to-1].rank, items[to+1].rank
		needsRebalance = next-prev <= 1
		rank = prev + (next-prev)/2
	}
	if needsRebalance {
		// Renumber the full collection in its current sequence, including archives.
		// Only the explicitly moved memo may change position relative to hidden rows.
		ranks := make(map[int32]int64, len(allItems))
		var nextRank int64
		for _, candidate := range allItems {
			if candidate.id == item.id {
				continue
			}
			nextRank += 1024
			ranks[candidate.id] = nextRank
			if _, err := tx.ExecContext(ctx, updateQuery, nextRank, candidate.id); err != nil {
				return err
			}
		}
		for i := range items {
			items[i].rank = ranks[items[i].id]
		}
		switch {
		case to == 0:
			rank = items[1].rank - 1024
		case to == len(items)-1:
			rank = items[to-1].rank + 1024
		default:
			rank = items[to-1].rank + (items[to+1].rank-items[to-1].rank)/2
		}
	}
	if _, err := tx.ExecContext(ctx, updateQuery, rank, item.id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE memo_order_revision SET revision = revision + 1 WHERE creator_id = "+actorParam, move.ActorID); err != nil {
		return err
	}
	return nil
}

// MoveMemo applies a memo repositioning atomically in the active database driver.
func (s *Store) MoveMemo(ctx context.Context, move *MoveMemo) error {
	return s.driver.MoveMemo(ctx, move)
}

// MemoOrderRevision returns the owner's order revision for pagination consistency.
func (s *Store) MemoOrderRevision(ctx context.Context, creatorID int32) (uint64, error) {
	return s.driver.MemoOrderRevision(ctx, creatorID)
}

// ListMemosAtOrderRevision discards a manual page if its collection changed during
// the read. Every membership and rank mutation updates the revision atomically.
func (s *Store) ListMemosAtOrderRevision(ctx context.Context, find *FindMemo, revision uint64) ([]*Memo, error) {
	if find.CreatorID == nil || !find.OrderByManual {
		return nil, ErrMemoOrderPermission
	}
	memos, err := s.ListMemos(ctx, find)
	if err != nil {
		return nil, err
	}
	current, err := s.MemoOrderRevision(ctx, *find.CreatorID)
	if err != nil {
		return nil, err
	}
	if current != revision {
		return nil, ErrMemoOrderConflict
	}
	return memos, nil
}

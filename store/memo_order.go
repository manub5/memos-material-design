package store

import (
	"context"
	"database/sql"
	"errors"
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
	query := "SELECT m.id, m.uid, o." + rankColumn + " FROM memo m JOIN memo_order o ON o.memo_id = m.id " +
		"WHERE m.creator_id = " + actorParam + " AND m.row_status = 'NORMAL' " +
		"AND NOT EXISTS (SELECT 1 FROM memo_relation r WHERE r.memo_id = m.id AND r.type = 'COMMENT') " +
		"ORDER BY o." + rankColumn + " ASC, m.id DESC"
	rows, err := tx.QueryContext(ctx, query, move.ActorID)
	if err != nil {
		return err
	}
	var items []orderedMemo
	for rows.Next() {
		var item orderedMemo
		if err := rows.Scan(&item.id, &item.uid, &item.rank); err != nil {
			_ = rows.Close()
			return err
		}
		items = append(items, item)
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
		rank = items[1].rank - 1024
	case to == len(items)-1:
		rank = items[to-1].rank + 1024
	default:
		prev, next := items[to-1].rank, items[to+1].rank
		needsRebalance = next-prev <= 1
		rank = prev + (next-prev)/2
	}
	if needsRebalance {
		for i, candidate := range items {
			if _, err := tx.ExecContext(ctx, updateQuery, int64(i+1)*1024, candidate.id); err != nil {
				return err
			}
		}
	} else if _, err := tx.ExecContext(ctx, updateQuery, rank, item.id); err != nil {
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

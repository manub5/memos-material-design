ALTER TABLE memo ADD COLUMN color TEXT NOT NULL DEFAULT '';

CREATE TABLE memo_order (
  memo_id INTEGER PRIMARY KEY REFERENCES memo(id) ON DELETE CASCADE,
  creator_id INTEGER NOT NULL,
  rank BIGINT NOT NULL
);
CREATE INDEX idx_memo_order_creator_rank ON memo_order(creator_id, rank, memo_id);

CREATE TABLE memo_order_revision (
  creator_id INTEGER PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 0
);

INSERT INTO memo_order (memo_id, creator_id, rank)
SELECT m.id, m.creator_id,
  ROW_NUMBER() OVER (PARTITION BY m.creator_id ORDER BY m.created_ts DESC, m.uid DESC) * 1024
FROM memo m
WHERE NOT EXISTS (SELECT 1 FROM memo_relation r WHERE r.memo_id = m.id AND r.type = 'COMMENT');

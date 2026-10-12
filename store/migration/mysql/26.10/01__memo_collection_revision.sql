-- Keep the revision atomic with every mutation, including policy-driven deletes.
CREATE TRIGGER memo_revision_insert AFTER INSERT ON memo FOR EACH ROW
  INSERT INTO memo_order_revision (creator_id, revision) VALUES (NEW.creator_id, 1)
  ON DUPLICATE KEY UPDATE revision = revision + 1;
CREATE TRIGGER memo_revision_update AFTER UPDATE ON memo FOR EACH ROW
  INSERT INTO memo_order_revision (creator_id, revision) VALUES (NEW.creator_id, 1)
  ON DUPLICATE KEY UPDATE revision = revision + 1;
CREATE TRIGGER memo_revision_delete AFTER DELETE ON memo FOR EACH ROW
  INSERT INTO memo_order_revision (creator_id, revision) VALUES (OLD.creator_id, 1)
  ON DUPLICATE KEY UPDATE revision = revision + 1;

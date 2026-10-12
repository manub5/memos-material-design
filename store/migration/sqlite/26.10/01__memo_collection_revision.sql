-- Keep the revision atomic with every mutation, including policy-driven deletes.
CREATE TRIGGER memo_revision_insert AFTER INSERT ON memo BEGIN
  INSERT INTO memo_order_revision (creator_id, revision) VALUES (NEW.creator_id, 1)
  ON CONFLICT (creator_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER memo_revision_update AFTER UPDATE ON memo BEGIN
  INSERT INTO memo_order_revision (creator_id, revision) VALUES (NEW.creator_id, 1)
  ON CONFLICT (creator_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER memo_revision_delete AFTER DELETE ON memo BEGIN
  INSERT INTO memo_order_revision (creator_id, revision) VALUES (OLD.creator_id, 1)
  ON CONFLICT (creator_id) DO UPDATE SET revision = revision + 1;
END;

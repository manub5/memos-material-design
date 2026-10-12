-- Keep the revision atomic with every mutation, including policy-driven deletes.
CREATE FUNCTION bump_memo_collection_revision() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO memo_order_revision (creator_id, revision) VALUES (OLD.creator_id, 1)
    ON CONFLICT (creator_id) DO UPDATE SET revision = memo_order_revision.revision + 1;
    RETURN OLD;
  END IF;
  INSERT INTO memo_order_revision (creator_id, revision) VALUES (NEW.creator_id, 1)
  ON CONFLICT (creator_id) DO UPDATE SET revision = memo_order_revision.revision + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER memo_collection_revision AFTER INSERT OR UPDATE OR DELETE ON memo
  FOR EACH ROW EXECUTE FUNCTION bump_memo_collection_revision();

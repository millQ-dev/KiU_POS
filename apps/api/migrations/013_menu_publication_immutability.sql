-- M1.1 follow-up: enforce MenuPublication immutability for DBs that already applied 012.
CREATE OR REPLACE FUNCTION menu_publication_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PUBLISHED_IMMUTABLE: MenuPublication rows cannot be updated or deleted'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE OR REPLACE FUNCTION menu_publication_item_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PUBLISHED_IMMUTABLE: MenuPublication membership cannot be mutated'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_menu_publication_immutable ON menu_publication;
CREATE TRIGGER trg_menu_publication_immutable
  BEFORE UPDATE OR DELETE ON menu_publication
  FOR EACH ROW EXECUTE FUNCTION menu_publication_reject_mutation();

DROP TRIGGER IF EXISTS trg_menu_publication_item_immutable ON menu_publication_item;
CREATE TRIGGER trg_menu_publication_item_immutable
  BEFORE UPDATE OR DELETE ON menu_publication_item
  FOR EACH ROW EXECUTE FUNCTION menu_publication_item_reject_mutation();

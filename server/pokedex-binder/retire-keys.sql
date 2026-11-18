-- Apply after deploying the retired endpoint. Retain key digests as revocation tombstones.
START TRANSACTION;
DELETE clients FROM pokedex_binder_clients AS clients INNER JOIN pokedex_binders AS binders ON binders.id = clients.binder_id WHERE binders.deleted_at IS NULL;
UPDATE pokedex_binders SET deleted_at = CURRENT_TIMESTAMP, state_json = NULL, revision = revision + 1 WHERE deleted_at IS NULL;
COMMIT;

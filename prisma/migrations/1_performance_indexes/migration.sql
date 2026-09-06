-- Index tuning.
--
-- Dropped: the four "ix_*_id" indexes on primary-key columns. A PRIMARY KEY
-- already creates a unique index on that column, so these were exact
-- duplicates -- an artifact of the SQLAlchemy models this schema was ported
-- from, where every id column carried index=True. They cost write throughput
-- and disk while serving no read.
--
-- Dropped: ix_transactions_date and ix_transactions_user_id, superseded by
-- the composite below. No query in the app filters on date without also
-- filtering on user_id, and a composite index serves queries on its leftmost
-- prefix, so (user_id, date) covers the user_id-only case too.
--
-- Added: ix_transactions_user_id_date. Every read path -- the monthly
-- listing, the monthly summary aggregate, the upload deduplication lookup --
-- filters user_id AND a date range together. Postgres can only use one
-- single-column index per scan, so previously it picked one and filtered the
-- remaining rows manually. user_id leads because it is an equality match,
-- which lets the date range read one contiguous slice of the index.
--
-- Added: ix_transactions_category_id, for the reassignment bulk-update that
-- runs when a category is deleted.

-- DropIndex
DROP INDEX "ix_categories_id";

-- DropIndex
DROP INDEX "ix_file_imports_id";

-- DropIndex
DROP INDEX "ix_password_reset_tokens_id";

-- DropIndex
DROP INDEX "ix_transactions_date";

-- DropIndex
DROP INDEX "ix_transactions_id";

-- DropIndex
DROP INDEX "ix_transactions_user_id";

-- DropIndex
DROP INDEX "ix_users_id";

-- CreateIndex
CREATE INDEX "ix_transactions_user_id_date" ON "transactions"("user_id", "date");

-- CreateIndex
CREATE INDEX "ix_transactions_category_id" ON "transactions"("category_id");


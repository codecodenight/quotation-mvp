CREATE TABLE IF NOT EXISTS "price_history" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "supplier_offer_id" TEXT NOT NULL,
  "old_price" DECIMAL NOT NULL,
  "new_price" DECIMAL NOT NULL,
  "old_source_file_id" TEXT,
  "new_source_file_id" TEXT,
  "changed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "price_history_supplier_offer_id_fkey" FOREIGN KEY ("supplier_offer_id") REFERENCES "supplier_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "price_history_old_source_file_id_fkey" FOREIGN KEY ("old_source_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "price_history_new_source_file_id_fkey" FOREIGN KEY ("new_source_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "price_history_supplier_offer_id_idx" ON "price_history"("supplier_offer_id");

ALTER TABLE "raw_products" ADD COLUMN "raw_status" TEXT NOT NULL DEFAULT 'pending';

CREATE INDEX "raw_products_raw_status_idx" ON "raw_products"("raw_status");

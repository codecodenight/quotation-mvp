CREATE TABLE IF NOT EXISTS "product_params" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "product_id" TEXT NOT NULL,
  "param_key" TEXT NOT NULL,
  "raw_value" TEXT NOT NULL,
  "normalized_value" TEXT,
  "unit" TEXT,
  "source_field" TEXT NOT NULL,
  "confidence" TEXT NOT NULL DEFAULT 'medium',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_params_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "product_params_product_id_idx" ON "product_params"("product_id");
CREATE INDEX IF NOT EXISTS "product_params_param_key_idx" ON "product_params"("param_key");
CREATE INDEX IF NOT EXISTS "product_params_key_value_idx" ON "product_params"("param_key", "normalized_value");

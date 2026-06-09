CREATE TABLE "files" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "file_name" TEXT NOT NULL,
  "file_type" TEXT NOT NULL,
  "file_size" BIGINT NOT NULL,
  "folder_name" TEXT,
  "factory_guess" TEXT,
  "volume_name" TEXT NOT NULL,
  "relative_path" TEXT NOT NULL,
  "absolute_path_snapshot" TEXT NOT NULL,
  "modified_at" DATETIME NOT NULL,
  "scanned_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "files_volume_name_relative_path_key" ON "files"("volume_name", "relative_path");
CREATE INDEX "files_file_type_idx" ON "files"("file_type");
CREATE INDEX "files_file_name_idx" ON "files"("file_name");

CREATE TABLE "raw_products" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source_file_id" TEXT NOT NULL,
  "factory_name" TEXT,
  "raw_product_name" TEXT,
  "raw_model_no" TEXT,
  "raw_price" DECIMAL,
  "raw_currency" TEXT,
  "raw_moq" TEXT,
  "raw_material" TEXT,
  "raw_size" TEXT,
  "raw_description" TEXT,
  "raw_remark" TEXT,
  "raw_row_data" JSONB NOT NULL,
  "source_sheet_name" TEXT,
  "header_row_index" INTEGER,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "raw_products_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "raw_products_source_file_id_idx" ON "raw_products"("source_file_id");

CREATE TABLE "products" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "product_name" TEXT NOT NULL,
  "category" TEXT,
  "model_no" TEXT,
  "material" TEXT,
  "size" TEXT,
  "image_path" TEXT,
  "remark" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL
);

CREATE INDEX "products_product_name_idx" ON "products"("product_name");
CREATE INDEX "products_model_no_idx" ON "products"("model_no");

CREATE TABLE "supplier_offers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "product_id" TEXT NOT NULL,
  "factory_name" TEXT NOT NULL,
  "purchase_price" DECIMAL NOT NULL,
  "currency" TEXT NOT NULL,
  "moq" TEXT,
  "lead_time" TEXT,
  "source_file_id" TEXT,
  "remark" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_offers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_offers_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "supplier_offers_product_id_idx" ON "supplier_offers"("product_id");
CREATE INDEX "supplier_offers_factory_name_idx" ON "supplier_offers"("factory_name");

CREATE TABLE "quotes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customer_name" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "profit_margin" DECIMAL NOT NULL,
  "exchange_rate" DECIMAL,
  "quote_file_path" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "quotes_customer_name_idx" ON "quotes"("customer_name");

CREATE TABLE "quote_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "quote_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "supplier_offer_id" TEXT,
  "purchase_price" DECIMAL NOT NULL,
  "purchase_currency" TEXT NOT NULL,
  "sale_price" DECIMAL NOT NULL,
  "quantity" INTEGER NOT NULL,
  "remark" TEXT,
  CONSTRAINT "quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quote_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quote_items_supplier_offer_id_fkey" FOREIGN KEY ("supplier_offer_id") REFERENCES "supplier_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "quote_items_quote_id_idx" ON "quote_items"("quote_id");
CREATE INDEX "quote_items_product_id_idx" ON "quote_items"("product_id");

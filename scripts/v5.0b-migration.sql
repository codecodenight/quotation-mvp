CREATE TABLE IF NOT EXISTS customer_quote_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  customer_name TEXT,
  quote_date TEXT,
  format_type TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  header_row INTEGER,
  header_snapshot TEXT,
  column_mapping TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(relative_path, sheet_name)
);

CREATE TABLE IF NOT EXISTS customer_quote_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES customer_quote_files(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_model TEXT,
  raw_description TEXT,
  sale_price_usd REAL,
  sale_price_text TEXT,
  rmb_cost REAL,
  moq TEXT,
  ctn_qty TEXT,
  ctn_size TEXT,
  remark TEXT,
  raw_row_json TEXT,
  matched_product_id TEXT REFERENCES products(id),
  UNIQUE(file_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_cqr_file_id ON customer_quote_rows(file_id);
CREATE INDEX IF NOT EXISTS idx_cqr_matched_product ON customer_quote_rows(matched_product_id);
CREATE INDEX IF NOT EXISTS idx_cqf_customer ON customer_quote_files(customer_name);
CREATE INDEX IF NOT EXISTS idx_cqf_quote_date ON customer_quote_files(quote_date);

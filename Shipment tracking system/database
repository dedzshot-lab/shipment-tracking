CREATE TABLE IF NOT EXISTS csv_uploads (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    uploader_key VARCHAR(191) NOT NULL,
    uploader_name VARCHAR(191) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    csv_text MEDIUMTEXT NOT NULL,
    row_count INT UNSIGNED NOT NULL DEFAULT 0,
    file_size INT UNSIGNED NOT NULL DEFAULT 0,
    sha256 CHAR(64) NOT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_uploader (uploader_key),
    KEY updated_at_index (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

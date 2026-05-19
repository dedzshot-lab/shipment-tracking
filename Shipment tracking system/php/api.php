<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$config = require __DIR__ . '/config.php';

// checks what the user wants to enter and devolps on that task
try {
    $pdo = openDatabase($config);
    ensureSchema($pdo, $config['driver']);

    $action = $_GET['action'] ?? $_POST['action'] ?? 'list';

    if ($action === 'list') {
        listFiles($pdo);
    } elseif ($action === 'upload') {
        uploadFile($pdo, $config);
    } elseif ($action === 'delete') {
        deleteFile($pdo);
    } else {
        sendJson(['ok' => false, 'error' => 'Unknown API action.'], 404);
    }
} catch (Throwable $error) {
    sendJson(['ok' => false, 'error' => $error->getMessage()], 500);
}

function openDatabase(array $config): PDO
{
    $driver = strtolower((string) ($config['driver'] ?? 'sqlite'));
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];

    if ($driver === 'mysql') {
        $mysql = $config['mysql'];
        $charset = $mysql['charset'] ?? 'utf8mb4';
        $dsn = sprintf(
            'mysql:host=%s;dbname=%s;charset=%s',
            $mysql['host'],
            $mysql['database'],
            $charset
        );

        return new PDO($dsn, $mysql['username'], $mysql['password'], $options);
    }

    $path = (string) $config['sqlite_path'];
    $directory = dirname($path);

    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        throw new RuntimeException('Could not create the SQLite storage folder.');
    }

    return new PDO('sqlite:' . $path, null, null, $options);
}

function ensureSchema(PDO $pdo, string $driver): void
{
    if (strtolower($driver) === 'mysql') {
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS csv_uploads (
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
        return;
    }

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS csv_uploads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uploader_key TEXT NOT NULL UNIQUE,
            uploader_name TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            csv_text TEXT NOT NULL,
            row_count INTEGER NOT NULL DEFAULT 0,
            file_size INTEGER NOT NULL DEFAULT 0,
            sha256 TEXT NOT NULL,
            uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    );
}

function listFiles(PDO $pdo): void
{
    $statement = $pdo->query(
        "SELECT id, uploader_key, uploader_name, original_filename, csv_text, row_count, file_size, sha256, uploaded_at, updated_at
         FROM csv_uploads
         ORDER BY uploader_name ASC, updated_at DESC"
    );

    sendJson([
        'ok' => true,
        'files' => $statement->fetchAll(),
    ]);
}

function uploadFile(PDO $pdo, array $config): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendJson(['ok' => false, 'error' => 'Uploads must use POST.'], 405);
    }

    $uploaderName = trim((string) ($_POST['uploader_name'] ?? ''));
    if ($uploaderName === '') {
        sendJson(['ok' => false, 'error' => 'Uploader name is required.'], 422);
    }

    if (!isset($_FILES['csv_file']) || !is_array($_FILES['csv_file'])) {
        sendJson(['ok' => false, 'error' => 'CSV file is required.'], 422);
    }

    $file = $_FILES['csv_file'];
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        sendJson(['ok' => false, 'error' => uploadErrorMessage((int) $file['error'])], 422);
    }

    $maxBytes = (int) $config['max_upload_bytes'];
    $fileSize = (int) ($file['size'] ?? 0);
    if ($fileSize <= 0 || $fileSize > $maxBytes) {
        sendJson(['ok' => false, 'error' => 'CSV file size is not allowed.'], 422);
    }

    $originalName = sanitizeFileName((string) ($file['name'] ?? 'upload.csv'));
    $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    if (!in_array($extension, $config['allowed_extensions'], true)) {
        sendJson(['ok' => false, 'error' => 'Only .csv files are accepted.'], 422);
    }

    $temporaryPath = (string) ($file['tmp_name'] ?? '');
    $csvText = file_get_contents($temporaryPath);
    if ($csvText === false) {
        sendJson(['ok' => false, 'error' => 'Could not read the uploaded CSV file.'], 500);
    }

    $csvText = normalizeUtf8($csvText);
    $uploaderKey = normalizeUploaderKey($uploaderName);
    $rowCount = countCsvRows($csvText);
    $hash = hash('sha256', $csvText);

    if (strtolower((string) $config['driver']) === 'mysql') {
        $statement = $pdo->prepare(
            "INSERT INTO csv_uploads
                (uploader_key, uploader_name, original_filename, csv_text, row_count, file_size, sha256)
             VALUES
                (:uploader_key, :uploader_name, :original_filename, :csv_text, :row_count, :file_size, :sha256)
             ON DUPLICATE KEY UPDATE
                uploader_name = VALUES(uploader_name),
                original_filename = VALUES(original_filename),
                csv_text = VALUES(csv_text),
                row_count = VALUES(row_count),
                file_size = VALUES(file_size),
                sha256 = VALUES(sha256)"
        );
    } else {
        $statement = $pdo->prepare(
            "INSERT INTO csv_uploads
                (uploader_key, uploader_name, original_filename, csv_text, row_count, file_size, sha256)
             VALUES
                (:uploader_key, :uploader_name, :original_filename, :csv_text, :row_count, :file_size, :sha256)
             ON CONFLICT(uploader_key) DO UPDATE SET
                uploader_name = excluded.uploader_name,
                original_filename = excluded.original_filename,
                csv_text = excluded.csv_text,
                row_count = excluded.row_count,
                file_size = excluded.file_size,
                sha256 = excluded.sha256,
                updated_at = CURRENT_TIMESTAMP"
        );
    }

    $statement->execute([
        ':uploader_key' => $uploaderKey,
        ':uploader_name' => $uploaderName,
        ':original_filename' => $originalName,
        ':csv_text' => $csvText,
        ':row_count' => $rowCount,
        ':file_size' => strlen($csvText),
        ':sha256' => $hash,
    ]);

    sendJson([
        'ok' => true,
        'message' => 'CSV file stored successfully.',
        'uploader_key' => $uploaderKey,
        'row_count' => $rowCount,
    ]);
}

function deleteFile(PDO $pdo): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendJson(['ok' => false, 'error' => 'Delete must use POST.'], 405);
    }

    $uploaderName = trim((string) ($_POST['uploader_name'] ?? ''));
    if ($uploaderName === '') {
        sendJson(['ok' => false, 'error' => 'Uploader name is required.'], 422);
    }

    $statement = $pdo->prepare('DELETE FROM csv_uploads WHERE uploader_key = :uploader_key');
    $statement->execute([':uploader_key' => normalizeUploaderKey($uploaderName)]);

    sendJson([
        'ok' => true,
        'deleted' => $statement->rowCount(),
    ]);
}

function normalizeUtf8(string $content): string
{
    $content = preg_replace('/^\xEF\xBB\xBF/', '', $content) ?? $content;

    if (preg_match('//u', $content)) {
        return $content;
    }

    if (function_exists('mb_detect_encoding') && function_exists('mb_convert_encoding')) {
        $encoding = mb_detect_encoding($content, ['UTF-8', 'Windows-1256', 'Windows-1252', 'ISO-8859-1'], true);
        if ($encoding !== false) {
            return mb_convert_encoding($content, 'UTF-8', $encoding);
        }
    }

    if (function_exists('iconv')) {
        $converted = @iconv('Windows-1252', 'UTF-8//IGNORE', $content);
        if ($converted !== false) {
            return $converted;
        }
    }

    return $content;
}

function countCsvRows(string $content): int
{
    $lines = preg_split('/\R/u', trim($content));
    if ($lines === false || $lines === ['']) return 0;

    return count(array_filter($lines, static function ($line): bool {
        return trim($line) !== '';
    }));
}

function sanitizeFileName(string $filename): string
{
    $filename = basename($filename);
    $filename = preg_replace('/[^\pL\pN._ -]+/u', '_', $filename) ?? 'upload.csv';
    $filename = trim($filename, " .\t\n\r\0\x0B");

    if ($filename === '') {
        return 'upload.csv';
    }

    return mb_substr_safe($filename, 0, 180);
}

function normalizeUploaderKey(string $name): string
{
    $key = preg_replace('/\s+/u', ' ', trim($name)) ?? trim($name);

    if (function_exists('mb_strtolower')) {
        return mb_strtolower($key, 'UTF-8');
    }

    return strtolower($key);
}

function uploadErrorMessage(int $errorCode): string
{
    $messages = [
        UPLOAD_ERR_INI_SIZE => 'The uploaded file is larger than the server allows.',
        UPLOAD_ERR_FORM_SIZE => 'The uploaded file is larger than the form allows.',
        UPLOAD_ERR_PARTIAL => 'The file was only partially uploaded.',
        UPLOAD_ERR_NO_FILE => 'No file was uploaded.',
        UPLOAD_ERR_NO_TMP_DIR => 'The server is missing an upload folder.',
        UPLOAD_ERR_CANT_WRITE => 'The server could not write the uploaded file.',
        UPLOAD_ERR_EXTENSION => 'A PHP extension stopped the upload.',
    ];

    return $messages[$errorCode] ?? 'The upload failed.';
}

function mb_substr_safe(string $value, int $start, int $length): string
{
    if (function_exists('mb_substr')) {
        return mb_substr($value, $start, $length, 'UTF-8');
    }

    return substr($value, $start, $length);
}

function sendJson(array $payload, int $statusCode = 200): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

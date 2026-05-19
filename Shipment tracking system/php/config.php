<?php

return [
    /*
     * Use "sqlite" for a self-contained launch or "mysql" for a hosted MySQL database.
     * You can also set SHIPMENT_DB_DRIVER in the server environment.
     */
    'driver' => getenv('SHIPMENT_DB_DRIVER') ?: 'sqlite',

    'sqlite_path' => __DIR__ . '/storage/shipment_tracker.sqlite',

    'mysql' => [
        'host' => getenv('SHIPMENT_DB_HOST') ?: 'localhost',
        'database' => getenv('SHIPMENT_DB_NAME') ?: 'shipment_tracker',
        'username' => getenv('SHIPMENT_DB_USER') ?: '',
        'password' => getenv('SHIPMENT_DB_PASS') ?: '',
        'charset' => 'utf8mb4',
    ],

    'max_upload_bytes' => 20 * 1024 * 1024,
    'allowed_extensions' => ['csv'],
];

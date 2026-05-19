document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'php/api.php';
    const STORAGE_KEY = 'shipmentTracker.v2.csvFiles';
    const SOURCE_CACHE_KEY = 'shipmentTracker.shared.sourceFiles';
    const ROW_CACHE_KEY = 'shipmentTracker.shared.performanceRows.v2';
    const CACHE_TTL_MS = 5 * 60 * 1000;

    const order = cleanOrderNumber(new URLSearchParams(window.location.search).get('order') || '');
    const shipmentTitle = document.getElementById('shipmentTitle');
    const shipmentLabel = document.getElementById('shipmentLabel');
    const detailOrder = document.getElementById('detailOrder');
    const detailStatus = document.getElementById('detailStatus');
    const detailDate = document.getElementById('detailDate');
    const detailPerson = document.getElementById('detailPerson');
    const detailModeLabel = document.getElementById('detailModeLabel');
    const shipmentTimeline = document.getElementById('shipmentTimeline');

    initializeShipment();

    async function initializeShipment() {
        detailOrder.textContent = order || '-';
        shipmentTitle.textContent = order ? `Shipment ${order}` : 'Shipment History';

        if (!order) {
            shipmentLabel.textContent = 'No shipment number was provided.';
            return;
        }

        const cachedRows = loadRowsCache();
        const files = cachedRows ? [] : await loadSourceFiles();
        const allRows = cachedRows || parseSourceFiles(files);
        if (!cachedRows) saveRowsCache(allRows);
        const rows = allRows
            .filter(row => row.order === order)
            .sort((a, b) => b.dateValue - a.dateValue || b.sequence - a.sequence);

        renderShipment(rows, cachedRows ? null : files.length);
    }

    async function loadSourceFiles() {
        const cachedFiles = loadSourceCache();
        if (cachedFiles) return cachedFiles;

        try {
            const response = await fetch(`${API_URL}?action=list`);
            const payload = await response.json();
            if (response.ok && payload.ok) {
                const files = (payload.files || []).map(file => ({
                    name: cleanCell(file.original_filename) || `${cleanCell(file.uploader_name) || 'uploaded'}.csv`,
                    text: String(file.csv_text || ''),
                    uploaderName: cleanCell(file.uploader_name)
                }));
                saveSourceCache(files);
                return files;
            }
        } catch (error) {
            console.warn('Database shipment load failed; using local CSV copies.', error);
        }

        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            const files = Array.isArray(saved)
                ? saved.filter(file => file && typeof file.text === 'string')
                : [];
            saveSourceCache(files);
            return files;
        } catch (error) {
            console.warn('Local shipment load failed.', error);
            return [];
        }
    }

    function parseSourceFiles(files) {
        return files
            .flatMap(file => parseCSVRows(file.text).flatMap((columns, rowIndex) => {
                return extractShipmentRows(columns, file).map(row => ({ ...row, rowIndex }));
            }))
            .map((row, sequence) => ({ ...row, sequence }));
    }

    function loadSourceCache() {
        try {
            const cached = JSON.parse(sessionStorage.getItem(SOURCE_CACHE_KEY) || localStorage.getItem(SOURCE_CACHE_KEY) || 'null');
            if (!cached || Date.now() - Number(cached.savedAt) > CACHE_TTL_MS) return null;
            return Array.isArray(cached.files) ? cached.files.filter(file => file && typeof file.text === 'string') : null;
        } catch (error) {
            return null;
        }
    }

    function saveSourceCache(files) {
        const payload = JSON.stringify({
            savedAt: Date.now(),
            files: files.map(file => ({
                name: file.name || 'CSV file',
                text: file.text || '',
                uploaderName: file.uploaderName || ''
            }))
        });

        try {
            sessionStorage.setItem(SOURCE_CACHE_KEY, payload);
            localStorage.setItem(SOURCE_CACHE_KEY, payload);
        } catch (error) {
            console.warn('Could not save shipment source cache.', error);
        }
    }

    function loadRowsCache() {
        try {
            const cached = JSON.parse(sessionStorage.getItem(ROW_CACHE_KEY) || 'null');
            if (!cached || Date.now() - Number(cached.savedAt) > CACHE_TTL_MS) return null;
            return Array.isArray(cached.rows) ? cached.rows : null;
        } catch (error) {
            return null;
        }
    }

    function saveRowsCache(parsedRows) {
        try {
            sessionStorage.setItem(ROW_CACHE_KEY, JSON.stringify({
                savedAt: Date.now(),
                rows: parsedRows
            }));
        } catch (error) {
            console.warn('Could not save parsed shipment cache.', error);
        }
    }

    function renderShipment(rows, fileCount) {
        shipmentTimeline.innerHTML = '';
        detailModeLabel.textContent = `${rows.length} ${rows.length === 1 ? 'update' : 'updates'}`;

        if (rows.length === 0) {
            detailStatus.textContent = '-';
            detailDate.textContent = '-';
            detailPerson.textContent = '-';
            shipmentLabel.textContent = `No history found for shipment ${order}.`;
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'This shipment was not found in the connected CSV files.';
            shipmentTimeline.appendChild(empty);
            return;
        }

        const latest = rows[0];
        detailStatus.textContent = latest.status;
        detailDate.textContent = latest.dateText;
        detailPerson.textContent = latest.name || 'Unassigned';
        shipmentLabel.textContent = fileCount === null
            ? `Showing ${rows.length} updates from cached shipment data.`
            : `Showing ${rows.length} updates from ${fileCount} ${fileCount === 1 ? 'CSV file' : 'CSV files'}.`;

        rows.forEach((row, index) => {
            shipmentTimeline.appendChild(createTimelineItem(row, index === 0));
        });
    }

    function createTimelineItem(row, isLatest) {
        const item = document.createElement('article');
        const marker = document.createElement('div');
        const content = document.createElement('div');
        const header = document.createElement('div');
        const title = document.createElement('h3');
        const badge = document.createElement('span');
        const person = document.createElement('div');
        const meta = document.createElement('div');
        const comment = document.createElement('p');

        item.className = isLatest ? 'timeline-item is-latest' : 'timeline-item';
        marker.className = 'timeline-marker';
        content.className = 'timeline-content';
        header.className = 'timeline-header';
        badge.className = 'panel-count';
        person.className = 'timeline-person';
        meta.className = 'timeline-meta';
        comment.className = 'timeline-comment';

        title.textContent = row.status;
        badge.textContent = isLatest ? 'Latest Update' : row.dateText;
        person.textContent = `Handled by: ${row.name || 'Unassigned'}`;
        meta.textContent = `${row.dateText} - ${row.sourceName || 'CSV file'}`;
        comment.textContent = row.comment || 'No comment written.';

        header.appendChild(title);
        header.appendChild(badge);
        content.appendChild(header);
        content.appendChild(person);
        content.appendChild(meta);
        content.appendChild(comment);
        item.appendChild(marker);
        item.appendChild(content);
        return item;
    }

    function extractShipmentRows(columns, sourceFile) {
        if (columns.length < 3) return [];
        const row = buildShipmentRow(columns, 0, sourceFile);
        if (row) return [row];

        const rows = [];
        for (let index = 1; index <= columns.length - 3; index++) {
            const nestedRow = buildShipmentRow(columns, index, sourceFile);
            if (nestedRow) rows.push(nestedRow);
        }
        return rows;
    }

    function buildShipmentRow(columns, startIndex, sourceFile) {
        const name = cleanCell(columns[startIndex]);
        const rowOrder = cleanOrderNumber(columns[startIndex + 1]);
        let date = cleanCell(columns[startIndex + 2]);
        let comment = cleanCell(columns[startIndex + 3]);

        if (!hasDateValue(date) && hasDateValue(comment)) {
            const oldComment = date;
            date = comment;
            comment = oldComment;
        }

        if (isHeaderRow(name, rowOrder, date, comment)) return null;
        if (!isLikelyName(name)) return null;
        if (!isValidOrderNumber(rowOrder)) return null;

        const dateValue = parseShipmentDate(date);
        if (dateValue === null) return null;

        return {
            name,
            order: rowOrder,
            date,
            comment,
            dateValue,
            dateText: date || formatDisplayDate(dateValue),
            status: normalizeStatus(comment),
            sourceName: sourceFile.name || 'CSV file'
        };
    }

    function parseCSVRows(text) {
        const rows = [];
        let row = [];
        let current = '';
        let inQuotes = false;
        const input = stripBom(String(text || ''));

        for (let i = 0; i < input.length; i++) {
            const char = input[i];
            const nextChar = input[i + 1];

            if (char === '"' && inQuotes && nextChar === '"') {
                current += '"';
                i++;
            } else if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(current);
                current = '';
            } else if ((char === '\n' || char === '\r') && !inQuotes) {
                row.push(current);
                current = '';
                if (row.some(cell => cleanCell(cell) !== '')) rows.push(row);
                row = [];
                if (char === '\r' && nextChar === '\n') i++;
            } else {
                current += char;
            }
        }

        row.push(current);
        if (row.some(cell => cleanCell(cell) !== '')) rows.push(row);
        return rows;
    }

    function parseShipmentDate(value) {
        const text = cleanCell(value).replace(/\s+/g, ' ');
        if (!text) return null;

        const currentYear = new Date().getFullYear();
        const monthNames = {
            jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
            apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
            aug: 7, august: 7, sep: 8, sept: 8, september: 8,
            oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
        };

        let match = text.match(/^(\d{1,2})[\s/-]+([A-Za-z]+)(?:[\s,/-]+(\d{2,4}))?$/);
        if (match) return buildDateValue(normalizeYear(match[3] || currentYear), monthNames[match[2].toLowerCase()], Number(match[1]));

        match = text.match(/^([A-Za-z]+)[\s/-]+(\d{1,2})(?:[\s,/-]+(\d{2,4}))?$/);
        if (match) return buildDateValue(normalizeYear(match[3] || currentYear), monthNames[match[1].toLowerCase()], Number(match[2]));

        match = text.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
        if (match) return buildDateValue(normalizeYear(match[3] || currentYear), Number(match[2]) - 1, Number(match[1]));

        const parsed = Date.parse(text);
        return Number.isNaN(parsed) ? null : parsed;
    }

    function normalizeStatus(value) {
        const text = cleanCell(value).replace(/\s+/g, ' ');
        const normalized = text.toLowerCase();
        if (!text) return 'No Comment';
        if (normalized.includes('no response')) return 'No Response';
        if (normalized.includes('located')) return 'Located';
        if (normalized.includes('no need')) return 'No Need';
        if (normalized.includes('dispatched')) return 'Dispatched';
        if (normalized.includes('wrong')) return 'Wrong Number';
        if (normalized.includes('cancel')) return 'Cancelled';
        return toTitleCase(text);
    }

    function isHeaderRow(name, rowOrder, date, comment) {
        const combined = `${name} ${rowOrder} ${date} ${comment}`.toLowerCase();
        return /\border\b/.test(combined) && /\bdate\b/.test(combined);
    }

    function hasDateValue(value) {
        return parseShipmentDate(value) !== null;
    }

    function isLikelyName(value) {
        const text = cleanCell(value);
        const normalized = text.toLowerCase().replace(/\s+/g, ' ');
        return Boolean(text && !/^\d+$/.test(text) && !['name', 'comment', 'date', 'status', 'order number', 'order no'].includes(normalized));
    }

    function isValidOrderNumber(value) {
        return /^\d{5,9}$/.test(value) && !/^[05]/.test(value);
    }

    function normalizeYear(value) {
        const year = Number(value);
        if (!Number.isFinite(year)) return new Date().getFullYear();
        return year < 100 ? 2000 + year : year;
    }

    function buildDateValue(year, month, day) {
        if (!Number.isInteger(month) || !Number.isFinite(day)) return null;
        const date = new Date(Date.UTC(year, month, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
        return date.getTime();
    }

    function formatDisplayDate(dateValue) {
        return new Date(dateValue).toLocaleDateString();
    }

    function toTitleCase(value) {
        return cleanCell(value).toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
    }

    function cleanOrderNumber(value) {
        return cleanCell(value).replace(/^'+/, '');
    }

    function cleanCell(value) {
        return String(value || '').trim();
    }

    function stripBom(value) {
        return String(value || '').replace(/^\uFEFF/, '');
    }
});

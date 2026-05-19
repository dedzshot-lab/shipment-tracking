document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'php/api.php';
    const STORAGE_KEY = 'shipmentTracker.v2.csvFiles';
    const SOURCE_CACHE_KEY = 'shipmentTracker.shared.sourceFiles';
    const ROW_CACHE_KEY = 'shipmentTracker.shared.performanceRows.v2';
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const STATUS_COLORS = ['#61A644', '#00a19a', '#f59f00', '#0b3a67', '#c92a2a', '#7c3aed', '#64748b', '#14b8a6'];

    const performanceLabel = document.getElementById('performanceLabel');
    const periodFilter = document.getElementById('periodFilter');
    const periodFilterLabel = document.getElementById('periodFilterLabel');
    const peopleSelector = document.getElementById('peopleSelector');
    const selectAllPeopleBtn = document.getElementById('selectAllPeopleBtn');
    const clearPeopleBtn = document.getElementById('clearPeopleBtn');
    const dailyBtn = document.getElementById('dailyBtn');
    const weeklyBtn = document.getElementById('weeklyBtn');
    const monthlyBtn = document.getElementById('monthlyBtn');
    const separateBtn = document.getElementById('separateBtn');
    const joinedBtn = document.getElementById('joinedBtn');
    const totalShipmentsEl = document.getElementById('totalPerformanceShipments');
    const totalPeopleEl = document.getElementById('totalPerformancePeople');
    const topStatusEl = document.getElementById('topPerformanceStatus');
    const selectedDateEl = document.getElementById('selectedPerformanceDate');
    const performanceTitle = document.getElementById('performanceTitle');
    const performanceModeLabel = document.getElementById('performanceModeLabel');
    const performanceContent = document.getElementById('performanceContent');

    let rows = [];
    let latestByOrder = new Map();
    let reportType = 'daily';
    let mode = 'separate';
    let selectedPeople = new Set();

    dailyBtn.addEventListener('click', () => setReportType('daily'));
    weeklyBtn.addEventListener('click', () => setReportType('weekly'));
    monthlyBtn.addEventListener('click', () => setReportType('monthly'));
    separateBtn.addEventListener('click', () => setMode('separate'));
    joinedBtn.addEventListener('click', () => setMode('joined'));
    periodFilter.addEventListener('change', renderPerformance);
    selectAllPeopleBtn.addEventListener('click', selectAllPeople);
    clearPeopleBtn.addEventListener('click', clearPeople);

    initializePerformance();

    async function initializePerformance() {
        const files = await loadSourceFiles();
        rows = loadRowsCache() || parseSourceFiles(files);
        saveRowsCache(rows);
        latestByOrder = getLatestByOrder(rows);
        selectedPeople = new Set(getPeople(rows));

        renderPeopleSelector();
        populatePeriodFilter();
        renderPerformance();

        const fileWord = files.length === 1 ? 'CSV file' : 'CSV files';
        performanceLabel.textContent = files.length > 0
            ? `Performance from ${files.length} ${fileWord}`
            : 'No CSV files found';
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
            console.warn('Database performance load failed; using local CSV copies.', error);
        }

        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            const files = Array.isArray(saved)
                ? saved.filter(file => file && typeof file.text === 'string')
                : [];
            saveSourceCache(files);
            return files;
        } catch (error) {
            console.warn('Local performance load failed.', error);
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
            console.warn('Could not save performance source cache.', error);
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
            console.warn('Could not save parsed performance cache.', error);
        }
    }

    function setReportType(type) {
        reportType = type;
        populatePeriodFilter();
        renderPerformance();
    }

    function setMode(nextMode) {
        mode = nextMode;
        renderPerformance();
    }

    function populatePeriodFilter() {
        const periods = getAvailablePeriods();
        const previousValue = periodFilter.value;

        periodFilter.innerHTML = '';
        periodFilterLabel.textContent = `${toTitleCase(reportType)} report period`;

        if (periods.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No periods available';
            periodFilter.appendChild(option);
            return;
        }

        periods.forEach(period => {
            const option = document.createElement('option');
            option.value = period.key;
            option.textContent = period.label;
            periodFilter.appendChild(option);
        });

        if (periods.some(period => period.key === previousValue)) {
            periodFilter.value = previousValue;
        }
    }

    function renderPeopleSelector() {
        const people = getPeople(rows);
        peopleSelector.innerHTML = '';

        if (people.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'No people found.';
            peopleSelector.appendChild(empty);
            return;
        }

        people.forEach(person => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            const text = document.createElement('span');

            label.className = 'person-chip';
            checkbox.type = 'checkbox';
            checkbox.value = person;
            checkbox.checked = selectedPeople.has(person);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    selectedPeople.add(person);
                } else {
                    selectedPeople.delete(person);
                }
                renderPerformance();
            });
            text.textContent = person;

            label.appendChild(checkbox);
            label.appendChild(text);
            peopleSelector.appendChild(label);
        });
    }

    function selectAllPeople() {
        selectedPeople = new Set(getPeople(rows));
        renderPeopleSelector();
        renderPerformance();
    }

    function clearPeople() {
        selectedPeople.clear();
        renderPeopleSelector();
        renderPerformance();
    }

    function renderPerformance() {
        const period = getSelectedPeriod();
        const periodRows = getRowsForPeriod(period);
        const selectedRows = periodRows.filter(row => selectedPeople.has(row.name));
        const people = groupBy(selectedRows, row => row.name || 'Unassigned');
        const statusTotals = countBy(selectedRows, row => row.status);
        const topStatus = getTopEntry(statusTotals);

        totalShipmentsEl.textContent = selectedRows.length;
        totalPeopleEl.textContent = people.size;
        topStatusEl.textContent = topStatus ? topStatus[0] : '-';
        selectedDateEl.textContent = period ? period.shortLabel : '-';
        performanceModeLabel.textContent = `${selectedRows.length} ${selectedRows.length === 1 ? 'shipment' : 'shipments'}`;

        dailyBtn.classList.toggle('is-active', reportType === 'daily');
        weeklyBtn.classList.toggle('is-active', reportType === 'weekly');
        monthlyBtn.classList.toggle('is-active', reportType === 'monthly');
        separateBtn.classList.toggle('is-active', mode === 'separate');
        joinedBtn.classList.toggle('is-active', mode === 'joined');

        performanceContent.innerHTML = '';

        if (!period || selectedRows.length === 0) {
            performanceTitle.textContent = 'Performance';
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = selectedPeople.size === 0
                ? 'Select at least one person to view performance.'
                : 'No performance data found for this selection.';
            performanceContent.appendChild(empty);
            return;
        }

        if (mode === 'joined') {
            performanceTitle.textContent = `Joined ${toTitleCase(reportType)} Performance`;
            performanceContent.appendChild(createPerformanceCard({
                title: 'Selected Team Members',
                subtitle: `${people.size} ${people.size === 1 ? 'person' : 'people'} - ${period.label}`,
                rows: selectedRows
            }));
            return;
        }

        performanceTitle.textContent = `Separate ${toTitleCase(reportType)} Performance`;
        Array.from(people.entries())
            .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
            .forEach(([person, personRows]) => {
                performanceContent.appendChild(createPerformanceCard({
                    title: person,
                    subtitle: `${personRows.length} ${personRows.length === 1 ? 'shipment' : 'shipments'} - ${period.label}`,
                    rows: personRows
                }));
            });
    }

    function createPerformanceCard({ title, subtitle, rows: cardRows }) {
        const card = document.createElement('article');
        const header = document.createElement('div');
        const headingGroup = document.createElement('div');
        const eyebrow = document.createElement('span');
        const heading = document.createElement('h3');
        const count = document.createElement('strong');
        const body = document.createElement('div');
        const chart = document.createElement('div');
        const chartTotal = document.createElement('div');
        const totalNumber = document.createElement('strong');
        const totalLabel = document.createElement('span');
        const legend = document.createElement('div');
        const shipmentPanel = createShipmentPanel(cardRows);

        const totals = countBy(cardRows, row => row.status);
        const total = cardRows.length;

        card.className = 'performance-card';
        header.className = 'performance-card-header';
        eyebrow.className = 'section-label';
        count.className = 'panel-count';
        body.className = 'performance-card-body';
        chart.className = 'donut-chart';
        chartTotal.className = 'donut-total';
        legend.className = 'status-legend';

        eyebrow.textContent = subtitle;
        heading.textContent = title;
        count.textContent = `${total} total`;
        chart.style.background = buildConicGradient(totals, total);
        totalNumber.textContent = total;
        totalLabel.textContent = 'Shipments';

        Array.from(totals.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .forEach(([status, value], index) => {
                legend.appendChild(createLegendRow(status, value, total, STATUS_COLORS[index % STATUS_COLORS.length]));
            });

        headingGroup.appendChild(eyebrow);
        headingGroup.appendChild(heading);
        header.appendChild(headingGroup);
        header.appendChild(count);
        chartTotal.appendChild(totalNumber);
        chartTotal.appendChild(totalLabel);
        chart.appendChild(chartTotal);
        body.appendChild(chart);
        body.appendChild(legend);
        card.appendChild(header);
        card.appendChild(body);
        card.appendChild(shipmentPanel);
        return card;
    }

    function createShipmentPanel(cardRows) {
        const panel = document.createElement('div');
        const title = document.createElement('h4');
        const tableWrap = document.createElement('div');
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const tbody = document.createElement('tbody');
        const uniqueRows = getPeriodShipments(cardRows);

        panel.className = 'shipment-panel';
        title.textContent = 'Shipments in this report';
        tableWrap.className = 'mini-table-wrapper';
        table.className = 'mini-table';
        thead.innerHTML = '<tr><th>Shipment</th><th>Latest Update</th><th>Latest Date</th><th>Actions in Period</th></tr>';

        uniqueRows.forEach(row => {
            const latest = latestByOrder.get(row.order) || row;
            const tr = document.createElement('tr');
            const orderCell = document.createElement('td');
            const orderLink = document.createElement('a');

            orderLink.href = `shipment.html?order=${encodeURIComponent(row.order)}`;
            orderLink.className = 'shipment-link';
            orderLink.textContent = row.order;
            orderCell.appendChild(orderLink);

            tr.appendChild(orderCell);
            tr.appendChild(createTextCell(latest.status));
            tr.appendChild(createTextCell(latest.dateText));
            tr.appendChild(createTextCell(String(row.periodCount)));
            tbody.appendChild(tr);
        });

        table.appendChild(thead);
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        panel.appendChild(title);
        panel.appendChild(tableWrap);
        return panel;
    }

    function createTextCell(value) {
        const td = document.createElement('td');
        td.textContent = value || '-';
        return td;
    }

    function createLegendRow(status, value, total, color) {
        const row = document.createElement('div');
        const swatch = document.createElement('span');
        const label = document.createElement('span');
        const metric = document.createElement('strong');
        const percent = total > 0 ? Math.round((value / total) * 100) : 0;

        row.className = 'legend-row';
        swatch.className = 'legend-swatch';
        swatch.style.background = color;
        label.textContent = status;
        metric.textContent = `${value} (${percent}%)`;

        row.appendChild(swatch);
        row.appendChild(label);
        row.appendChild(metric);
        return row;
    }

    function getPeriodShipments(data) {
        const map = new Map();
        data.forEach(row => {
            const existing = map.get(row.order);
            if (!existing) {
                map.set(row.order, { ...row, periodCount: 1 });
                return;
            }

            existing.periodCount++;
            if (row.dateValue > existing.dateValue || (row.dateValue === existing.dateValue && row.sequence > existing.sequence)) {
                map.set(row.order, { ...row, periodCount: existing.periodCount });
            }
        });

        return Array.from(map.values()).sort((a, b) => b.dateValue - a.dateValue || a.order.localeCompare(b.order));
    }

    function getRowsForPeriod(period) {
        if (!period) return [];
        return rows.filter(row => {
            if (reportType === 'daily') return row.dateKey === period.key;
            if (reportType === 'weekly') return row.weekKey === period.key;
            return row.monthKey === period.key;
        });
    }

    function getAvailablePeriods() {
        const map = new Map();
        rows.forEach(row => {
            const period = getPeriodFromRow(row);
            if (period) map.set(period.key, period);
        });

        return Array.from(map.values()).sort((a, b) => b.sortValue - a.sortValue);
    }

    function getSelectedPeriod() {
        return getAvailablePeriods().find(period => period.key === periodFilter.value) || null;
    }

    function getPeriodFromRow(row) {
        if (reportType === 'daily') {
            return {
                key: row.dateKey,
                label: row.dateText,
                shortLabel: row.dateText,
                sortValue: row.dateValue
            };
        }

        if (reportType === 'weekly') {
            return {
                key: row.weekKey,
                label: row.weekLabel,
                shortLabel: row.weekShortLabel,
                sortValue: row.weekStartValue
            };
        }

        return {
            key: row.monthKey,
            label: row.monthLabel,
            shortLabel: row.monthLabel,
            sortValue: row.monthStartValue
        };
    }

    function buildConicGradient(totals, total) {
        let start = 0;
        const parts = Array.from(totals.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([, value], index) => {
                const end = start + (value / total) * 100;
                const color = STATUS_COLORS[index % STATUS_COLORS.length];
                const segment = `${color} ${start}% ${end}%`;
                start = end;
                return segment;
            });

        return `conic-gradient(${parts.join(', ')})`;
    }

    function getLatestByOrder(data) {
        const map = new Map();
        data.forEach(row => {
            const existing = map.get(row.order);
            if (!existing || row.dateValue > existing.dateValue || (row.dateValue === existing.dateValue && row.sequence > existing.sequence)) {
                map.set(row.order, row);
            }
        });
        return map;
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
        const order = cleanOrderNumber(columns[startIndex + 1]);
        let date = cleanCell(columns[startIndex + 2]);
        let comment = cleanCell(columns[startIndex + 3]);

        if (!hasDateValue(date) && hasDateValue(comment)) {
            const oldComment = date;
            date = comment;
            comment = oldComment;
        }

        if (isHeaderRow(name, order, date, comment)) return null;
        if (!isLikelyName(name)) return null;
        if (!isValidOrderNumber(order)) return null;

        const dateValue = parseShipmentDate(date);
        if (dateValue === null) return null;

        const week = getWeekPeriod(dateValue);
        const month = getMonthPeriod(dateValue);

        return {
            name,
            order,
            date,
            comment,
            dateValue,
            dateKey: formatDateKey(dateValue),
            dateText: date || formatDisplayDate(dateValue),
            status: normalizeStatus(comment),
            weekKey: week.key,
            weekLabel: week.label,
            weekShortLabel: week.shortLabel,
            weekStartValue: week.startValue,
            monthKey: month.key,
            monthLabel: month.label,
            monthStartValue: month.startValue,
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

    function getWeekPeriod(dateValue) {
        const date = new Date(dateValue);
        const day = date.getUTCDay();
        const offset = day === 0 ? -6 : 1 - day;
        const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offset));
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 6));
        const monthName = start.toLocaleString(undefined, { month: 'long', timeZone: 'UTC' });
        const weekOfMonth = Math.floor((start.getUTCDate() - 1) / 7) + 1;

        return {
            key: formatDateKey(start.getTime()),
            label: `Week ${weekOfMonth} of ${monthName} (${formatShortDate(start)} - ${formatShortDate(end)})`,
            shortLabel: `${formatShortDate(start)} - ${formatShortDate(end)}`,
            startValue: start.getTime()
        };
    }

    function getMonthPeriod(dateValue) {
        const date = new Date(dateValue);
        const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

        return {
            key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
            label: start.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
            startValue: start.getTime()
        };
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

    function getPeople(data) {
        return Array.from(new Set(data.map(row => row.name || 'Unassigned'))).sort((a, b) => a.localeCompare(b));
    }

    function groupBy(data, getKey) {
        const map = new Map();
        data.forEach(item => {
            const key = getKey(item);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(item);
        });
        return map;
    }

    function countBy(data, getKey) {
        const map = new Map();
        data.forEach(item => {
            const key = getKey(item);
            map.set(key, (map.get(key) || 0) + 1);
        });
        return map;
    }

    function getTopEntry(map) {
        return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
    }

    function isHeaderRow(name, order, date, comment) {
        const combined = `${name} ${order} ${date} ${comment}`.toLowerCase();
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

    function isValidOrderNumber(order) {
        return /^\d{5,9}$/.test(order) && !/^[05]/.test(order);
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

    function formatDateKey(dateValue) {
        return new Date(dateValue).toISOString().slice(0, 10);
    }

    function formatDisplayDate(dateValue) {
        return new Date(dateValue).toLocaleDateString();
    }

    function formatShortDate(date) {
        return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' });
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

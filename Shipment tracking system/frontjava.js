document.addEventListener('DOMContentLoaded', () => {
    const csvInput = document.getElementById('csvInput');
    const pickFileBtn = document.getElementById('pickFileBtn');
    const syncServerBtn = document.getElementById('syncServerBtn');
    const resetViewBtn = document.getElementById('resetViewBtn');
    const searchForm = document.getElementById('searchForm');
    const searchInput = document.getElementById('searchBar');
    const orderInputHint = document.getElementById('orderInputHint');
    const phoneNumberNotice = document.getElementById('phoneNumberNotice');
    const uploaderNameInput = document.getElementById('uploaderName');
    const tableBody = document.getElementById('tableBody');
    const fileLabel = document.getElementById('fileLabel');
    const fileCountLabel = document.getElementById('fileCountLabel');
    const serverStatusLabel = document.getElementById('serverStatusLabel');
    const activeFilterLabel = document.getElementById('activeFilterLabel');
    const tableTitle = document.getElementById('tableTitle');
    const rowCountLabel = document.getElementById('rowCountLabel');
    const personButtons = document.getElementById('personButtons');
    const sourceButtons = document.getElementById('sourceButtons');
    const fileList = document.getElementById('fileList');
    const clearFilesBtn = document.getElementById('clearFilesBtn');

    const totalEl = document.getElementById('totalShipments');
    const totalPeopleEl = document.getElementById('totalPeople');
    const totalFilesEl = document.getElementById('totalFiles');
    const latestDateEl = document.getElementById('latestDate');
    const peopleCountLabel = document.getElementById('peopleCountLabel');
    const sourceCountLabel = document.getElementById('sourceCountLabel');

    const allShipmentsBtn = document.getElementById('allShipmentsBtn');
    const peopleBtn = document.getElementById('peopleBtn');
    const filesBtn = document.getElementById('filesBtn');
    const latestDateBtn = document.getElementById('latestDateBtn');

    const API_URL = 'php/api.php';
    const STORAGE_KEYS = {
        csvFiles: 'shipmentTracker.v2.csvFiles',
        uploaderName: 'shipmentTracker.uploaderName',
        sharedSources: 'shipmentTracker.shared.sourceFiles',
        sharedRows: 'shipmentTracker.shared.performanceRows.v2'
    };

    let sourceFiles = [];
    let allData = [];
    let skippedPhoneNumberCount = 0;
    let backendAvailable = false;
    let latestDateFilterValue = null;
    let currentFilter = {
        type: 'all',
        label: 'All Current Shipments'
    };

    pickFileBtn.addEventListener('click', () => csvInput.click());
    csvInput.addEventListener('change', handleFileInputChange);
    syncServerBtn.addEventListener('click', () => refreshDatabase(true));
    resetViewBtn.addEventListener('click', resetView);
    clearFilesBtn.addEventListener('click', removeCurrentUploaderFile);
    searchForm.addEventListener('submit', handleSearchSubmit);
    searchInput.addEventListener('input', handleSearchInput);
    uploaderNameInput.addEventListener('input', handleUploaderNameChange);
    allShipmentsBtn.addEventListener('click', () => setFilter({ type: 'all', label: 'All Current Shipments' }));
    peopleBtn.addEventListener('click', () => setFilter({ type: 'all', label: 'All Names' }));
    filesBtn.addEventListener('click', () => setFilter({ type: 'all', label: 'All CSV Files' }));
    latestDateBtn.addEventListener('click', showLatestDate);

    initializeApp();

    async function initializeApp() {
        restoreUploaderName();
        const loadedFromDatabase = await refreshDatabase(false);

        if (!loadedFromDatabase) {
            const restored = restoreSavedCopies();
            if (!restored) {
                rebuildData();
                updateFileLabel('Loaded');
            }
        }
    }

    function restoreUploaderName() {
        const savedName = getStorageItem(STORAGE_KEYS.uploaderName);
        if (savedName) uploaderNameInput.value = savedName;
    }

    function handleUploaderNameChange() {
        setStorageItem(STORAGE_KEYS.uploaderName, getUploaderName());
        renderFileList();
    }

    async function handleFileInputChange(event) {
        const files = Array.from(event.target.files || []);
        if (files.length === 0) return;

        const serverReady = backendAvailable || await refreshDatabase(false);

        if (serverReady) {
            const uploaderName = getUploaderName();
            if (!uploaderName) {
                window.alert('Please enter your name before uploading a CSV file.');
                event.target.value = '';
                return;
            }

            try {
                for (const file of files) {
                    await uploadFileToServer(file, uploaderName);
                }
                await refreshDatabase(true);
            } catch (error) {
                console.error(error);
                window.alert(error.message || 'The CSV file could not be uploaded.');
            }
        } else {
            await loadFromUploadedFiles(files);
        }

        event.target.value = '';
    }

    async function uploadFileToServer(file, uploaderName) {
        const formData = new FormData();
        formData.append('uploader_name', uploaderName);
        formData.append('csv_file', file, file.name);

        const response = await fetch(`${API_URL}?action=upload`, {
            method: 'POST',
            body: formData
        });
        const payload = await readJsonResponse(response);

        if (!payload.ok) {
            throw new Error(payload.error || 'The server rejected the upload.');
        }
    }

    async function refreshDatabase(showErrors) {
        setServerStatus('Checking database', 'checking');

        try {
            const response = await fetch(`${API_URL}?action=list`, { cache: 'no-store' });
            const payload = await readJsonResponse(response);

            if (!payload.ok) {
                throw new Error(payload.error || 'The database is not available.');
            }

            backendAvailable = true;
            sourceFiles = mapServerFiles(payload.files || []);
            saveSharedSourceCache(sourceFiles);
            clearSharedRowsCache();
            setServerStatus('Database connected', 'online');
            rebuildData();
            updateFileLabel('Database');
            return true;
        } catch (error) {
            backendAvailable = false;
            setServerStatus('Local CSV mode', 'offline');

            if (showErrors) {
                console.error(error);
                window.alert('The PHP database could not be reached. The page is still available in local CSV mode.');
            }

            return false;
        }
    }

    async function readJsonResponse(response) {
        let payload = null;

        try {
            payload = await response.json();
        } catch (error) {
            throw new Error('The server returned an invalid response.');
        }

        if (!response.ok) {
            throw new Error(payload && payload.error ? payload.error : 'The server request failed.');
        }

        return payload;
    }

    function mapServerFiles(files) {
        return files.map(file => {
            const updatedAt = Date.parse(file.updated_at || file.uploaded_at || '');
            const fileName = cleanCell(file.original_filename) || `${cleanCell(file.uploader_name) || 'uploaded'}.csv`;

            return {
                id: `server:${file.id}`,
                name: fileName,
                text: String(file.csv_text || ''),
                lastModified: Number.isNaN(updatedAt) ? Date.now() : updatedAt,
                size: Number(file.file_size) || String(file.csv_text || '').length,
                database: true,
                serverId: Number(file.id),
                uploaderName: cleanCell(file.uploader_name),
                uploaderKey: cleanCell(file.uploader_key)
            };
        });
    }

    async function loadFromUploadedFiles(files) {
        const loadedFiles = await Promise.all(files.map(async file => ({
            id: createFileId(file.name, file.lastModified || Date.now(), file.size || 0),
            name: file.name,
            text: await readFileText(file),
            lastModified: file.lastModified || Date.now(),
            size: file.size || 0,
            database: false,
            uploaderName: getUploaderName()
        })));

        addOrReplaceSourceFiles(loadedFiles);
        saveSharedSourceCache(sourceFiles);
        clearSharedRowsCache();
        saveCSVCopies();
        rebuildData();
        updateFileLabel('Loaded');
    }

    function readFileText(file) {
        if (file.text) return file.text();

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = event => resolve(event.target.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file, 'UTF-8');
        });
    }

    function addOrReplaceSourceFiles(files) {
        const fileMap = new Map(sourceFiles.map(file => [file.id, file]));

        files.forEach(file => {
            fileMap.set(file.id, file);
        });

        sourceFiles = Array.from(fileMap.values());
    }

    function resetView() {
        searchInput.value = '';
        updateOrderInputHint();
        setFilter({ type: 'all', label: 'All Current Shipments' });
        if (backendAvailable) refreshDatabase(false);
    }

    async function removeCurrentUploaderFile() {
        const uploaderName = getUploaderName();

        if (backendAvailable) {
            if (!uploaderName) {
                window.alert('Enter your name to remove your stored CSV file.');
                return;
            }

            try {
                const formData = new FormData();
                formData.append('uploader_name', uploaderName);
                const response = await fetch(`${API_URL}?action=delete`, {
                    method: 'POST',
                    body: formData
                });
                const payload = await readJsonResponse(response);

                if (!payload.ok) throw new Error(payload.error || 'Your CSV file could not be removed.');
                await refreshDatabase(true);
            } catch (error) {
                console.error(error);
                window.alert(error.message || 'Your CSV file could not be removed.');
            }
            return;
        }

        sourceFiles = [];
        saveSharedSourceCache(sourceFiles);
        clearSharedRowsCache();
        saveCSVCopies();
        rebuildData();
        updateFileLabel('Loaded');
    }

    function handleSearchSubmit(event) {
        event.preventDefault();
        const query = searchInput.value.trim();

        if (!query) {
            setFilter({ type: 'all', label: 'All Current Shipments' });
            return;
        }

        if (isNumericEntry(query) && !isAllowedShipmentNumber(query)) {
            updateOrderInputHint();
            return;
        }

        currentFilter = {
            type: 'search',
            query,
            label: `Search: ${query}`
        };
        refreshCurrentView();
    }

    function handleSearchInput() {
        const value = searchInput.value;
        const digitsOnly = value.replace(/\D/g, '');

        if (digitsOnly && digitsOnly.length === value.length) {
            searchInput.value = digitsOnly.slice(0, 9);
        }

        updateOrderInputHint();
    }

    function showLatestDate() {
        if (latestDateFilterValue === null) {
            setFilter({ type: 'all', label: 'All Current Shipments' });
            return;
        }

        setFilter({
            type: 'latest-date',
            dateValue: latestDateFilterValue,
            label: `Latest Date: ${latestDateEl.textContent}`
        });
    }

    function setFilter(filter) {
        searchInput.value = '';
        currentFilter = filter;
        refreshCurrentView();
    }

    function rebuildData() {
        const shipmentHistory = [];
        let sequence = 0;

        skippedPhoneNumberCount = 0;
        sourceFiles.forEach((sourceFile, fileIndex) => {
            const rows = parseCSVRows(sourceFile.text);

            rows.forEach((columns, rowIndex) => {
                const extractedRows = extractShipmentRows(columns, sourceFile);

                extractedRows.forEach(row => {
                    shipmentHistory.push({
                        name: row.name || 'Unassigned',
                        order: row.order,
                        date: row.date,
                        comment: row.comment,
                        source: row.source,
                        fileName: sourceFile.name,
                        uploadedBy: sourceFile.uploaderName || '',
                        dateValue: parseShipmentDate(row.date),
                        fileIndex,
                        rowIndex,
                        sequence
                    });
                    sequence++;
                });
            });
        });

        allData = getLatestShipments(shipmentHistory);
        updateDashboard();
        updateOrderInputHint();
        refreshCurrentView();
    }

    function getLatestShipments(shipmentHistory) {
        const latestByOrder = new Map();

        shipmentHistory.forEach(item => {
            const existing = latestByOrder.get(item.order);
            if (isNewerShipment(item, existing)) {
                latestByOrder.set(item.order, item);
            }
        });

        return Array.from(latestByOrder.values())
            .sort(sortShipmentsForDisplay)
            .map(item => ({
                name: item.name,
                order: item.order,
                date: item.date,
                comment: item.comment,
                source: item.source,
                fileName: item.fileName,
                uploadedBy: item.uploadedBy,
                dateValue: item.dateValue,
                sequence: item.sequence
            }));
    }

    function isNewerShipment(candidate, existing) {
        if (!existing) return true;

        const candidateDate = candidate.dateValue;
        const existingDate = existing.dateValue;

        if (candidateDate !== null && existingDate !== null && candidateDate !== existingDate) {
            return candidateDate > existingDate;
        }

        if (candidateDate !== null && existingDate === null) return true;
        if (candidateDate === null && existingDate !== null) return false;

        return candidate.sequence > existing.sequence;
    }

    function sortShipmentsForDisplay(a, b) {
        if (a.dateValue !== null && b.dateValue !== null && a.dateValue !== b.dateValue) {
            return b.dateValue - a.dateValue;
        }

        if (a.dateValue !== null && b.dateValue === null) return -1;
        if (a.dateValue === null && b.dateValue !== null) return 1;

        return b.sequence - a.sequence;
    }

    function updateDashboard() {
        const summary = getSummary(allData);

        latestDateFilterValue = summary.latestDateValue;
        totalEl.textContent = allData.length;
        totalPeopleEl.textContent = summary.people.size;
        totalFilesEl.textContent = sourceFiles.length;
        latestDateEl.textContent = summary.latestDateText;
        peopleCountLabel.textContent = `${summary.people.size} ${summary.people.size === 1 ? 'name' : 'names'}`;
        sourceCountLabel.textContent = `${summary.sources.size} ${summary.sources.size === 1 ? 'file' : 'files'}`;

        renderBreakdownButtons({
            container: personButtons,
            breakdown: summary.people,
            emptyText: 'No shipment names found in the current CSV files.',
            filterType: 'person',
            labelPrefix: 'Name'
        });

        renderBreakdownButtons({
            container: sourceButtons,
            breakdown: summary.sources,
            emptyText: 'No CSV file names found in the current data.',
            filterType: 'source',
            labelPrefix: 'CSV'
        });

        updateActiveButtons();
    }

    function getSummary(data) {
        const summary = {
            people: new Map(),
            sources: new Map(),
            latestDateValue: null,
            latestDateText: '-'
        };

        data.forEach(item => {
            incrementMap(summary.people, item.name || 'Unassigned');
            incrementMap(summary.sources, item.source || item.fileName || 'Unknown CSV');

            if (item.dateValue !== null && (summary.latestDateValue === null || item.dateValue > summary.latestDateValue)) {
                summary.latestDateValue = item.dateValue;
                summary.latestDateText = item.date || formatDateValue(item.dateValue);
            }
        });

        return summary;
    }

    function incrementMap(map, key) {
        map.set(key, (map.get(key) || 0) + 1);
    }

    function renderBreakdownButtons({ container, breakdown, emptyText, filterType, labelPrefix }) {
        container.innerHTML = '';

        if (breakdown.size === 0) {
            const emptyState = document.createElement('p');
            emptyState.className = 'empty-state';
            emptyState.textContent = emptyText;
            container.appendChild(emptyState);
            return;
        }

        Array.from(breakdown.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .forEach(([label, total]) => {
                const wrapper = document.createElement('div');
                const button = document.createElement('button');
                const labelEl = document.createElement('span');
                const valueEl = document.createElement('strong');

                wrapper.className = filterType === 'source' ? 'source-breakdown-row' : 'breakdown-row';
                button.type = 'button';
                button.className = 'filter-button';
                button.dataset.filterType = filterType;
                button.dataset.filterValue = label;
                labelEl.textContent = `${labelPrefix}: ${label}`;
                valueEl.textContent = total;

                button.appendChild(labelEl);
                button.appendChild(valueEl);
                button.addEventListener('click', () => {
                    setFilter({
                        type: filterType,
                        value: label,
                        label: `${labelPrefix}: ${label}`
                    });
                });

                wrapper.appendChild(button);

                if (filterType === 'source') {
                    const removeButton = document.createElement('button');
                    removeButton.type = 'button';
                    removeButton.className = 'remove-source-btn';
                    removeButton.textContent = 'Remove';
                    removeButton.title = `Remove ${label}`;
                    removeButton.addEventListener('click', event => {
                        event.stopPropagation();
                        removeSourceByName(label);
                    });
                    wrapper.appendChild(removeButton);
                }

                container.appendChild(wrapper);
            });
    }

    function refreshCurrentView() {
        const visibleRows = getFilteredData();

        tableTitle.textContent = currentFilter.label;
        activeFilterLabel.textContent = currentFilter.label;
        rowCountLabel.textContent = `${visibleRows.length} ${visibleRows.length === 1 ? 'row' : 'rows'}`;
        renderTable(visibleRows);
        updateActiveButtons();
    }

    function getFilteredData() {
        if (currentFilter.type === 'search') {
            const query = currentFilter.query.toLowerCase();
            return allData.filter(item => {
                return item.name.toLowerCase().includes(query) ||
                    item.order.toLowerCase().includes(query) ||
                    item.date.toLowerCase().includes(query) ||
                    (item.comment || '').toLowerCase().includes(query) ||
                    item.source.toLowerCase().includes(query) ||
                    item.fileName.toLowerCase().includes(query) ||
                    item.uploadedBy.toLowerCase().includes(query);
            });
        }

        if (currentFilter.type === 'person') {
            return allData.filter(item => item.name === currentFilter.value);
        }

        if (currentFilter.type === 'source') {
            return allData.filter(item => item.source === currentFilter.value);
        }

        if (currentFilter.type === 'latest-date') {
            return allData.filter(item => item.dateValue === currentFilter.dateValue);
        }

        return allData;
    }

    function renderTable(data) {
        tableBody.innerHTML = '';

        if (data.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 5;
            td.className = 'placeholder-text';
            td.textContent = sourceFiles.length === 0
                ? 'Load one or more CSV files to begin.'
                : 'No shipments match this view.';
            tr.appendChild(td);
            tableBody.appendChild(tr);
            return;
        }

        data.forEach(item => {
            const tr = document.createElement('tr');
            const nameCell = document.createElement('td');
            const nameText = document.createElement('strong');
            const orderCell = document.createElement('td');
            const orderText = document.createElement('a');
            const dateCell = document.createElement('td');
            const commentCell = document.createElement('td');
            const sourceCell = document.createElement('td');
            const sourceText = document.createElement('span');

            nameCell.className = 'name-cell';
            nameText.textContent = item.name || 'Unassigned';
            orderText.className = 'shipment-link';
            orderText.href = `shipment.html?order=${encodeURIComponent(item.order)}`;
            orderText.textContent = item.order;
            dateCell.textContent = item.date || 'No date';
            commentCell.className = 'comment-cell';
            commentCell.textContent = item.comment || '-';
            sourceText.className = 'source-pill';
            sourceText.textContent = item.source || item.fileName || '-';

            nameCell.appendChild(nameText);
            orderCell.appendChild(orderText);
            sourceCell.appendChild(sourceText);
            tr.appendChild(nameCell);
            tr.appendChild(orderCell);
            tr.appendChild(dateCell);
            tr.appendChild(commentCell);
            tr.appendChild(sourceCell);
            tableBody.appendChild(tr);
        });
    }

    function updateActiveButtons() {
        document.querySelectorAll('.stat-card, .filter-button').forEach(button => {
            button.classList.remove('is-active');
        });

        if (currentFilter.type === 'all') {
            allShipmentsBtn.classList.add('is-active');
            if (currentFilter.label === 'All Names') peopleBtn.classList.add('is-active');
            if (currentFilter.label === 'All CSV Files') filesBtn.classList.add('is-active');
        } else if (currentFilter.type === 'latest-date') {
            latestDateBtn.classList.add('is-active');
        } else if (currentFilter.type === 'person' || currentFilter.type === 'source') {
            document.querySelectorAll(`[data-filter-type="${currentFilter.type}"]`).forEach(button => {
                if (button.dataset.filterValue === currentFilter.value) {
                    button.classList.add('is-active');
                }
            });
        }
    }

    function updateFileLabel(prefix) {
        if (sourceFiles.length === 0) {
            fileLabel.textContent = backendAvailable ? 'Database connected with no CSV files yet' : 'No CSV files loaded';
            fileCountLabel.textContent = '0 files connected';
            renderFileList();
            return;
        }

        const latestModified = Math.max(...sourceFiles.map(file => Number(file.lastModified) || 0));
        const names = sourceFiles.map(file => file.name);
        const displayNames = names.slice(0, 2).join(', ');
        const extraCount = names.length > 2 ? ` + ${names.length - 2} more` : '';
        const modifiedText = latestModified ? new Date(latestModified).toLocaleString() : 'unknown time';
        const fileWord = sourceFiles.length === 1 ? 'file' : 'files';

        fileLabel.textContent = `${prefix}: ${displayNames}${extraCount} (${sourceFiles.length} ${fileWord}, updated ${modifiedText})`;
        fileCountLabel.textContent = `${sourceFiles.length} ${fileWord} connected`;
        renderFileList();
    }

    function renderFileList() {
        fileList.innerHTML = '';

        if (sourceFiles.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.className = 'empty-state';
            emptyState.textContent = 'No CSV files loaded.';
            fileList.appendChild(emptyState);
            clearFilesBtn.disabled = true;
            return;
        }

        const activeUploaderKey = normalizeUploaderKey(getUploaderName());
        clearFilesBtn.disabled = backendAvailable
            ? !activeUploaderKey || !sourceFiles.some(file => file.database && file.uploaderKey === activeUploaderKey)
            : sourceFiles.length === 0;

        sourceFiles.forEach(file => {
            const item = document.createElement('div');
            const details = document.createElement('div');
            const name = document.createElement('strong');
            const meta = document.createElement('span');
            const removeBtn = document.createElement('button');
            const canRemove = !file.database || (file.uploaderKey && file.uploaderKey === activeUploaderKey);

            item.className = 'file-item';
            details.className = 'file-details';
            name.textContent = file.uploaderName ? `${file.uploaderName} - ${file.name}` : file.name;
            meta.textContent = `${file.database ? 'Database copy' : 'Local copy'} - ${formatFileSize(file.size)} - ${formatModifiedTime(file.lastModified)}`;
            removeBtn.type = 'button';
            removeBtn.className = 'remove-file-btn';
            removeBtn.textContent = canRemove ? 'Remove' : 'Other user';
            removeBtn.disabled = !canRemove;
            removeBtn.addEventListener('click', () => removeSourceFile(file));

            details.appendChild(name);
            details.appendChild(meta);
            item.appendChild(details);
            item.appendChild(removeBtn);
            fileList.appendChild(item);
        });
    }

    async function removeSourceFile(file) {
        if (!file) return;

        if (file.database) {
            const uploaderName = getUploaderName();
            if (!uploaderName || file.uploaderKey !== normalizeUploaderKey(uploaderName)) return;
            await removeCurrentUploaderFile();
            return;
        }

        sourceFiles = sourceFiles.filter(sourceFile => sourceFile.id !== file.id);
        saveSharedSourceCache(sourceFiles);
        clearSharedRowsCache();
        saveCSVCopies();
        rebuildData();
        updateFileLabel('Loaded');
    }

    async function removeSourceByName(sourceName) {
        const filesToRemove = sourceFiles.filter(file => fileMatchesSourceName(file, sourceName));

        if (filesToRemove.length === 0) {
            window.alert('No CSV file was found for this source.');
            return;
        }

        if (!window.confirm(`Remove ${sourceName} from the tracker?`)) return;

        for (const file of filesToRemove) {
            if (file.database) {
                const uploaderName = getUploaderName();
                if (!uploaderName || file.uploaderKey !== normalizeUploaderKey(uploaderName)) {
                    window.alert('Enter the same name used to upload this CSV before removing it.');
                    return;
                }

                await removeCurrentUploaderFile();
                return;
            }
        }

        sourceFiles = sourceFiles.filter(file => !filesToRemove.includes(file));
        saveSharedSourceCache(sourceFiles);
        clearSharedRowsCache();
        saveCSVCopies();
        rebuildData();
        updateFileLabel('Loaded');
    }

    function fileMatchesSourceName(file, sourceName) {
        const target = cleanCell(sourceName);
        if (!target) return false;
        if (file.name === target) return true;

        return parseCSVRows(file.text).some(columns => {
            return extractShipmentRows(columns, file, false).some(row => row.source === target);
        });
    }

    function saveCSVCopies() {
        const localFiles = sourceFiles
            .filter(file => !file.database)
            .map(file => ({
                id: file.id,
                name: file.name,
                text: file.text,
                lastModified: file.lastModified,
                size: file.size,
                uploaderName: file.uploaderName || ''
            }));

        setStorageItem(STORAGE_KEYS.csvFiles, JSON.stringify(localFiles));
    }

    function saveSharedSourceCache(files) {
        const lightFiles = files.map(file => ({
            name: file.name || 'CSV file',
            text: file.text || '',
            uploaderName: file.uploaderName || ''
        }));

        setStorageItem(STORAGE_KEYS.sharedSources, JSON.stringify({
            savedAt: Date.now(),
            files: lightFiles
        }));
    }

    function clearSharedRowsCache() {
        try {
            sessionStorage.removeItem(STORAGE_KEYS.sharedRows);
        } catch (error) {
            console.warn('Could not clear shared performance cache.', error);
        }
    }

    function restoreSavedCopies() {
        const savedFilesText = getStorageItem(STORAGE_KEYS.csvFiles);
        if (!savedFilesText) return false;

        try {
            const savedFiles = JSON.parse(savedFilesText);
            if (!Array.isArray(savedFiles) || savedFiles.length === 0) return false;

            sourceFiles = savedFiles
                .filter(file => file && typeof file.text === 'string')
                .map(file => ({
                    name: file.name || 'saved CSV file',
                    id: file.id || createFileId(file.name || 'saved CSV file', Number(file.lastModified) || 0, Number(file.size) || file.text.length),
                    text: file.text,
                    lastModified: Number(file.lastModified) || 0,
                    size: Number(file.size) || file.text.length,
                    database: false,
                    uploaderName: file.uploaderName || ''
                }));

            if (sourceFiles.length === 0) return false;
            saveSharedSourceCache(sourceFiles);
            clearSharedRowsCache();
            rebuildData();
            updateFileLabel('Saved');
            return true;
        } catch (error) {
            console.warn('Could not restore saved CSV copies.', error);
            return false;
        }
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
            jan: 0, january: 0,
            feb: 1, february: 1,
            mar: 2, march: 2,
            apr: 3, april: 3,
            may: 4,
            jun: 5, june: 5,
            jul: 6, july: 6,
            aug: 7, august: 7,
            sep: 8, sept: 8, september: 8,
            oct: 9, october: 9,
            nov: 10, november: 10,
            dec: 11, december: 11
        };

        let match = text.match(/^(\d{1,2})[\s/-]+([A-Za-z]+)(?:[\s,/-]+(\d{2,4}))?$/);
        if (match) {
            const day = Number(match[1]);
            const month = monthNames[match[2].toLowerCase()];
            const year = normalizeYear(match[3] || currentYear);
            return buildDateValue(year, month, day);
        }

        match = text.match(/^([A-Za-z]+)[\s/-]+(\d{1,2})(?:[\s,/-]+(\d{2,4}))?$/);
        if (match) {
            const month = monthNames[match[1].toLowerCase()];
            const day = Number(match[2]);
            const year = normalizeYear(match[3] || currentYear);
            return buildDateValue(year, month, day);
        }

        match = text.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
        if (match) {
            const day = Number(match[1]);
            const month = Number(match[2]) - 1;
            const year = normalizeYear(match[3] || currentYear);
            return buildDateValue(year, month, day);
        }

        const parsed = Date.parse(text);
        return Number.isNaN(parsed) ? null : parsed;
    }

    function extractShipmentRows(columns, sourceFile, countPhoneNumbers = true) {
        if (columns.length < 3) return [];

        const directRow = buildShipmentRow(columns, 0, sourceFile, countPhoneNumbers);
        if (directRow) return [directRow];

        const rows = [];
        const seen = new Set();

        for (let index = 1; index <= columns.length - 3; index++) {
            const row = buildShipmentRow(columns, index, sourceFile, countPhoneNumbers);
            if (!row) continue;

            const key = `${row.name}|${row.order}|${row.date}|${row.comment}|${row.source}`;
            if (seen.has(key)) continue;

            seen.add(key);
            rows.push(row);
        }

        return rows;
    }

    function buildShipmentRow(columns, startIndex, sourceFile, countPhoneNumbers = true) {
        const name = cleanCell(columns[startIndex]);
        const order = cleanOrderNumber(columns[startIndex + 1]);
        let date = cleanCell(columns[startIndex + 2]);
        let comment = cleanCell(columns[startIndex + 3]);
        let csvFileName = resolveCsvFileName(columns[startIndex + 4], sourceFile.name);

        if (!hasDateValue(date) && hasDateValue(comment)) {
            const oldComment = date;
            date = comment;
            comment = oldComment;
            csvFileName = resolveCsvFileName(columns[startIndex + 4], sourceFile.name);
        } else if (!cleanCell(columns[startIndex + 4]) && isCsvFileName(comment)) {
            csvFileName = resolveCsvFileName(comment, sourceFile.name);
            comment = '';
        } else if (!comment && columns.length <= startIndex + 4) {
            csvFileName = resolveCsvFileName(columns[startIndex + 3], sourceFile.name);
        }

        if (isHeaderRow(name, order, date, comment, csvFileName)) return null;
        if (!isLikelyName(name)) return null;
        if (countPhoneNumbers && isPhoneNumberEntry(order)) {
            skippedPhoneNumberCount++;
            return null;
        }
        if (!isValidOrderNumber(order)) return null;

        return {
            name,
            order,
            date,
            comment,
            source: csvFileName
        };
    }

    function normalizeYear(value) {
        const year = Number(value);
        if (!Number.isFinite(year)) return new Date().getFullYear();
        return year < 100 ? 2000 + year : year;
    }

    function buildDateValue(year, month, day) {
        if (!Number.isInteger(month) || !Number.isFinite(day)) return null;

        const date = new Date(Date.UTC(year, month, day));
        if (
            date.getUTCFullYear() !== year ||
            date.getUTCMonth() !== month ||
            date.getUTCDate() !== day
        ) {
            return null;
        }

        return date.getTime();
    }

    function formatDateValue(dateValue) {
        if (dateValue === null) return '-';
        return new Date(dateValue).toLocaleDateString();
    }

    function formatFileSize(size) {
        const bytes = Number(size) || 0;
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function formatModifiedTime(lastModified) {
        const time = Number(lastModified) || 0;
        return time ? `updated ${new Date(time).toLocaleString()}` : 'update time unknown';
    }

    function isHeaderRow(name, order, date, comment, csvFile) {
        const combined = `${name} ${order} ${date} ${comment} ${csvFile}`.toLowerCase();
        return /\border\b/.test(combined) && /\bdate\b/.test(combined);
    }

    function hasDateValue(value) {
        return parseShipmentDate(value) !== null;
    }

    function updateOrderInputHint() {
        const query = cleanCell(searchInput.value);

        orderInputHint.classList.remove('is-warning');
        orderInputHint.textContent = 'Order numbers must be 5 to 9 digits.';

        if (isNumericEntry(query)) {
            if (isPhoneNumberEntry(query)) {
                orderInputHint.classList.add('is-warning');
                orderInputHint.textContent = 'This looks like a phone number, not a shipment number.';
            } else if (!isAllowedShipmentNumber(query)) {
                orderInputHint.classList.add('is-warning');
                orderInputHint.textContent = 'Shipment/order number must be between 5 and 9 digits.';
            }
        }

        phoneNumberNotice.textContent = skippedPhoneNumberCount > 0
            ? `${skippedPhoneNumberCount} phone ${skippedPhoneNumberCount === 1 ? 'number was' : 'numbers were'} detected in the CSV and not counted as shipments.`
            : '';
    }

    function isNumericEntry(value) {
        return /^\d+$/.test(cleanCell(value));
    }

    function isAllowedShipmentNumber(value) {
        const digits = cleanOrderNumber(value);
        return /^\d{5,9}$/.test(digits) && !isPhoneNumberEntry(digits);
    }

    function isPhoneNumberEntry(value) {
        const digits = cleanOrderNumber(value);
        return /^\d{5,}$/.test(digits) && /^[05]/.test(digits);
    }

    function isLikelyName(value) {
        const text = cleanCell(value);
        const normalized = text.toLowerCase().replace(/\s+/g, ' ');
        const blockedValues = new Set([
            'comment',
            'customer name',
            'csr name',
            'date',
            'details',
            'inbound',
            'inbound/outbound',
            'located',
            'mobile number',
            'mobile number 2',
            'name',
            'no response',
            'order no',
            'order number',
            'outbound',
            'status',
            'time'
        ]);

        return Boolean(text && !/^\d+$/.test(text) && !blockedValues.has(normalized));
    }

    function isValidOrderNumber(order) {
        return isAllowedShipmentNumber(order) && !/\border\b/i.test(order);
    }

    function resolveCsvFileName(value, fallbackName) {
        const text = cleanCell(value);

        if (isCsvFileName(text)) {
            return text;
        }

        return fallbackName || 'CSV file';
    }

    function isCsvFileName(value) {
        const text = cleanCell(value);
        const normalized = text.toLowerCase();
        return Boolean(text && (normalized.includes('csv') || /\.csv$/i.test(text)));
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

    function getUploaderName() {
        return cleanCell(uploaderNameInput.value);
    }

    function normalizeUploaderKey(value) {
        return cleanCell(value).toLowerCase().replace(/\s+/g, ' ');
    }

    function createFileId(name, lastModified, size) {
        return `${cleanCell(name) || 'CSV file'}::${Number(lastModified) || 0}::${Number(size) || 0}`;
    }

    function setServerStatus(text, state) {
        serverStatusLabel.textContent = text;
        serverStatusLabel.classList.remove('is-online', 'is-offline');
        if (state === 'online') serverStatusLabel.classList.add('is-online');
        if (state === 'offline') serverStatusLabel.classList.add('is-offline');
    }

    function setStorageItem(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch (error) {
            console.warn('Browser storage is not available.', error);
        }
    }

    function getStorageItem(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (error) {
            console.warn('Browser storage is not available.', error);
            return null;
        }
    }
});

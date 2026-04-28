let _customLabTemplatesCache = [];
let _customLabTemplatesLoading = false;
let _customLabTemplatesLoaded = false;

async function loadCustomLabTemplates() {
    if (_customLabTemplatesLoading) return;
    _customLabTemplatesLoading = true;

    const container = document.getElementById("customLabTemplatesList");
    if (container) container.innerHTML = '<p style="color: var(--text-muted);">Načítám...</p>';

    try {
        const res = await fetch(`${API_BASE}/labtemplates`, { headers: getHeaders() });
        if (!res.ok) throw new Error(await res.text());
        const all = await res.json();
        _customLabTemplatesCache = all.filter(t => t.isCustom);
        _renderCustomLabTemplates(_customLabTemplatesCache);
        _populateCustomLabOptions(all);
    } catch (err) {
        if (container) container.innerHTML = `<p style="color:#dc2626;">Chyba: ${escapeHtml(err.message)}</p>`;
    } finally {
        _customLabTemplatesLoading = false;
        _customLabTemplatesLoaded = true;
    }
}

function _renderCustomLabTemplates(templates) {
    const container = document.getElementById("customLabTemplatesList");
    if (!container) return;

    if (!templates.length) {
        container.innerHTML = '<p style="color: var(--text-muted);">Zatím žádné custom lab images. Vytvořte první pomocí formuláře výše.</p>';
        return;
    }

    const rows = templates.map(t => `
        <tr>
            <td style="font-weight: 600;">${escapeHtml(t.title)}</td>
            <td><span style="background: #dbeafe; color: #2563eb; padding: 2px 8px; border-radius: 12px; font-size: 12px;">Custom</span></td>
            <td style="font-size: 13px; color: var(--text-muted);">${escapeHtml(_baseImageLabel(t.baseImage))}</td>
            <td style="font-size: 13px; color: var(--text-muted);">${escapeHtml(t.description || '—')}</td>
            <td style="font-size: 13px; color: var(--text-muted);">${t.initBlobPrefix ? 'Ano' : '—'}</td>
            <td style="font-size: 12px; color: var(--text-muted);">${escapeHtml(t.createdBy || '—')}</td>
            <td style="font-size: 12px; color: var(--text-muted);">${escapeHtml(t.templateId || '')}</td>
            <td style="white-space: nowrap;">
                <button class="btn-small" style="background: #2563eb; padding: 3px 10px; font-size: 12px; margin-right: 4px;"
                    onclick="openImageManagementModal('${escapeHtml(t.templateId)}', '${escapeJsString(t.title)}', '${escapeHtml(t.createdBy || '')}')">Správa image</button>
                <button class="btn-small" style="background: #dc2626; padding: 3px 10px; font-size: 12px;"
                    onclick="deleteCustomLabTemplate('${escapeHtml(t.templateId)}', '${escapeJsString(t.title)}')">Smazat</button>
            </td>
        </tr>
    `).join('');

    container.innerHTML = `
        <div class="table-scroll-wrapper" style="overflow-x: auto; border: 1px solid var(--border-color); border-radius: 8px;">
            <table style="width: 100%; min-width: 700px;">
                <thead>
                    <tr>
                        <th>Název</th>
                        <th>Typ</th>
                        <th>Base image</th>
                        <th>Popis</th>
                        <th>Init</th>
                        <th>Autor</th>
                        <th>ID</th>
                        <th>Akce</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function handleCustomLabFileDrop(event) {
    event.preventDefault();
    const input = document.getElementById('customLabFiles');
    const dt = event.dataTransfer;
    if (!dt.files.length) return;
    // DataTransfer.files is read-only — assign via a new DataTransfer where supported,
    // otherwise fall back to updating just the label (files still available on drop event).
    try {
        const dtr = new DataTransfer();
        for (const f of dt.files) dtr.items.add(f);
        input.files = dtr.files;
    } catch (_) {}
    updateCustomLabDropZoneLabel(dt.files);
}

function updateCustomLabDropZoneLabel(fileList) {
    const label = document.getElementById('customLabDropZoneLabel');
    if (!label) return;
    const files = fileList || document.getElementById('customLabFiles').files;
    if (!files || !files.length) {
        label.textContent = 'Přetáhněte soubory sem nebo klikněte pro výběr';
    } else {
        label.textContent = files.length === 1
            ? files[0].name
            : `${files.length} souborů vybráno`;
    }
}

function _formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function openImageManagementModal(templateId, templateTitle, createdBy) {
    const prev = document.getElementById('_imageManagementModalOverlay');
    if (prev) prev.remove();

    const safeEmail = (currentUserEmail || '').trim().toLowerCase();
    const meUser = typeof allLoadedUsers !== 'undefined'
        ? allLoadedUsers.find(u => u.email && u.email.trim().toLowerCase() === safeEmail)
        : null;
    const isAdmin = (meUser && String(meUser.global_role).toLowerCase() === 'admin')
        || safeEmail === 'admin@unob.cz';
    const canEdit = isAdmin || safeEmail === (createdBy || '').trim().toLowerCase();

    const overlay = document.createElement('div');
    overlay.id = '_imageManagementModalOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;justify-content:center;align-items:center;z-index:9000;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const panel = document.createElement('div');
    panel.style.cssText = 'background:var(--bg-panel);border:2px solid #2563eb;border-radius:12px;padding:24px;width:760px;max-width:96vw;max-height:88vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.25);display:flex;flex-direction:column;gap:14px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    const h3 = document.createElement('h3');
    h3.style.cssText = 'margin:0;color:var(--text-primary);';
    h3.textContent = `Správa image — ${templateTitle}`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-small';
    closeBtn.textContent = 'Zavřít';
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(h3);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'background:var(--bg-status);border-bottom:1px solid var(--border-color);padding:10px 20px;text-align:center;margin:-14px -24px 0;';

    const tabInit = document.createElement('button');
    tabInit.className = 'tab-btn active-tab';
    tabInit.textContent = 'Init script';

    const tabFiles = document.createElement('button');
    tabFiles.className = 'tab-btn';
    tabFiles.textContent = 'Soubory';

    tabBar.appendChild(tabInit);
    tabBar.appendChild(tabFiles);
    panel.appendChild(tabBar);

    // --- Tab content containers ---
    const contentInit = document.createElement('div');
    contentInit.style.cssText = 'padding-top:14px;';
    const contentFiles = document.createElement('div');
    contentFiles.style.cssText = 'display:none;padding-top:14px;';
    panel.appendChild(contentInit);
    panel.appendChild(contentFiles);

    tabInit.onclick = () => {
        contentInit.style.display = '';
        contentFiles.style.display = 'none';
        tabInit.classList.add('active-tab');
        tabFiles.classList.remove('active-tab');
    };
    tabFiles.onclick = () => {
        contentInit.style.display = 'none';
        contentFiles.style.display = '';
        tabFiles.classList.add('active-tab');
        tabInit.classList.remove('active-tab');
        _loadFilesTab(templateId, canEdit, contentFiles);
    };

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // ===================== INIT SCRIPT TAB =====================
    const loadingEl = document.createElement('p');
    loadingEl.style.cssText = 'color:var(--text-muted);margin:0;';
    loadingEl.textContent = 'Načítám init script...';
    contentInit.appendChild(loadingEl);

    let scriptContent = '';
    try {
        const res = await fetch(`${API_BASE}/labtemplates/${encodeURIComponent(templateId)}/init-script`, {
            headers: getHeaders(),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        scriptContent = data.init_script || '';
    } catch (err) {
        loadingEl.style.color = '#dc2626';
        loadingEl.textContent = `Chyba načtení: ${err.message}`;
        return;
    }

    contentInit.removeChild(loadingEl);

    const initLabel = document.createElement('label');
    initLabel.style.cssText = 'font-size:13px;color:var(--text-muted);';
    initLabel.textContent = canEdit ? 'Obsah init scriptu (lze editovat):' : 'Obsah init scriptu (pouze pro čtení):';
    contentInit.appendChild(initLabel);

    const textarea = document.createElement('textarea');
    textarea.rows = 18;
    textarea.value = scriptContent;
    textarea.disabled = !canEdit;
    textarea.style.cssText = 'width:100%;box-sizing:border-box;font-family:monospace;font-size:13px;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-status);color:var(--text-primary);resize:vertical;';
    if (!canEdit) textarea.style.opacity = '0.75';
    contentInit.appendChild(textarea);

    const initFooter = document.createElement('div');
    initFooter.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;align-items:center;margin-top:6px;';

    if (canEdit) {
        const statusEl = document.createElement('span');
        statusEl.style.cssText = 'font-size:13px;color:var(--text-muted);';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn-small';
        saveBtn.style.background = '#2563eb';
        saveBtn.style.color = '#fff';
        saveBtn.textContent = 'Uložit změny';
        saveBtn.onclick = async () => {
            saveBtn.disabled = true;
            statusEl.textContent = 'Ukládám...';
            try {
                const res = await fetch(`${API_BASE}/labtemplates/${encodeURIComponent(templateId)}/init-script`, {
                    method: 'PUT',
                    headers: getHeaders(),
                    body: JSON.stringify({ init_script: textarea.value }),
                });
                if (!res.ok) throw new Error(await res.text());
                statusEl.textContent = '';
                showToast('Init script byl uložen.');
            } catch (err) {
                statusEl.textContent = `Chyba: ${err.message}`;
                statusEl.style.color = '#dc2626';
            } finally {
                saveBtn.disabled = false;
            }
        };

        initFooter.appendChild(statusEl);
        initFooter.appendChild(saveBtn);
    }

    // AI tlačítko (pro všechny — čtecí i editační)
    const aiBtn = document.createElement('button');
    aiBtn.className = 'btn-small';
    aiBtn.style.cssText = 'background:#8b5cf6;color:#fff;display:flex;align-items:center;gap:6px;margin-right:auto;';
    aiBtn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg> AI pomoc`;
    aiBtn.onclick = async () => {
        const tmpl = _customLabTemplatesCache.find(t => t.templateId === templateId);
        const imgBaseImage = tmpl?.baseImage || 'kali';
        // Načteme seznam souborů
        let fileNames = [];
        try {
            const r = await fetch(`${API_BASE}/labtemplates/${encodeURIComponent(templateId)}/files`, { headers: getHeaders() });
            if (r.ok) { const d = await r.json(); fileNames = (d.files || []).map(f => f.name); }
        } catch { }
        openInitScriptAiModal({
            baseImage: imgBaseImage,
            files: fileNames,
            onInsert: script => { textarea.value = script; },
        });
    };
    initFooter.insertBefore(aiBtn, initFooter.firstChild);

    contentInit.appendChild(initFooter);
}

async function _loadFilesTab(templateId, canEdit, container) {
    container.innerHTML = '<p style="color:var(--text-muted);margin:0;">Načítám soubory...</p>';

    let files = [];
    try {
        const res = await fetch(`${API_BASE}/labtemplates/${encodeURIComponent(templateId)}/files`, {
            headers: getHeaders(),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        files = data.files || [];
    } catch (err) {
        container.innerHTML = `<p style="color:#dc2626;margin:0;">Chyba: ${escapeHtml(err.message)}</p>`;
        return;
    }

    container.innerHTML = '';

    if (!files.length) {
        const empty = document.createElement('p');
        empty.style.cssText = 'color:var(--text-muted);margin:0;';
        empty.textContent = 'Žádné soubory (kromě init.sh).';
        container.appendChild(empty);
    } else {
        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;';
        const thead = document.createElement('thead');
        thead.innerHTML = `<tr>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-color);">Název</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--border-color);">Velikost</th>
            ${canEdit ? '<th style="padding:6px 8px;border-bottom:1px solid var(--border-color);"></th>' : ''}
        </tr>`;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        files.forEach(f => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding:6px 8px;color:var(--text-primary);">${escapeHtml(f.name)}</td>
                <td style="padding:6px 8px;text-align:right;color:var(--text-muted);">${_formatFileSize(f.size)}</td>
                ${canEdit ? `<td style="padding:6px 8px;text-align:right;"><button class="btn-small" style="background:#dc2626;padding:2px 8px;font-size:12px;" data-filename="${escapeHtml(f.name)}">Smazat</button></td>` : ''}
            `;
            if (canEdit) {
                tr.querySelector('button').onclick = async (e) => {
                    const btn = e.currentTarget;
                    const fname = btn.dataset.filename;
                    if (!confirm(`Smazat soubor "${fname}"?`)) return;
                    btn.disabled = true;
                    try {
                        const res = await fetch(`${API_BASE}/labtemplates/${encodeURIComponent(templateId)}/files/${encodeURIComponent(fname)}`, {
                            method: 'DELETE',
                            headers: getHeaders(),
                        });
                        if (!res.ok) throw new Error(await res.text());
                        showToast(`Soubor "${fname}" byl smazán.`);
                        _loadFilesTab(templateId, canEdit, container);
                    } catch (err) {
                        showToast(`Chyba: ${err.message}`, true);
                        btn.disabled = false;
                    }
                };
            }
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        container.appendChild(table);
    }

    // Upload section (only for editors)
    if (canEdit) {
        const sep = document.createElement('hr');
        sep.style.cssText = 'border:none;border-top:1px solid var(--border-color);margin:14px 0;';
        container.appendChild(sep);

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.style.display = 'none';
        container.appendChild(fileInput);

        // Drop zone (same style as course materials tab)
        const dropZone = document.createElement('div');
        dropZone.style.cssText = 'border:2px dashed var(--border-color);border-radius:8px;padding:22px 16px;text-align:center;color:var(--text-muted);font-size:13px;cursor:pointer;transition:background 0.2s,border-color 0.2s;margin-bottom:12px;user-select:none;';
        dropZone.innerHTML = `
            <div style="margin-bottom:8px;pointer-events:none;">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><polyline points="9 14 12 17 15 14"/></svg>
            </div>
            <div style="font-weight:bold;color:var(--text-primary);margin-bottom:4px;pointer-events:none;">Přetáhněte soubory sem nebo klikněte pro výběr</div>
            <div style="font-size:11px;pointer-events:none;">Libovolné soubory · max 50 MB celkem</div>`;
        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragenter', e => e.preventDefault());
        dropZone.addEventListener('dragover', e => {
            e.preventDefault();
            dropZone.style.background = 'var(--bg-card-hover)';
            dropZone.style.borderColor = 'var(--btn-primary)';
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.style.background = '';
            dropZone.style.borderColor = '';
        });
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.style.background = '';
            dropZone.style.borderColor = '';
            if (e.dataTransfer.files.length) _doUpload(e.dataTransfer.files);
        });
        container.appendChild(dropZone);

        const uploadStatus = document.createElement('div');
        uploadStatus.style.cssText = 'font-size:13px;color:var(--text-muted);min-height:18px;margin-bottom:6px;';
        container.appendChild(uploadStatus);

        async function _doUpload(fileList) {
            dropZone.style.pointerEvents = 'none';
            uploadStatus.style.color = 'var(--text-muted)';
            uploadStatus.textContent = 'Nahrávám...';
            try {
                const form = new FormData();
                for (const f of fileList) form.append('files', f);
                const headers = getHeaders();
                delete headers['Content-Type'];
                const res = await fetch(`${API_BASE}/labtemplates/${encodeURIComponent(templateId)}/files`, {
                    method: 'POST',
                    headers,
                    body: form,
                });
                if (!res.ok) throw new Error(await res.text());
                uploadStatus.textContent = '';
                fileInput.value = '';
                showToast('Soubory byly nahrány.');
                _loadFilesTab(templateId, canEdit, container);
            } catch (err) {
                uploadStatus.style.color = '#dc2626';
                uploadStatus.textContent = `Chyba: ${err.message}`;
            } finally {
                dropZone.style.pointerEvents = '';
            }
        }

        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) _doUpload(fileInput.files);
        });
    }
}

// ── AI asistent pro init script ──────────────────────────────────────────────

function openInitScriptAiModal({ baseImage = 'kali', files = [], onInsert }) {
    const prev = document.getElementById('_aiInitScriptModalOverlay');
    if (prev) prev.remove();

    const overlay = document.createElement('div');
    overlay.id = '_aiInitScriptModalOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;justify-content:center;align-items:center;z-index:9100;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // --- Panel ---
    const panel = document.createElement('div');
    panel.style.cssText = 'background:var(--bg-panel);border:2px solid #8b5cf6;border-radius:12px;padding:24px;width:700px;max-width:96vw;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:16px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    const h3 = document.createElement('h3');
    h3.style.cssText = 'margin:0;color:var(--text-primary);display:flex;align-items:center;gap:8px;';
    h3.innerHTML = `<svg width="20" height="20" fill="none" stroke="#8b5cf6" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg> AI asistent — init script`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-small';
    closeBtn.textContent = 'Zavřít';
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(h3);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const baseInfo = document.createElement('p');
    baseInfo.style.cssText = 'margin:0;font-size:13px;color:var(--text-muted);';
    baseInfo.textContent = `Base image: ${baseImage === 'kali' ? 'Kali Linux (GUI)' : 'Ubuntu (CLI)'}`;
    panel.appendChild(baseInfo);

    const filesSection = document.createElement('div');
    filesSection.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

    const filesLabel = document.createElement('div');
    filesLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--text-primary);';
    filesLabel.textContent = files.length
        ? 'Nahrané soubory — zadejte kam je umístit v kontejneru:'
        : 'Žádné soubory nebyly nahrány (init script může stahovat z internetu).';
    filesSection.appendChild(filesLabel);

    const pathInputs = {};   // filename -> input element
    files.forEach(fname => {
        const row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:center;';

        const nameEl = document.createElement('span');
        nameEl.style.cssText = 'font-size:13px;font-family:monospace;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        nameEl.title = fname;
        nameEl.textContent = fname;

        const pathEl = document.createElement('input');
        pathEl.type = 'text';
        pathEl.placeholder = `/root/lab/${fname}`;
        pathEl.style.cssText = 'font-size:13px;font-family:monospace;padding:5px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-status);color:var(--text-primary);';

        pathInputs[fname] = pathEl;
        row.appendChild(nameEl);
        row.appendChild(pathEl);
        filesSection.appendChild(row);
    });
    panel.appendChild(filesSection);

    const goalLabel = document.createElement('label');
    goalLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--text-primary);display:block;';
    goalLabel.textContent = 'Co má student v labu dělat / jaký je cíl cvičení?';
    panel.appendChild(goalLabel);

    const goalHint = document.createElement('p');
    goalHint.style.cssText = 'margin:2px 0 4px;font-size:12px;color:var(--text-muted);';
    goalHint.textContent = 'Čím konkrétnější popis, tím přesnější script. Např. „Student najde flag ve skrytém souboru" nebo „Analyzuje malware přes Wireshark".';
    panel.appendChild(goalHint);

    const goalTextarea = document.createElement('textarea');
    goalTextarea.rows = 4;
    goalTextarea.placeholder = 'Popište cíl a kontext labu...';
    goalTextarea.style.cssText = 'width:100%;box-sizing:border-box;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-status);color:var(--text-primary);font-size:13px;resize:vertical;';
    panel.appendChild(goalTextarea);

    const genRow = document.createElement('div');
    genRow.style.cssText = 'display:flex;align-items:center;gap:12px;';

    const genStatus = document.createElement('span');
    genStatus.style.cssText = 'font-size:13px;color:var(--text-muted);';

    const genBtn = document.createElement('button');
    genBtn.className = 'btn-small';
    genBtn.style.cssText = 'background:#8b5cf6;color:#fff;display:flex;align-items:center;gap:6px;';
    genBtn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg> Vygenerovat init script`;

    genRow.appendChild(genStatus);
    genRow.appendChild(genBtn);
    panel.appendChild(genRow);

    // Výsledná oblast (skrytá dokud není vygenerováno)
    const resultSection = document.createElement('div');
    resultSection.style.cssText = 'display:none;flex-direction:column;gap:10px;';

    const resultLabel = document.createElement('div');
    resultLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--text-primary);';
    resultLabel.textContent = 'Navržený init script:';
    resultSection.appendChild(resultLabel);

    const resultTextarea = document.createElement('textarea');
    resultTextarea.rows = 16;
    resultTextarea.style.cssText = 'width:100%;box-sizing:border-box;font-family:monospace;font-size:12px;padding:10px;border-radius:6px;border:1px solid #8b5cf6;background:var(--bg-status);color:var(--text-primary);resize:vertical;';
    resultSection.appendChild(resultTextarea);

    const useRow = document.createElement('div');
    useRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;align-items:center;';

    const regenBtn = document.createElement('button');
    regenBtn.className = 'btn-small';
    regenBtn.textContent = 'Vygenerovat znovu';
    regenBtn.onclick = () => doGenerate();

    const useBtn = document.createElement('button');
    useBtn.className = 'btn-small';
    useBtn.style.cssText = 'background:#10b981;color:#fff;';
    useBtn.textContent = 'Vložit do init scriptu';
    useBtn.onclick = () => {
        if (onInsert) onInsert(resultTextarea.value);
        overlay.remove();
        showToast('Init script byl vložen.');
    };

    useRow.appendChild(regenBtn);
    useRow.appendChild(useBtn);
    resultSection.appendChild(useRow);
    panel.appendChild(resultSection);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    async function doGenerate() {
        const goal = goalTextarea.value.trim();
        const filePaths = {};
        files.forEach(f => {
            const val = pathInputs[f]?.value.trim();
            if (val) filePaths[f] = val;
        });

        genBtn.disabled = true;
        regenBtn.disabled = true;
        genStatus.style.color = 'var(--text-muted)';
        genStatus.textContent = 'Generuji...';
        resultSection.style.display = 'none';

        try {
            const res = await fetch(`${API_BASE}/api/ai/generate-init-script`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ base_image: baseImage, goal, files, file_paths: filePaths }),
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            resultTextarea.value = data.init_script || '';
            genStatus.textContent = '';
            resultSection.style.display = 'flex';
        } catch (err) {
            genStatus.style.color = '#dc2626';
            genStatus.textContent = `Chyba: ${err.message}`;
        } finally {
            genBtn.disabled = false;
            regenBtn.disabled = false;
        }
    }

    genBtn.onclick = () => doGenerate();
}

function _baseImageLabel(baseImage) {
    const map = { kali: 'Kali Linux (GUI)', ubuntu: 'Ubuntu (CLI)' };
    return map[baseImage] || baseImage || '—';
}

function _populateCustomLabOptions(allTemplates) {
    const selects = document.querySelectorAll('#scenarioRequiredOs, #edit_scenarioRequiredOs');
    selects.forEach(sel => {
        // Remove previously added custom optgroup
        const existing = sel.querySelector('optgroup[data-custom="1"]');
        if (existing) existing.remove();

        const custom = allTemplates.filter(t => t.isCustom && t.status === 'active');
        if (!custom.length) return;

        const group = document.createElement('optgroup');
        group.label = 'Custom Lab Images';
        group.dataset.custom = '1';
        custom.forEach(t => {
            const opt = document.createElement('option');
            opt.value = `custom:${t.templateId}`;
            opt.textContent = `${t.title} (Custom)`;
            opt.dataset.labImage = t.labImage;
            opt.dataset.baseImage = t.baseImage || '';
            opt.dataset.title = t.title;
            group.appendChild(opt);
        });
        sel.appendChild(group);
    });
}

async function createCustomLabTemplate() {
    const title = document.getElementById("customLabTitle").value.trim();
    const baseImage = document.getElementById("customLabBaseImage").value;
    const initScript = document.getElementById("customLabInitScript").value;
    const description = document.getElementById("customLabDescription").value.trim();
    const filesInput = document.getElementById("customLabFiles");
    const statusEl = document.getElementById("customLabStatus");
    const btn = document.getElementById("btnCreateCustomLab");

    if (!title) {
        showToast("Vyplňte název lab image.", true);
        return;
    }

    const totalSize = Array.from(filesInput.files).reduce((s, f) => s + f.size, 0);
    if (totalSize > 50 * 1024 * 1024) {
        showToast("Celková velikost souborů nesmí překročit 50 MB.", true);
        return;
    }

    btn.disabled = true;
    if (statusEl) statusEl.textContent = "Vytvářím...";
    showToast(`Vytvářím lab image "${title}"...`);

    try {
        const form = new FormData();
        form.append("title", title);
        form.append("base_image", baseImage);
        form.append("init_script", initScript);
        form.append("description", description);
        for (const f of filesInput.files) {
            form.append("files", f);
        }

        const headers = getHeaders();
        delete headers["Content-Type"];

        const res = await fetch(`${API_BASE}/labtemplates/custom`, {
            method: "POST",
            headers,
            body: form,
        });
        if (!res.ok) throw new Error(await res.text());

        showToast(`Lab image "${title}" byl úspěšně vytvořen.`);
        document.getElementById("customLabTitle").value = "";
        document.getElementById("customLabInitScript").value = "";
        document.getElementById("customLabDescription").value = "";
        filesInput.value = "";
        updateCustomLabDropZoneLabel();
        if (statusEl) statusEl.textContent = "";
        await loadCustomLabTemplates();
    } catch (err) {
        showToast(`Chyba: ${err.message}`, true);
        if (statusEl) statusEl.textContent = "";
    } finally {
        btn.disabled = false;
    }
}

async function deleteCustomLabTemplate(templateId, templateTitle) {
    if (!confirm(`Opravdu smazat lab image "${templateTitle}"?\nToto smaže i všechny nahrané soubory.`)) return;

    try {
        const res = await fetch(`${API_BASE}/labtemplates/${encodeURIComponent(templateId)}`, {
            method: "DELETE",
            headers: getHeaders(),
        });
        if (!res.ok) throw new Error(await res.text());
        showToast(`Lab image "${templateTitle}" byl smazán.`);
        await loadCustomLabTemplates();
    } catch (err) {
        showToast(`Chyba při mazání: ${err.message}`, true);
    }
}

window.API_BASE_MAT = window.API_BASE_MAT || window.API_BASE || "http://127.0.0.1:8000";

function getHeadersMat() {
    // Pro upload NIKDY nenastavuj Content-Type — browser ho nastaví automaticky s boundary
    return { "X-Mock-User": (typeof currentUserEmail !== 'undefined' ? currentUserEmail : "") };
}

function formatFileSize(bytes) {
    if (!bytes) return "–";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(ext) {
    const icons = { pdf:"📄", png:"🖼️", jpg:"🖼️", jpeg:"🖼️", docx:"📝", pptx:"📊", mp4:"🎬", txt:"📃", md:"📃" };
    return icons[ext?.toLowerCase()] || "📎";
}

function escapeHtmlMat(v) {
    return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function formatDateMat(v) {
    if (!v) return "–";
    try { return new Date(v).toLocaleString("cs-CZ"); } catch { return v; }
}

async function loadCourseMaterials(courseId) {
    const container = document.getElementById("matListContainer");
    if (!container) return;
    container.innerHTML = `<div class="muted" style="padding:14px; text-align:center;">Načítám...</div>`;

    try {
        const res = await fetch(`${window.API_BASE_MAT}/courses/${courseId}/materials`, { headers: getHeadersMat() });
        if (!res.ok) throw new Error(await res.text());
        const materials = await res.json();

        if (materials.length === 0) {
            container.innerHTML = `<div class="muted" style="padding:14px; text-align:center;">Žádné materiály zatím nebyly nahrány.</div>`;
            return;
        }

        container.innerHTML = materials.map(m => `
            <div class="mat-row" data-file-id="${m.fileId}"
                style="display:flex; align-items:center; gap:12px; padding:10px 14px; border-bottom:1px solid var(--border-color);">
                <span style="flex-shrink:0; display:inline-flex; width:28px; height:34px;">${getFileIconSvg(m.extension).replace('width="42" height="50"', 'width="28" height="34"')}</span>
                <div style="flex:1; min-width:0;">
                    <div style="font-size:14px; font-weight:bold; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtmlMat(m.originalName)}">${escapeHtmlMat(m.originalName)}</div>
                    <div style="font-size:12px; color:var(--text-muted);">${formatFileSize(m.sizeBytes)} · ${formatDateMat(m.uploadedAt)}</div>
                </div>
                <button onclick="downloadMaterial('${escapeHtmlMat(courseId)}', '${m.fileId}', '${escapeHtmlMat(m.originalName)}')"
                    style="padding:5px 12px; font-size:12px; background:var(--btn-primary); color:white; border:none; border-radius:6px; cursor:pointer; white-space:nowrap; flex-shrink:0;">
                    ⬇ Stáhnout
                </button>
                <button onclick="deleteMaterial('${escapeHtmlMat(courseId)}', '${m.fileId}', this)"
                    style="padding:5px 12px; font-size:12px; background:#ef4444; color:white; border:none; border-radius:6px; cursor:pointer; white-space:nowrap; flex-shrink:0;">
                    🗑 Smazat
                </button>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<div class="warning" style="padding:14px;">Chyba: ${err.message}</div>`;
    }
}

function handleMatDrop(event) {
    event.preventDefault();
    const dropZone = document.getElementById("matDropZone");
    if (dropZone) dropZone.style.background = "";
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) uploadMatFiles(files);
}

function handleMatFileSelect(event) {
    const files = event.target.files;
    if (files && files.length > 0) uploadMatFiles(files);
    event.target.value = "";
}

async function uploadMatFiles(files, courseId = null, silent = false) {
    if (!courseId) courseId = window.activeDetailCourseId;
    if (!courseId) return [];
    const errors = [];

    for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        try {
            const res = await fetch(`${window.API_BASE_MAT}/courses/${courseId}/materials`, {
                method: "POST",
                headers: getHeadersMat(),
                body: formData
            });
            if (!res.ok) {
                let errMsg = res.statusText;
                try {
                    const errData = await res.json();
                    errMsg = errData.detail || JSON.stringify(errData);
                } catch(e) {
                    errMsg = await res.text().catch(() => res.statusText);
                }
                errors.push('"' + file.name + '": ' + errMsg);
                if (!silent) showToast('Chyba u "' + file.name + '": ' + errMsg, true);
            } else {
                if (!silent) {
                    const data = await res.json();
                    showToast('"' + data.originalName + '" nahráno.');
                }
            }
        } catch (err) {
            errors.push('"' + file.name + '": ' + err.message);
            if (!silent) showToast('Chyba: ' + err.message, true);
        }
    }

    if (!silent && window.activeDetailCourseId === courseId) {
        await loadCourseMaterials(courseId);
    }
    return errors;
}

async function downloadMaterial(courseId, fileId, originalName) {
    try {
        const res = await fetch(`${window.API_BASE_MAT}/courses/${courseId}/materials/${fileId}/download`, {
            headers: getHeadersMat()
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const a = document.createElement("a");
        a.href = data.downloadUrl;
        a.download = originalName;
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (err) {
        showToast(`Chyba při stahování: ${err.message}`, true);
    }
}

async function deleteMaterial(courseId, fileId, btn) {
    customConfirm("Smazat soubor", "Opravdu chcete smazat tento soubor? Tato akce je nevratná.", "Smazat", async () => {
        btn.disabled = true;
        btn.textContent = "Mažu…";
        try {
            const res = await fetch(`${window.API_BASE_MAT}/courses/${courseId}/materials/${fileId}`, {
                method: "DELETE",
                headers: getHeadersMat()
            });
            if (!res.ok) throw new Error(await res.text());
            showToast("Soubor byl smazán.");
            const row = document.querySelector(`.mat-row[data-file-id="${fileId}"]`);
            if (row) row.remove();
            const container = document.getElementById("matListContainer");
            if (container && container.querySelectorAll(".mat-row").length === 0) {
                container.innerHTML = '<div class="muted" style="padding:14px; text-align:center;">Žádné materiály zatím nebyly nahrány.</div>';
            }
        } catch (err) {
            btn.disabled = false;
            btn.textContent = "🗑 Smazat";
            showToast("Chyba: " + err.message, true);
        }
    });
}

// Fronta souborů čekajících na nahrání při vytvoření kurzu
window._pendingCourseFiles = [];

function handleNewCourseMatDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    const dropZone = document.getElementById("newCourseDropZone");
    if (dropZone) { dropZone.style.background = ""; dropZone.style.borderColor = "var(--border-color)"; }
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length > 0) addPendingFiles(files);
}

function handleNewCourseMatSelect(event) {
    const files = Array.from(event.target.files || []);
    addPendingFiles(files);
    event.target.value = "";
}

function addPendingFiles(files) {
    window._pendingCourseFiles.push(...files);
    renderPendingFiles();
}

function getFileIconSvg(ext) {
    const colors = { pdf:'#ef4444', docx:'#3b82f6', pptx:'#f97316', png:'#10b981', jpg:'#10b981', jpeg:'#10b981', mp4:'#8b5cf6', txt:'#6b7280', md:'#6b7280' };
    const labels = { pdf:'PDF', docx:'DOC', pptx:'PPT', png:'PNG', jpg:'JPG', jpeg:'JPG', mp4:'MP4', txt:'TXT', md:'MD' };
    const color = colors[ext] || '#6b7280';
    const label = labels[ext] || ext?.toUpperCase() || '?';
    return `<svg width="42" height="50" viewBox="0 0 42 50" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 0 H28 L42 14 V44 Q42 50 36 50 H6 Q0 50 0 44 V6 Q0 0 6 0Z" fill="${color}" opacity="0.15"/>
        <path d="M6 0 H28 L42 14 V44 Q42 50 36 50 H6 Q0 50 0 44 V6 Q0 0 6 0Z" fill="none" stroke="${color}" stroke-width="2"/>
        <path d="M28 0 L28 14 L42 14" fill="none" stroke="${color}" stroke-width="2"/>
        <text x="21" y="34" text-anchor="middle" font-size="11" font-weight="bold" fill="${color}" font-family="sans-serif">${label}</text>
    </svg>`;
}

function renderPendingFiles() {
    const listEl = document.getElementById("newCourseMatList");
    if (!listEl) return;
    if (window._pendingCourseFiles.length === 0) {
        listEl.innerHTML = "";
        return;
    }
    var html = '<div style="display:flex; flex-wrap:wrap; gap:12px; margin-top:8px;">';
    for (var i = 0; i < window._pendingCourseFiles.length; i++) {
        var f = window._pendingCourseFiles[i];
        var ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '';
        html += '<div style="display:flex; flex-direction:column; align-items:center; gap:6px; width:80px; position:relative;">'
            + '<button onclick="removePendingFile(' + i + ')" style="position:absolute; top:-6px; right:-6px; background:#ef4444; border:none; color:white; border-radius:50%; width:18px; height:18px; font-size:12px; cursor:pointer; line-height:1; display:flex; align-items:center; justify-content:center; padding:0; z-index:1;">×</button>'
            + getFileIconSvg(ext)
            + '<div style="font-size:11px; color:var(--text-primary); text-align:center; word-break:break-all; line-height:1.3; max-width:80px;">' + escapeHtmlMat(f.name) + '</div>'
            + '<div style="font-size:10px; color:var(--text-muted);">' + formatFileSize(f.size) + '</div>'
            + '</div>';
    }
    html += '</div>';
    listEl.innerHTML = html;
}

function removePendingFile(index) {
    window._pendingCourseFiles.splice(index, 1);
    renderPendingFiles();
}

// Volá se z createCourse() po úspěšném vytvoření — nahraj čekající soubory
async function uploadPendingMaterials(courseId) {
    if (!window._pendingCourseFiles || window._pendingCourseFiles.length === 0) return null;
    const errors = await uploadMatFiles(window._pendingCourseFiles, courseId, true);
    return errors && errors.length > 0 ? errors.join(', ') : null;
}

const LOG = {
_lines: [],
_write(level, ...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const line = `[${new Date().toISOString().slice(11,23)}] [${level}] ${msg}`;
    this._lines.push(line);
    console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](line);
},
info(...args)  { this._write('INFO',  ...args); },
warn(...args)  { this._write('WARN',  ...args); },
error(...args) { this._write('ERROR', ...args); },
dump() { return this._lines.join('\n'); }
};
function getHeaders() {
    return {
    "Content-Type": "application/json",
    "X-Mock-User": currentUserEmail
    };
}

function toggleSidebar() {
    const sidebar = document.getElementById("courseSidebar");
    const btn = document.getElementById("sidebarToggleBtn");
    const isHidden = sidebar.style.marginLeft === "-280px";
    sidebar.style.marginLeft = isHidden ? "0px" : "-280px";
    btn.style.display = isHidden ? "none" : "block";
}


function performLogin() { sharedPerformLogin(["student", "teacher", "admin"], initApp, "student"); }
function changeMockPassword() { sharedChangeMockPassword(initApp, "student"); }
function logout() { sharedLogout(clearPolling, "student"); }

async function apiGet(path) {
    const response = await fetch(`${API_BASE}${path}`, { headers: getHeaders() });
    if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `GET ${path} failed`);
    }
    return response.json();
}

async function apiPost(path, body) {
    const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body)
    });
    if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `POST ${path} failed`);
    }
    return response.json();
}

async function apiGetText(path) {
    const response = await fetch(`${API_BASE}${path}`, { headers: getHeaders() });
    if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `GET ${path} failed`);
    }
    return response.text();
}

function formatDate(value) {
    if (!value) return "-";
    try {
    return new Date(value).toLocaleString("cs-CZ");
    } catch {
    return value;
    }
}

function parseGradingInfo(hints) {
    let style = 'points'; let max = 10;
    const m = (hints || "").match(/\[GRADING:(points|percent):?(\d+)?\]/);
    if (m) { style = m[1]; if (m[2]) max = parseInt(m[2], 10); }
    return { style, max };
}

function getGradeFromScore(score, gradingInfo) {
    if (score === null || score === undefined || score === "") return "-";
    const s = Number(score);
    const percent = gradingInfo.style === 'percent' ? s : (s / gradingInfo.max) * 100;
    
    if (percent >= 90) return "A";
    if (percent >= 80) return "B";
    if (percent >= 70) return "C";
    if (percent >= 60) return "D";
    if (percent >= 50) return "E";
    return "F";
}

function showToast(message, isError = false, persistent = false) {
    let toast = document.getElementById("studentToast");
    if (!toast) {
    toast = document.createElement("div");
    toast.id = "studentToast";
    toast.style.cssText = "position:fixed; top:-80px; right:20px; padding:12px 20px; border-radius:8px; font-size:14px; font-weight:bold; color:white; z-index:9999; transition:top 0.3s ease; box-shadow:0 4px 12px rgba(0,0,0,0.3); max-width:360px;";
    document.body.appendChild(toast);
    }
    toast.style.background = isError ? "#ef4444" : "#10b981";
    toast.textContent = message;
    toast.style.top = "20px";
    clearTimeout(toast._hideTimer);
    if (!persistent) {
    toast._hideTimer = setTimeout(() => { toast.style.top = "-80px"; }, 3000);
    }
}

function hideToast() {
    const toast = document.getElementById("studentToast");
    if (toast) {
    clearTimeout(toast._hideTimer);
    toast.style.top = "-80px";
    }
}

function escapeHtml(value) {
    return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
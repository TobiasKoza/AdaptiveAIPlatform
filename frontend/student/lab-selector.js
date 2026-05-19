// =============================================================
// LAB SELECTOR MODULE — pouze pro testování
// Zapnout: window.LAB_SELECTOR_ENABLED = true
// Vypnout: window.LAB_SELECTOR_ENABLED = false (výchozí)
// =============================================================

window.LAB_SELECTOR_ENABLED = false;

window.showLabSelectorModal = async function(onConfirm) {
    let modal = document.getElementById('labSelectorModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'labSelectorModal';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;justify-content:center;align-items:center;">
            <div style="background:var(--bg-panel);border:2px solid var(--border-color);border-radius:12px;padding:28px;width:460px;max-width:95%;color:var(--text-muted);font-size:14px;">
                Načítám dostupná prostředí...
            </div>
        </div>`;

    const builtinOptions = [
        {
            id: "full",
            label: "🐉 Kali Linux — plný grafický balíček",
            desc: "Kali XFCE desktop s drakem. Start ~60-90s.",
            labImage: "adaptivekoza01.azurecr.io/adaptive-lab-kali:v2",
            overrideTemplateId: null,
        },
        {
            id: "lite",
            label: "⚡ Kali Linux — bez grafického balíčku",
            desc: "Základní Kali bez témat. Start ~20-40s.",
            labImage: "adaptivekoza01.azurecr.io/adaptive-lab-kali:v1",
            overrideTemplateId: null,
        },
        {
            id: "none",
            label: "🧪 Přeskočit spuštění labu",
            desc: "Lab se nespustí. Pouze pro testování zadání.",
            labImage: null,
            overrideTemplateId: null,
        },
    ];

    let customOptions = [];
    try {
        const headers = typeof getHeaders === 'function' ? getHeaders() : {};
        const base = window.API_BASE || (typeof API_BASE !== 'undefined' ? API_BASE : '');
        const res = await fetch(`${base}/labtemplates`, { headers });
        if (res.ok) {
            const all = await res.json();
            customOptions = all
                .filter(t => t.isCustom && t.status === 'active')
                .map(t => ({
                    id: `custom:${t.templateId}`,
                    label: `🔧 ${t.title}`,
                    desc: `Custom image · ${t.baseImage === 'kali' ? 'Kali Linux' : 'Ubuntu'}${t.description ? ' · ' + t.description : ''}`,
                    labImage: t.baseImage === 'kali'
                        ? "adaptivekoza01.azurecr.io/adaptive-lab-kali:v3"
                        : "adaptivekoza01.azurecr.io/adaptive-lab-kali:ubuntu-v1",
                    overrideTemplateId: t.templateId,
                }));
        }
    } catch (_) {}

    const options = [...builtinOptions.slice(0, 2), ...customOptions, builtinOptions[2]];

    window._labSelectorSelected = options[0].id;

    const _renderOptions = () => options.map((opt, i) => `
        <label id="labsel-label-${i}" style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border:2px solid ${i === 0 ? '#3b82f6' : 'var(--border-color)'};border-radius:8px;cursor:pointer;background:var(--bg-status);">
            <input type="radio" name="labSelectorOption" value="${opt.id}"
                ${i === 0 ? 'checked' : ''}
                style="margin-top:3px;width:16px;height:16px;flex-shrink:0;cursor:pointer;"
                onchange="
                    window._labSelectorSelected='${opt.id}';
                    document.querySelectorAll('[id^=labsel-label-]').forEach(l=>l.style.borderColor='var(--border-color)');
                    document.getElementById('labsel-label-${i}').style.borderColor='#3b82f6';
                ">
            <div>
                <div style="font-size:14px;font-weight:bold;color:var(--text-primary);">${opt.label}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${opt.desc}</div>
            </div>
        </label>
    `).join('');

    modal.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;justify-content:center;align-items:center;">
            <div style="background:var(--bg-panel);border:2px solid var(--border-color);border-radius:12px;padding:28px;width:460px;max-width:95%;box-shadow:0 8px 32px rgba(0,0,0,0.35);">
                <h3 style="margin:0 0 6px 0;color:var(--text-primary);font-size:17px;">Vyberte laboratorní prostředí</h3>
                <p style="margin:0 0 18px 0;font-size:13px;color:var(--text-muted);">Testovací režim — zvolte typ prostředí.</p>

                <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
                    ${_renderOptions()}
                </div>

                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button onclick="document.getElementById('labSelectorModal').innerHTML='';document.getElementById('startBtn').disabled=false;"
                        style="padding:8px 18px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-status);color:var(--text-primary);cursor:pointer;font-size:14px;">
                        Zrušit
                    </button>
                    <button onclick="window._labSelectorConfirm()"
                        style="padding:8px 18px;border-radius:6px;border:none;background:var(--btn-primary);color:white;cursor:pointer;font-size:14px;font-weight:bold;">
                        Spustit
                    </button>
                </div>
            </div>
        </div>`;

    window._labSelectorConfirm = function() {
        const sel = window._labSelectorSelected;
        document.getElementById('labSelectorModal').innerHTML = '';
        const opt = options.find(o => o.id === sel);
        if (!opt || opt.labImage === null) {
            onConfirm(null);   // skip
        } else {
            onConfirm({ labImage: opt.labImage, overrideTemplateId: opt.overrideTemplateId });
        }
    };
};
// Content Queue — Lee's Intel Dashboard
// Airtable-powered content pipeline manager

const CQ = {
    records: [],
    filtered: [],
    activeStatus: 'All',
    BASE_URL: 'https://api.airtable.com/v0',
    MAX_RETRIES: 3,

    get apiKey() { return localStorage.getItem('airtable_api_key') || localStorage.getItem('pinterest_dashboard_airtable_key') || ''; },
    get baseId() {
        const raw = localStorage.getItem('airtable_base_id') || 'appMQ6QuquWCz2uNk';
        // Extract just the appXXX ID in case user pasted a full URL or path
        const match = raw.match(/(app[A-Za-z0-9]+)/);
        return match ? match[1] : raw;
    },
    get headers() { return { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }; },

    // ---- Helpers ----
    fmtNum(n) {
        if (n == null || isNaN(n)) return '0';
        n = Number(n);
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
        return n.toString();
    },
    fmtDate(d) {
        if (!d) return '—';
        const dt = new Date(d);
        if (isNaN(dt)) return '—';
        const now = Date.now(), diff = now - dt.getTime();
        if (diff < 3600000) return Math.max(1, Math.floor(diff / 60000)) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        if (diff < 172800000) return 'Yesterday';
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },
    imgUrl(gid, sz) { return gid ? `https://drive.google.com/thumbnail?id=${gid}&sz=w${sz || 800}` : ''; },
    esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },
    toast(msg, type) {
        const t = document.getElementById('toast');
        t.textContent = msg; t.className = `toast toast-${type || 'success'} show`;
        setTimeout(() => t.classList.remove('show'), 3000);
    },
    loader(on) { document.getElementById('gLoader').classList.toggle('on', on); },

    // ---- API ----
    async fetchAll() {
        let all = [], offset = null, retries = 0;
        do {
            const params = new URLSearchParams();
            if (offset) params.append('offset', offset);
            params.append('sort[0][field]', 'Created_Date');
            params.append('sort[0][direction]', 'desc');
            const url = `${this.BASE_URL}/${this.baseId}/${encodeURIComponent('content_queue')}?${params}`;
            try {
                const res = await fetch(url, { headers: this.headers });
                if (res.status === 429) {
                    if (++retries > this.MAX_RETRIES) throw new Error('Rate limited');
                    await new Promise(r => setTimeout(r, 2000)); continue;
                }
                if (!res.ok) throw new Error((await res.json()).error?.message || `HTTP ${res.status}`);
                const data = await res.json();
                all = all.concat(data.records);
                offset = data.offset;
                retries = 0;
            } catch (e) { throw e; }
        } while (offset);
        return all;
    },

    // ---- Init ----
    async init() {
        this.bindEvents();
        if (!this.apiKey) { this.showSetup(); return; }
        await this.loadData();
    },

    showSetup() { document.getElementById('setupModal').classList.add('open'); },
    hideSetup() { document.getElementById('setupModal').classList.remove('open'); },

    bindEvents() {
        document.getElementById('setupForm').addEventListener('submit', async e => {
            e.preventDefault();
            const key = document.getElementById('setupKey').value.trim();
            const base = document.getElementById('setupBase').value.trim();
            if (!key || !base) return;
            localStorage.setItem('airtable_api_key', key);
            localStorage.setItem('airtable_base_id', base);
            this.hideSetup();
            await this.loadData();
        });
        document.getElementById('refreshBtn').addEventListener('click', () => this.loadData());
        document.getElementById('newBriefBtn').addEventListener('click', () => this.toast('New Brief creation coming soon', 'success'));
        document.getElementById('modalCloseBtn').addEventListener('click', () => this.closeModal());
        document.getElementById('detailModal').addEventListener('click', e => { if (e.target === e.currentTarget) this.closeModal(); });
        document.getElementById('fPillar').addEventListener('change', () => this.applyFilters());
        document.getElementById('fHook').addEventListener('change', () => this.applyFilters());
        document.getElementById('fPlatform').addEventListener('change', () => this.applyFilters());
        document.getElementById('fTier').addEventListener('change', () => this.applyFilters());
        document.getElementById('searchInput').addEventListener('input', () => this.applyFilters());
        document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeModal(); });
    },

    async loadData() {
        this.loader(true);
        this.showSkeletons();
        try {
            this.records = await this.fetchAll();
            document.getElementById('syncTs').textContent = 'Synced ' + new Date().toLocaleTimeString();
            this.updateStats();
            this.buildStatusTabs();
            this.applyFilters();
            this.toast(`Loaded ${this.records.length} records`, 'success');
        } catch (e) {
            this.toast('Load failed: ' + e.message, 'error');
            document.getElementById('cardGrid').innerHTML = this.emptyHtml('Failed to load data', e.message, true);
        }
        this.loader(false);
    },

    // ---- Stats ----
    countByStatus(s) { return this.records.filter(r => (r.fields.Status || '') === s).length; },
    updateStats() {
        const f = (id, v, d) => { document.getElementById(id).textContent = v; document.getElementById(id + 'D').textContent = d; };
        f('sTot', this.records.length, this.records.length + ' total items');
        f('sGen', this.countByStatus('Generating'), 'in progress');
        f('sReady', this.countByStatus('Ready'), 'awaiting publish');
        f('sPost', this.countByStatus('Posted'), 'published');
        f('sFail', this.countByStatus('Failed'), 'need attention');
        const posted = this.records.filter(r => r.fields.Status === 'Posted' && r.fields.Metrics_Engagement != null);
        const avg = posted.length ? (posted.reduce((s, r) => s + Number(r.fields.Metrics_Engagement || 0), 0) / posted.length).toFixed(1) : '—';
        f('sEng', avg, posted.length ? `across ${posted.length} posts` : 'no data');
    },

    // ---- Status Tabs ----
    buildStatusTabs() {
        const statuses = ['All', 'Queued', 'Generating', 'Ready', 'Posted', 'Archived', 'Failed'];
        const cont = document.getElementById('statusTabs');
        cont.innerHTML = statuses.map(s => {
            const cnt = s === 'All' ? this.records.length : this.countByStatus(s);
            const active = s === this.activeStatus ? ' active' : '';
            return `<button class="status-tab${active}" data-status="${s}">${s}<span class="cnt">(${cnt})</span></button>`;
        }).join('');
        cont.querySelectorAll('.status-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                this.activeStatus = btn.dataset.status;
                cont.querySelectorAll('.status-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.applyFilters();
            });
        });
    },

    // ---- Filters ----
    applyFilters() {
        const pillar = document.getElementById('fPillar').value;
        const hook = document.getElementById('fHook').value;
        const platform = document.getElementById('fPlatform').value;
        const tier = document.getElementById('fTier').value;
        const q = document.getElementById('searchInput').value.trim().toLowerCase();

        this.filtered = this.records.filter(r => {
            const f = r.fields;
            if (this.activeStatus !== 'All' && f.Status !== this.activeStatus) return false;
            if (pillar && f.Content_Pillar !== pillar) return false;
            if (hook && f.Hook_Type !== hook) return false;
            if (platform && f.Platform !== platform) return false;
            if (tier && f.Performance_Tier !== tier) return false;
            if (q) {
                const blob = [f.Topic, f.Target_Keywords, f.Caption_Text, f.Content_ID].filter(Boolean).join(' ').toLowerCase();
                if (!blob.includes(q)) return false;
            }
            return true;
        });
        this.renderCards();
    },

    // ---- Render Cards ----
    showSkeletons() {
        const grid = document.getElementById('cardGrid');
        grid.innerHTML = Array.from({ length: 8 }, (_, i) =>
            `<div class="skel-card" style="animation-delay:${i * 50}ms"><div class="skel skel-img"></div><div class="skel skel-line w80"></div><div class="skel skel-line w60"></div><div class="skel skel-line w40"></div></div>`
        ).join('');
    },

    renderCards() {
        const grid = document.getElementById('cardGrid');
        if (!this.filtered.length) {
            const isFiltered = this.activeStatus !== 'All' || document.getElementById('fPillar').value || document.getElementById('searchInput').value;
            grid.innerHTML = this.emptyHtml(
                isFiltered ? 'No pins match your filters' : 'No content in queue yet',
                isFiltered ? 'Try adjusting your filters' : 'Create your first content brief to get started',
                false, isFiltered
            );
            return;
        }
        grid.innerHTML = this.filtered.map((r, i) => this.cardHtml(r, i)).join('');
        grid.querySelectorAll('.card').forEach((card, idx) => {
            card.addEventListener('click', () => this.openModal(this.filtered[idx]));
        });
    },

    cardHtml(r, i) {
        const f = r.fields;
        const imgSrc = this.imgUrl(f.Image_GDrive_ID);
        const status = f.Status || 'Queued';
        const pillar = f.Content_Pillar || '';
        const hookType = f.Hook_Type || '';
        const platform = f.Platform || '';
        const compInspired = f.Competitor_Inspired;
        const kws = (f.Target_Keywords || '').split(',').map(k => k.trim()).filter(Boolean);
        const kwShow = kws.slice(0, 4);
        const kwMore = kws.length > 4 ? kws.length - 4 : 0;
        const isPosted = status === 'Posted';

        let imgBlock;
        if (f.Image_GDrive_ID) {
            imgBlock = `<img src="${imgSrc}" alt="${this.esc(f.Topic)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=placeholder><svg viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\'/><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'/><path d=\\'M21 15l-5-5L5 21\\'/></svg><span>Image unavailable</span></div>'">`;
        } else {
            imgBlock = `<div class="placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Awaiting Generation</span></div>`;
        }

        let tags = '';
        if (hookType) tags += `<span class="pill pill-hook">${this.esc(hookType)}</span>`;
        if (platform) tags += `<span class="pill pill-platform">${this.esc(platform)}</span>`;
        if (compInspired) tags += `<span class="pill pill-comp">Competitor Inspired</span>`;

        let kwHtml = kwShow.map(k => `<span class="kw-chip">${this.esc(k)}</span>`).join('');
        if (kwMore) kwHtml += `<span class="kw-chip">+${kwMore} more</span>`;

        let footer = '';
        if (isPosted) {
            footer += `<div class="mini-stat">👁 <span>${this.fmtNum(f.Metrics_Reach)}</span></div>`;
            footer += `<div class="mini-stat">📌 <span>${this.fmtNum(f.Metrics_Saves)}</span></div>`;
            footer += `<div class="mini-stat">🔗 <span>${this.fmtNum(f.Metrics_Clicks)}</span></div>`;
            footer += `<div class="mini-stat">⚡ <span>${this.fmtNum(f.Metrics_Engagement)}</span></div>`;
            if (f.Performance_Tier) {
                const tc = f.Performance_Tier.replace(/\s+/g, '');
                footer += `<span class="tier-badge tier-${tc}">${this.esc(f.Performance_Tier)}</span>`;
            }
        }
        const dateStr = this.fmtDate(f.Posted_Date || f.Created_Date);
        let postLink = '';
        if (f.Post_URL) postLink = `<a href="${this.esc(f.Post_URL)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🔗 View</a>`;

        return `<div class="card" style="animation-delay:${i * 50}ms">
<div class="card-img">
    ${imgBlock}
    <span class="badge badge-status badge-${status}">${status}</span>
    ${pillar ? `<span class="badge badge-pillar">${this.esc(pillar)}</span>` : ''}
</div>
<div class="card-body">
    <div class="card-id">${this.esc(f.Content_ID || r.id)}</div>
    <div class="card-title">${this.esc(f.Topic || 'Untitled')}</div>
    ${f.Caption_Text ? `<div class="card-caption">${this.esc(f.Caption_Text)}</div>` : ''}
    ${tags ? `<div class="card-tags">${tags}</div>` : ''}
    ${kwHtml ? `<div class="card-kw">${kwHtml}</div>` : ''}
    ${f.CTA_Text ? `<div class="card-cta">"${this.esc(f.CTA_Text)}"</div>` : ''}
</div>
<div class="card-foot">
    ${footer}
    <div class="card-date">${dateStr}${postLink}</div>
</div>
</div>`;
    },

    emptyHtml(title, sub, retry, showClear) {
        return `<div class="empty-state" style="grid-column:1/-1">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
<h3>${title}</h3><p>${sub}</p>
${retry ? '<button class="btn btn-primary" onclick="CQ.loadData()">Retry</button>' : ''}
${showClear ? '<button class="btn btn-ghost" onclick="CQ.clearFilters()">Clear Filters</button>' : ''}
${!retry && !showClear ? '<button class="btn btn-primary" onclick="CQ.toast(\'Coming soon\',\'success\')">Create First Brief</button>' : ''}
</div>`;
    },

    clearFilters() {
        this.activeStatus = 'All';
        document.getElementById('fPillar').value = '';
        document.getElementById('fHook').value = '';
        document.getElementById('fPlatform').value = '';
        document.getElementById('fTier').value = '';
        document.getElementById('searchInput').value = '';
        this.buildStatusTabs();
        this.applyFilters();
    },

    // ---- Modal ----
    openModal(r) {
        const f = r.fields;
        const modal = document.getElementById('detailModal');
        const imgCont = document.getElementById('modalImg');
        const det = document.getElementById('modalDetail');

        if (f.Image_GDrive_ID) {
            imgCont.innerHTML = `<img src="${this.imgUrl(f.Image_GDrive_ID, 1200)}" alt="${this.esc(f.Topic)}" style="aspect-ratio:2/3;object-fit:cover" onerror="this.parentElement.innerHTML='<div class=placeholder><svg viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\'/></svg><span>Image unavailable</span></div>'">`;
        } else {
            imgCont.innerHTML = `<div class="placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Awaiting Generation</span></div>`;
        }

        const status = f.Status || 'Queued';
        const tierClass = (f.Performance_Tier || '').replace(/\s+/g, '');
        const kws = (f.Target_Keywords || '').split(',').map(k => k.trim()).filter(Boolean);
        const isPosted = status === 'Posted';

        let metricsHtml = '';
        if (isPosted) {
            metricsHtml = `<div class="modal-section"><h4>Metrics</h4><div class="metrics-row">
<div class="metric-box"><span class="m-val">${this.fmtNum(f.Metrics_Reach)}</span><span class="m-label">Reach</span></div>
<div class="metric-box"><span class="m-val">${this.fmtNum(f.Metrics_Saves)}</span><span class="m-label">Saves</span></div>
<div class="metric-box"><span class="m-val">${this.fmtNum(f.Metrics_Clicks)}</span><span class="m-label">Clicks</span></div>
<div class="metric-box"><span class="m-val">${this.fmtNum(f.Metrics_Engagement)}</span><span class="m-label">Engagement</span></div>
</div></div>`;
        }

        let insightHtml = '';
        if (f.AI_Insight) {
            insightHtml = `<div class="modal-section"><h4>AI Insight</h4><div class="ai-insight-box"><p>${this.esc(f.AI_Insight)}</p></div></div>`;
        }

        let promptHtml = '';
        if (f.Generation_Prompt) {
            promptHtml = `<div class="modal-section"><h4>Generation Prompt</h4>
<button class="collapse-toggle" onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='none'?'block':'none';this.textContent=b.style.display==='none'?'Show prompt ▸':'Hide prompt ▾'">Show prompt ▸</button>
<div class="mono-block" style="display:none">${this.esc(f.Generation_Prompt)}</div></div>`;
        }

        det.innerHTML = `
<div class="modal-topbar">
    <span class="card-id" style="font-family:var(--mono);font-size:.72rem;color:var(--text-muted)">${this.esc(f.Content_ID || r.id)}</span>
    <span class="badge badge-${status}" style="position:static">${status}</span>
    ${f.Performance_Tier ? `<span class="tier-badge tier-${tierClass}" style="position:static">${this.esc(f.Performance_Tier)}</span>` : ''}
</div>
<h2 class="modal-title">${this.esc(f.Topic || 'Untitled')}</h2>

${f.Caption_Text ? `<div class="modal-section"><h4>Caption</h4><p>${this.esc(f.Caption_Text)}</p></div>` : ''}
${f.CTA_Text ? `<div class="modal-section"><h4>Call to Action</h4><p style="font-style:italic">"${this.esc(f.CTA_Text)}"</p></div>` : ''}

${kws.length ? `<div class="modal-section"><h4>Keywords</h4><div class="card-kw" style="flex-wrap:wrap;gap:6px">${kws.map(k => `<span class="kw-chip" style="font-size:.72rem;padding:3px 10px">${this.esc(k)}</span>`).join('')}</div></div>` : ''}

<div class="modal-section"><h4>Details</h4><div class="detail-grid">
<div class="detail-item"><strong>Pillar:</strong> ${this.esc(f.Content_Pillar || '—')}</div>
<div class="detail-item"><strong>Hook:</strong> ${this.esc(f.Hook_Type || '—')}</div>
<div class="detail-item"><strong>Platform:</strong> ${this.esc(f.Platform || '—')}</div>
<div class="detail-item"><strong>Board:</strong> ${this.esc(f.Board_Name || '—')}</div>
<div class="detail-item"><strong>Competitor Inspired:</strong> ${f.Competitor_Inspired ? 'Yes ✓' : 'No'}</div>
</div></div>

${promptHtml}
${metricsHtml}
${insightHtml}

<div class="modal-section"><h4>Timeline</h4><div class="detail-grid">
<div class="detail-item"><strong>Created:</strong> ${this.fmtDate(f.Created_Date)}</div>
<div class="detail-item"><strong>Posted:</strong> ${this.fmtDate(f.Posted_Date)}</div>
<div class="detail-item"><strong>Updated:</strong> ${this.fmtDate(f.Last_Updated)}</div>
</div></div>

<div class="modal-footer">
${f.Post_URL ? `<a href="${this.esc(f.Post_URL)}" target="_blank" rel="noopener" class="btn btn-primary" style="text-decoration:none">View Live Pin ↗</a>` : ''}
${f.Caption_Text ? `<button class="btn btn-ghost" onclick="navigator.clipboard.writeText(${JSON.stringify(f.Caption_Text)});CQ.toast('Caption copied!','success')">Copy Caption</button>` : ''}
<button class="btn btn-ghost" onclick="CQ.closeModal()">Close</button>
</div>`;

        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    },

    closeModal() {
        document.getElementById('detailModal').classList.remove('open');
        document.body.style.overflow = '';
    }
};

document.addEventListener('DOMContentLoaded', () => CQ.init());

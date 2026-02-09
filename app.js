// Pinterest Intelligence Dashboard - Live Airtable Integration

// Application State
const AppState = {
    isLoading: false,
    isConnected: false,
    lastUpdated: null,
    error: null,
    data: {
        competitorPins: [],
        pinAnalysis: [],
        competitorIntelligence: []
    },
    analytics: {
        totalPins: 0,
        analyzedPins: 0,
        topHook: null,
        hookDistribution: {},
        keywordFrequency: {},
        pillarDistribution: {},
        avgCtaStrength: 0,
        gapOpportunities: []
    }
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initApiSetup();
    initQuickActions();
    initChatInterface();
    initContentPlanner();
    initAirtableTabs();

    // Check if API key exists
    if (ApiKeyManager.isSet()) {
        loadAllData();
    } else {
        showApiSetupModal();
    }
});

// API Setup Modal
function initApiSetup() {
    const modal = document.getElementById('apiSetupModal');
    const form = document.getElementById('apiKeyForm');
    const refreshBtn = document.getElementById('refreshDataBtn');
    const settingsBtn = document.getElementById('apiSettingsBtn');

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('apiKeyInput');
            const apiKey = input.value.trim();

            if (!apiKey) return;

            // Save and test
            ApiKeyManager.set(apiKey);
            setLoadingState(true, 'Testing connection...');

            const result = await airtableAPI.testConnection();

            if (result.success) {
                hideApiSetupModal();
                loadAllData();
            } else {
                ApiKeyManager.clear();
                showError('Connection failed: ' + result.error);
                setLoadingState(false);
            }
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => loadAllData());
    }

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => showApiSetupModal());
    }
}

function showApiSetupModal() {
    const modal = document.getElementById('apiSetupModal');
    if (modal) modal.classList.add('active');
}

function hideApiSetupModal() {
    const modal = document.getElementById('apiSetupModal');
    if (modal) modal.classList.remove('active');
}

// Data Loading
async function loadAllData() {
    setLoadingState(true, 'Fetching data from Airtable...');
    AppState.error = null;

    try {
        const [pins, analysis, intelligence] = await Promise.all([
            airtableAPI.fetchTable(AIRTABLE_CONFIG.tables.competitorPins),
            airtableAPI.fetchTable(AIRTABLE_CONFIG.tables.pinAnalysis),
            airtableAPI.fetchTable(AIRTABLE_CONFIG.tables.competitorIntelligence)
        ]);

        AppState.data.competitorPins = pins;
        AppState.data.pinAnalysis = analysis;
        AppState.data.competitorIntelligence = intelligence;
        AppState.isConnected = true;
        AppState.lastUpdated = new Date();

        // Compute analytics
        computeAnalytics();

        // Update UI
        updateDashboard();
        updateSyncStatus();

        setLoadingState(false);
    } catch (error) {
        AppState.error = error.message;
        AppState.isConnected = false;
        showError('Failed to load data: ' + error.message);
        setLoadingState(false);
    }
}

function setLoadingState(isLoading, message = 'Loading...') {
    AppState.isLoading = isLoading;
    const loader = document.getElementById('globalLoader');
    const loaderText = document.getElementById('loaderText');

    if (loader) {
        loader.classList.toggle('active', isLoading);
    }
    if (loaderText) {
        loaderText.textContent = message;
    }
}

function showError(message) {
    const errorEl = document.getElementById('errorMessage');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.add('active');
        setTimeout(() => errorEl.classList.remove('active'), 5000);
    }
    console.error(message);
}

// Analytics Computation
function computeAnalytics() {
    const { competitorPins, pinAnalysis } = AppState.data;
    const analytics = AppState.analytics;

    // Basic counts
    analytics.totalPins = competitorPins.length;
    analytics.analyzedPins = pinAnalysis.length;

    // Hook distribution
    const hookCounts = {};
    pinAnalysis.forEach(record => {
        const hook = record.fields['Hook Technique'] || record.fields['hook_technique'] || 'Unknown';
        hookCounts[hook] = (hookCounts[hook] || 0) + 1;
    });
    analytics.hookDistribution = hookCounts;

    // Find top hook
    let maxCount = 0;
    Object.entries(hookCounts).forEach(([hook, count]) => {
        if (count > maxCount) {
            maxCount = count;
            analytics.topHook = hook;
        }
    });

    // Keyword frequency
    const keywordCounts = {};
    pinAnalysis.forEach(record => {
        const primary = record.fields['Primary Keywords'] || record.fields['primary_keywords'] || '';
        const secondary = record.fields['Secondary Keywords'] || record.fields['secondary_keywords'] || '';
        const keywords = (primary + ',' + secondary).split(',').map(k => k.trim().toLowerCase()).filter(k => k);
        keywords.forEach(kw => {
            keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
        });
    });
    analytics.keywordFrequency = keywordCounts;

    // Pillar distribution
    const pillarCounts = { 'Educational': 0, 'Proof': 0, 'Offer': 0, 'Behind-the-Scenes': 0, 'Other': 0 };
    pinAnalysis.forEach(record => {
        const pillar = record.fields['Content Pillar'] || record.fields['content_pillar'] || 'Other';
        if (pillarCounts.hasOwnProperty(pillar)) {
            pillarCounts[pillar]++;
        } else {
            pillarCounts['Other']++;
        }
    });
    analytics.pillarDistribution = pillarCounts;

    // Average CTA strength
    let ctaSum = 0, ctaCount = 0;
    pinAnalysis.forEach(record => {
        const cta = parseFloat(record.fields['CTA Strength'] || record.fields['cta_strength']);
        if (!isNaN(cta)) {
            ctaSum += cta;
            ctaCount++;
        }
    });
    analytics.avgCtaStrength = ctaCount > 0 ? (ctaSum / ctaCount).toFixed(1) : 'N/A';

    // Gap opportunities
    const gaps = [];
    pinAnalysis.forEach(record => {
        const gap = record.fields['Gap Opportunity'] || record.fields['gap_opportunity'];
        if (gap) gaps.push(gap);
    });
    analytics.gapOpportunities = gaps;
}

// Dashboard Update
function updateDashboard() {
    const { analytics, data } = AppState;

    // Update metric cards
    updateMetricCard('pinsAnalyzed', analytics.totalPins, `${analytics.analyzedPins} analyzed`);
    updateMetricCard('topHook', analytics.topHook || 'No data', getHookPercentage());
    updateMetricCard('gapOpportunities', analytics.gapOpportunities.length, 'Identified');
    updateMetricCard('competitorsTracked', getUniqueCompetitors(), 'Active monitoring');

    // Update pillar distribution
    updatePillarBars();

    // Update trending keywords
    updateKeywordTags();

    // Update top insight
    updateTopInsight();

    // Update intelligence summary
    updateIntelligenceSummary();
}

function updateMetricCard(id, value, trend) {
    const valueEl = document.querySelector(`[data-metric="${id}"] .metric-value`);
    const trendEl = document.querySelector(`[data-metric="${id}"] .metric-trend`);

    if (valueEl) valueEl.textContent = value;
    if (trendEl) trendEl.textContent = trend;
}

function getHookPercentage() {
    const { hookDistribution, topHook, analyzedPins } = AppState.analytics;
    if (!topHook || analyzedPins === 0) return 'No data';
    const count = hookDistribution[topHook] || 0;
    const pct = ((count / analyzedPins) * 100).toFixed(0);
    return `${pct}% of pins`;
}

function getUniqueCompetitors() {
    const competitors = new Set();
    AppState.data.competitorPins.forEach(record => {
        const name = record.fields['Competitor Name'] || record.fields['competitor_name'];
        if (name) competitors.add(name);
    });
    return competitors.size;
}

function updatePillarBars() {
    const { pillarDistribution, analyzedPins } = AppState.analytics;
    const container = document.getElementById('pillarBars');
    if (!container) return;

    if (analyzedPins === 0) {
        container.innerHTML = '<p class="empty-state-text">No analyzed pins yet</p>';
        return;
    }

    let html = '';
    Object.entries(pillarDistribution).forEach(([pillar, count]) => {
        const pct = ((count / analyzedPins) * 100).toFixed(0);
        html += `
            <div class="pillar-bar">
                <span class="pillar-label">${pillar}</span>
                <div class="pillar-progress">
                    <div class="pillar-fill" style="width: ${pct}%;"></div>
                </div>
                <span class="pillar-value">${pct}%</span>
            </div>
        `;
    });
    container.innerHTML = html;
}

function updateKeywordTags() {
    const { keywordFrequency } = AppState.analytics;
    const container = document.getElementById('keywordTags');
    if (!container) return;

    // Sort by frequency and take top 8
    const sorted = Object.entries(keywordFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

    if (sorted.length === 0) {
        container.innerHTML = '<p class="empty-state-text">No keywords found</p>';
        return;
    }

    container.innerHTML = sorted.map(([kw, count]) =>
        `<span class="keyword-tag" title="${count} occurrences">${kw}</span>`
    ).join('');
}

function updateTopInsight() {
    const { hookDistribution, avgCtaStrength, analyzedPins } = AppState.analytics;
    const container = document.getElementById('topInsight');
    if (!container || analyzedPins === 0) return;

    // Find underutilized hooks
    const totalHooks = Object.values(hookDistribution).reduce((a, b) => a + b, 0);
    let insight = '';

    const curiosityCount = hookDistribution['Curiosity'] || hookDistribution['curiosity'] || 0;
    const curiosityPct = totalHooks > 0 ? ((curiosityCount / totalHooks) * 100).toFixed(1) : 0;

    if (curiosityPct < 5) {
        insight = `<strong>Curiosity hooks are underutilized</strong> — Only ${curiosityPct}% of ${analyzedPins} analyzed pins use curiosity hooks. This represents a major differentiation opportunity for your content.`;
    } else if (parseFloat(avgCtaStrength) < 5) {
        insight = `<strong>CTAs are generally weak</strong> — Average CTA strength is ${avgCtaStrength}/10 across analyzed pins. Strengthen your calls-to-action to stand out from competitors.`;
    } else {
        const topHook = Object.entries(hookDistribution).sort((a, b) => b[1] - a[1])[0];
        insight = `<strong>${topHook[0]} hooks dominate</strong> — ${((topHook[1] / totalHooks) * 100).toFixed(0)}% of competitor pins use this technique. Consider alternative approaches to differentiate.`;
    }

    container.innerHTML = `<p>${insight}</p>`;
}

function updateIntelligenceSummary() {
    const { competitorIntelligence } = AppState.data;
    const container = document.getElementById('intelligenceSummary');
    if (!container) return;

    if (competitorIntelligence.length === 0) {
        container.innerHTML = `
            <p>No weekly intelligence reports available yet. Reports are generated after analyzing competitor pins over time.</p>
            <p><strong>Current status:</strong> ${AppState.analytics.totalPins} pins collected, ${AppState.analytics.analyzedPins} analyzed.</p>
        `;
        return;
    }

    // Get most recent report
    const sorted = competitorIntelligence.sort((a, b) => {
        const dateA = new Date(a.fields['Report Date'] || a.fields['report_date'] || 0);
        const dateB = new Date(b.fields['Report Date'] || b.fields['report_date'] || 0);
        return dateB - dateA;
    });

    const latest = sorted[0].fields;
    const summary = latest['Week Summary'] || latest['week_summary'] || latest['Executive Summary'] || 'No summary available.';

    container.innerHTML = `<p>${summary}</p>`;
}

function updateSyncStatus() {
    const statusEl = document.getElementById('syncStatus');
    const timestampEl = document.getElementById('lastUpdated');

    if (statusEl) {
        statusEl.classList.toggle('connected', AppState.isConnected);
        statusEl.querySelector('span:last-child').textContent =
            AppState.isConnected ? 'Connected to Airtable' : 'Disconnected';
    }

    if (timestampEl && AppState.lastUpdated) {
        timestampEl.textContent = `Updated ${AppState.lastUpdated.toLocaleTimeString()}`;
    }
}

// Navigation
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.content-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetSection = item.dataset.section;
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            sections.forEach(section => {
                section.classList.remove('active');
                if (section.id === targetSection) section.classList.add('active');
            });
        });
    });
}

// Quick Actions with Real Data
function initQuickActions() {
    const buttons = document.querySelectorAll('.quick-action-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => handleQuickAction(btn.dataset.action));
    });
}

function handleQuickAction(action) {
    const { analytics, data } = AppState;

    const responses = {
        analyze: generateAnalyzeResponse(),
        weekly: generateWeeklyResponse(),
        hooks: generateHooksResponse(),
        gaps: generateGapsResponse(),
        keywords: generateKeywordsResponse()
    };

    const response = responses[action];
    if (response) {
        addUserMessage(response.user);
        setTimeout(() => showTypingIndicator(), 300);
        setTimeout(() => {
            hideTypingIndicator();
            addAssistantMessage(response.assistant);
        }, 1200);
    }
}

function generateAnalyzeResponse() {
    const { totalPins, analyzedPins, hookDistribution, topHook } = AppState.analytics;

    if (totalPins === 0) {
        return {
            user: "Analyze the latest competitor pins",
            assistant: `📊 **No competitor pins found**

Your Competitor Pins table is currently empty. To start building competitive intelligence:

1. Add competitor pins to the Airtable "Competitor Pins" table
2. Include fields like: Competitor Name, Pin Title, Pin Description, Engagement Score
3. Come back here to analyze patterns and get strategic insights

Would you like guidance on what data to collect?`
        };
    }

    const hookSummary = Object.entries(hookDistribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([hook, count]) => `• ${hook}: ${count} pins (${((count / analyzedPins) * 100).toFixed(0)}%)`)
        .join('\n');

    return {
        user: "Analyze the latest competitor pins",
        assistant: `📊 **Competitor Pin Analysis**

Currently tracking **${totalPins} pins** with **${analyzedPins} analyzed**.

**Hook Technique Breakdown:**
${hookSummary || '• No hook data available yet'}

**Top Hook:** ${topHook || 'N/A'}

**Key Insight:** ${analyzedPins > 0 ?
                `Based on ${analyzedPins} analyzed pins, ${topHook} hooks are most common. Look for underutilized techniques to differentiate.` :
                'Add more analyzed pins to see patterns emerge.'}

Would you like me to dive deeper into any specific aspect?`
    };
}

function generateWeeklyResponse() {
    const { competitorIntelligence } = AppState.data;
    const { totalPins, analyzedPins, avgCtaStrength, pillarDistribution } = AppState.analytics;

    if (competitorIntelligence.length === 0) {
        const pillarSummary = Object.entries(pillarDistribution)
            .filter(([_, count]) => count > 0)
            .map(([pillar, count]) => `• ${pillar}: ${((count / analyzedPins) * 100).toFixed(0)}%`)
            .join('\n');

        return {
            user: "Give me the weekly intelligence summary",
            assistant: `📋 **Intelligence Summary**

**Data Status:**
• ${totalPins} competitor pins in database
• ${analyzedPins} pins analyzed

**Content Pillar Distribution:**
${pillarSummary || '• No pillar data available'}

**CTA Strength:** Average ${avgCtaStrength}/10

**Note:** No formal weekly reports have been generated yet. As you continue adding and analyzing pins, weekly intelligence reports will be created in the Competitor Intelligence table.

Would you like recommendations based on current data?`
        };
    }

    // Use latest report
    const latest = competitorIntelligence.sort((a, b) => {
        const dateA = new Date(a.fields['Report Date'] || 0);
        const dateB = new Date(b.fields['Report Date'] || 0);
        return dateB - dateA;
    })[0].fields;

    return {
        user: "Give me the weekly intelligence summary",
        assistant: `📋 **Weekly Intelligence Report**

${latest['Week Summary'] || latest['Executive Summary'] || 'Summary not available.'}

**Top Hooks:** ${latest['Top Hooks'] || 'Not specified'}

**Top Keywords:** ${latest['Top Keywords'] || 'Not specified'}

**Strategy Recommendations:**
${latest['Strategy Recommendations'] || 'Review the full report in the Weekly Intelligence section.'}

Want me to elaborate on any section?`
    };
}

function generateHooksResponse() {
    const { hookDistribution, analyzedPins } = AppState.analytics;

    if (analyzedPins === 0) {
        return {
            user: "What are the best performing hooks?",
            assistant: `⚡ **Hook Analysis**

No analyzed pins available yet. To get hook insights:

1. Ensure pins are added to the Competitor Pins table
2. Run analysis on each pin (stored in Pin Analysis table)
3. Include "Hook Technique" field in your analysis

Once you have analyzed pins, I can tell you exactly which hooks dominate and which are opportunities.`
        };
    }

    const sorted = Object.entries(hookDistribution).sort((a, b) => b[1] - a[1]);
    const hookList = sorted.map(([hook, count], i) =>
        `**#${i + 1} ${hook}** (${count} pins, ${((count / analyzedPins) * 100).toFixed(0)}%)`
    ).join('\n');

    // Find underutilized
    const underutilized = sorted.filter(([_, count]) => (count / analyzedPins) < 0.05);

    return {
        user: "What are the best performing hooks?",
        assistant: `⚡ **Hook Technique Analysis** (${analyzedPins} pins)

${hookList}

${underutilized.length > 0 ?
                `**🔥 Underutilized Opportunities:**
${underutilized.map(([h]) => `• ${h}`).join('\n')}
These appear in <5% of pins — great differentiation potential!` :
                'All hook types are well-represented in competitor content.'}

Want me to suggest specific hooks for your next pin?`
    };
}

function generateGapsResponse() {
    const { gapOpportunities, analyzedPins } = AppState.analytics;

    if (gapOpportunities.length === 0) {
        return {
            user: "Show me the content gap opportunities",
            assistant: `🎯 **Gap Opportunities**

${analyzedPins === 0 ?
                    'No pins have been analyzed yet.' :
                    `${analyzedPins} pins analyzed, but no gap opportunities recorded.`}

To identify gaps, ensure your Pin Analysis records include a "Gap Opportunity" field that notes what's missing or could be improved in each competitor pin.

Common gaps to look for:
• Weak CTAs
• Missing emotional triggers
• Underutilized hook types
• Absent proof elements
• Poor keyword optimization`
        };
    }

    // Count gap frequencies
    const gapCounts = {};
    gapOpportunities.forEach(gap => {
        const normalized = gap.toLowerCase().trim();
        gapCounts[normalized] = (gapCounts[normalized] || 0) + 1;
    });

    const topGaps = Object.entries(gapCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([gap, count]) => `• **${gap}** (found in ${count} pins)`)
        .join('\n');

    return {
        user: "Show me the content gap opportunities",
        assistant: `🎯 **Content Gap Opportunities**

Based on ${analyzedPins} analyzed pins, here are the most common gaps:

${topGaps}

**Strategic Insight:** These gaps represent systematic weaknesses across your competitor landscape. Target these areas to differentiate your content.

Which gap would you like to focus on first?`
    };
}

function generateKeywordsResponse() {
    const { keywordFrequency, analyzedPins } = AppState.analytics;

    const sorted = Object.entries(keywordFrequency).sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0) {
        return {
            user: "What keywords should I focus on?",
            assistant: `🔑 **Keyword Analysis**

No keyword data available yet. To get keyword insights:

1. Ensure Pin Analysis records include "Primary Keywords" and/or "Secondary Keywords" fields
2. Add comma-separated keywords for each analyzed pin

Once populated, I can show you trending keywords and recommend targeting strategies.`
        };
    }

    const tier1 = sorted.slice(0, 5).map(([kw, count]) => `• \`${kw}\` (${count} occurrences)`).join('\n');
    const tier2 = sorted.slice(5, 10).map(([kw, count]) => `• \`${kw}\` (${count})`).join('\n');

    return {
        user: "What keywords should I focus on?",
        assistant: `🔑 **Keyword Analysis** (from ${analyzedPins} pins)

**Tier 1 - Most Targeted:**
${tier1}

${tier2 ? `**Tier 2 - Also Common:**
${tier2}` : ''}

**Strategy:** These are keywords your competitors actively target. Consider:
1. Competing directly on high-volume terms
2. Finding long-tail variations they're missing
3. Combining keywords in unique ways

Shall I suggest specific keyword combinations?`
    };
}

// Chat Interface
function initChatInterface() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');

    if (sendBtn) sendBtn.addEventListener('click', () => sendMessage());
    if (input) input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;

    addUserMessage(message);
    input.value = '';

    setTimeout(() => showTypingIndicator(), 300);
    setTimeout(() => {
        hideTypingIndicator();
        addAssistantMessage(generateContextualResponse(message));
    }, 1200);
}

function generateContextualResponse(message) {
    const { analytics, data } = AppState;
    const lower = message.toLowerCase();

    // Dynamic responses based on real data
    if (lower.includes('hook') || lower.includes('title')) {
        const { hookDistribution, topHook, analyzedPins } = analytics;
        if (analyzedPins === 0) return 'No hook data available yet. Add and analyze competitor pins first.';

        return `Based on ${analyzedPins} analyzed pins, ${topHook || 'benefit'} hooks are most common.

**Current hook distribution:**
${Object.entries(hookDistribution).map(([h, c]) => `• ${h}: ${c} pins`).join('\n')}

For differentiation, try hooks that appear less frequently in competitor content.`;
    }

    if (lower.includes('keyword') || lower.includes('seo')) {
        const top = Object.entries(analytics.keywordFrequency).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (top.length === 0) return 'No keyword data available. Ensure Pin Analysis records include keyword fields.';

        return `**Top keywords from your competitive data:**
${top.map(([kw, count]) => `• \`${kw}\` (${count} occurrences)`).join('\n')}

These are what competitors target most. Consider both competing on these and finding gaps they're missing.`;
    }

    if (lower.includes('cta') || lower.includes('call to action')) {
        return `**CTA Analysis:**
Average CTA strength across analyzed pins: **${analytics.avgCtaStrength}/10**

${parseFloat(analytics.avgCtaStrength) < 5 ?
                'This is relatively weak — a major opportunity to stand out with stronger, value-specific CTAs!' :
                'Competitors have moderate CTA strength. Focus on specificity and urgency to differentiate.'}`;
    }

    if (lower.includes('competitor') || lower.includes('who')) {
        const competitors = new Set();
        data.competitorPins.forEach(r => {
            const name = r.fields['Competitor Name'] || r.fields['competitor_name'];
            if (name) competitors.add(name);
        });

        if (competitors.size === 0) return 'No competitors tracked yet. Add pins to the Competitor Pins table.';

        return `**Competitors being tracked:**
${[...competitors].map(c => `• ${c}`).join('\n')}

Total: ${competitors.size} competitors, ${data.competitorPins.length} pins collected.`;
    }

    // Default response with data context
    return `Based on your current data (${analytics.totalPins} pins, ${analytics.analyzedPins} analyzed):

I can help you with:
• **Hook analysis** — See which techniques dominate
• **Keyword strategy** — Find what competitors target
• **Gap opportunities** — Identify differentiation areas
• **CTA optimization** — Strengthen your calls-to-action

What would you like to explore?`;
}

function addUserMessage(text) {
    const container = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user';
    messageDiv.innerHTML = `
        <div class="message-avatar">
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
        </div>
        <div class="message-content"><p>${text}</p></div>
    `;
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

function addAssistantMessage(text) {
    const container = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const formatted = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.*?)`/g, '<code style="background:rgba(139,92,246,0.2);padding:2px 6px;border-radius:4px;">$1</code>')
        .replace(/\n/g, '</p><p>');

    messageDiv.innerHTML = `
        <div class="message-avatar">
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
        </div>
        <div class="message-content"><p>${formatted}</p></div>
    `;
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
    const container = document.getElementById('chatMessages');
    const indicator = document.createElement('div');
    indicator.className = 'message assistant';
    indicator.id = 'typingIndicator';
    indicator.innerHTML = `
        <div class="message-avatar">
            <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
        </div>
        <div class="message-content">
            <div class="typing-indicator"><span></span><span></span><span></span></div>
        </div>
    `;
    container.appendChild(indicator);
    container.scrollTop = container.scrollHeight;
}

function hideTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
}

// Content Planner
function initContentPlanner() {
    const analyzeBtn = document.getElementById('analyzeContent');
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', () => {
            const title = document.getElementById('pinTitle').value.trim();
            const description = document.getElementById('pinDescription').value.trim();
            if (!title && !description) {
                alert('Please enter a title or description to analyze.');
                return;
            }
            analyzeContentWithRealData(title, description);
        });
    }
}

function analyzeContentWithRealData(title, description) {
    const { hookDistribution, keywordFrequency, avgCtaStrength, analyzedPins } = AppState.analytics;
    const feedbackArea = document.getElementById('feedbackArea');

    // Analyze against real competitor data
    const topKeywords = Object.keys(keywordFrequency).slice(0, 10);
    const foundKeywords = topKeywords.filter(kw =>
        title.toLowerCase().includes(kw) || description.toLowerCase().includes(kw)
    );

    const hasNumber = /\d/.test(title);
    const hasCta = /(download|save|click|get|grab|learn|discover)/i.test(description);

    const hookScore = hasNumber ? 8 : 6;
    const keywordScore = Math.min(10, 3 + foundKeywords.length * 2);
    const ctaScore = hasCta ? 8 : 4;

    feedbackArea.innerHTML = `
        <div class="feedback-results">
            <div class="feedback-item">
                <h4>🎯 Hook Analysis</h4>
                <p>${hasNumber ?
            'Great! Your title includes numbers, which perform well based on competitor data.' :
            'Consider adding specific numbers — competitor pins with numbers tend to perform better.'}</p>
                <div class="feedback-score">
                    <div class="score-bar"><div class="score-fill" style="width: ${hookScore * 10}%"></div></div>
                    <span class="score-value">${hookScore}/10</span>
                </div>
            </div>
            
            <div class="feedback-item">
                <h4>🔑 Keyword Optimization</h4>
                <p>${foundKeywords.length > 0 ?
            `Found ${foundKeywords.length} trending keywords: ${foundKeywords.map(k => `"${k}"`).join(', ')}` :
            `No trending keywords detected. Top competitor keywords: ${topKeywords.slice(0, 3).join(', ')}`}</p>
                <div class="feedback-score">
                    <div class="score-bar"><div class="score-fill" style="width: ${keywordScore * 10}%"></div></div>
                    <span class="score-value">${keywordScore}/10</span>
                </div>
            </div>
            
            <div class="feedback-item">
                <h4>📣 CTA Strength</h4>
                <p>${hasCta ?
            'Your description includes action words. Competitor average is ' + avgCtaStrength + '/10 — you\'re ahead!' :
            'Add a clear CTA like "Download", "Save this", or "Get your free...". Competitor CTAs average only ' + avgCtaStrength + '/10.'}</p>
                <div class="feedback-score">
                    <div class="score-bar"><div class="score-fill" style="width: ${ctaScore * 10}%"></div></div>
                    <span class="score-value">${ctaScore}/10</span>
                </div>
            </div>
            
            <div class="feedback-item">
                <h4>💡 Competitive Position</h4>
                <p>Based on ${analyzedPins} analyzed competitor pins. ${analyzedPins > 0 ?
            'Your content scores above average if you incorporate the suggestions above.' :
            'Add more competitor data for better comparison insights.'}</p>
            </div>
        </div>
    `;
}

// Airtable Tabs
function initAirtableTabs() {
    const tabs = document.querySelectorAll('.airtable-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
        });
    });
}

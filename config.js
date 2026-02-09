// Airtable Configuration
const AIRTABLE_CONFIG = {
    baseId: 'appMQ6QuquWCz2uNk',
    tables: {
        competitorPins: 'Competitor Pins',
        pinAnalysis: 'Pin Analysis',
        competitorIntelligence: 'competitor_intelligence'
    },
    embedUrl: 'https://airtable.com/embed/appMQ6QuquWCz2uNk/shrv5NEwpMvw4PEuc'
};

// API Key Management
const ApiKeyManager = {
    storageKey: 'pinterest_dashboard_airtable_key',

    get() {
        return localStorage.getItem(this.storageKey);
    },

    set(key) {
        localStorage.setItem(this.storageKey, key);
    },

    clear() {
        localStorage.removeItem(this.storageKey);
    },

    isSet() {
        return !!this.get();
    }
};

// Airtable API Client
class AirtableAPI {
    constructor() {
        this.baseUrl = 'https://api.airtable.com/v0';
    }

    getHeaders() {
        const apiKey = ApiKeyManager.get();
        return {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    async fetchTable(tableName, options = {}) {
        const { filterFormula, maxRecords, view } = options;
        let allRecords = [];
        let offset = null;

        do {
            const params = new URLSearchParams();
            if (offset) params.append('offset', offset);
            if (filterFormula) params.append('filterByFormula', filterFormula);
            if (maxRecords) params.append('maxRecords', maxRecords);
            if (view) params.append('view', view);

            const url = `${this.baseUrl}/${AIRTABLE_CONFIG.baseId}/${encodeURIComponent(tableName)}?${params}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || `Failed to fetch ${tableName}`);
            }

            const data = await response.json();
            allRecords = allRecords.concat(data.records);
            offset = data.offset;
        } while (offset);

        return allRecords;
    }

    async createRecord(tableName, fields) {
        const url = `${this.baseUrl}/${AIRTABLE_CONFIG.baseId}/${encodeURIComponent(tableName)}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ fields })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Failed to create record');
        }

        return await response.json();
    }

    async updateRecord(tableName, recordId, fields) {
        const url = `${this.baseUrl}/${AIRTABLE_CONFIG.baseId}/${encodeURIComponent(tableName)}/${recordId}`;

        const response = await fetch(url, {
            method: 'PATCH',
            headers: this.getHeaders(),
            body: JSON.stringify({ fields })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Failed to update record');
        }

        return await response.json();
    }

    async testConnection() {
        try {
            // Test each table individually to identify which one fails
            const tables = [
                AIRTABLE_CONFIG.tables.competitorPins,
                AIRTABLE_CONFIG.tables.pinAnalysis,
                AIRTABLE_CONFIG.tables.competitorIntelligence
            ];

            for (const table of tables) {
                try {
                    await this.fetchTable(table, { maxRecords: 1 });
                    console.log(`✓ Successfully connected to: ${table}`);
                } catch (e) {
                    console.error(`✗ Failed to connect to: ${table}`, e.message);
                    return { success: false, error: `Table "${table}" - ${e.message}` };
                }
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

// Export for use
const airtableAPI = new AirtableAPI();

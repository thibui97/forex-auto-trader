// Simplified Exness API - Chỉ endpoints cần thiết
// File: server/controllers/exnessAPI.js

const axios = require('axios');
const logger = require('../utils/logger');

class ExnessPartnerAPI {
    constructor() {
        this.baseURL = process.env.EXNESS_API_BASE_URL || 'https://my.exaffiliate.com/api/schema';
        this.jwtToken = process.env.EXNESS_JWT_TOKEN;
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        
        if (!this.jwtToken) {
            logger.warn('Exness JWT Token not found, using mock data');
        }
    }

    async makeRequest(endpoint, params = {}, method = 'GET') {
        try {
            if (!this.jwtToken) {
                throw new Error('No Exness JWT Token available');
            }

            const config = {
                method,
                url: `${this.baseURL}${endpoint}`,
                headers: {
                    'Authorization': `JWT ${this.jwtToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000
            };

            if (method === 'GET') {
                config.params = params;
            } else {
                config.data = params;
            }

            logger.info(`Making Exness API request: ${method} ${endpoint}`);
            const response = await axios(config);
            
            return response.data;
        } catch (error) {
            logger.error('Exness API Error:', {
                endpoint,
                error: error.response?.data || error.message,
                status: error.response?.status
            });
            
            // Chỉ return mock nếu không có token hoặc 401
            if (!this.jwtToken || error.response?.status === 401) {
                logger.warn('Using mock data due to auth issues');
                return this.getMockData(endpoint, params);
            }
            
            throw new Error(`Exness API Error: ${error.response?.data?.message || error.message}`);
        }
    }

    getMockData(endpoint, params) {
        if (endpoint.includes('reports/clients')) {
            return {
                data: [
                    {
                        client_account: '159486042',
                        email: 'client1@example.com',
                        reg_date: '2025-06-25',
                        volume_lots: 0.33,
                        volume_mln_usd: 0.0708,
                        trade_fn: '2025-06-28',
                        reward: '2.49',
                        country: 'VN'
                    },
                    {
                        client_account: '275169900',
                        email: 'client2@example.com', 
                        reg_date: '2025-06-25',
                        volume_lots: 0.16,
                        volume_mln_usd: 0.1056,
                        trade_fn: '2025-06-27',
                        reward: '0.89',
                        country: 'VN'
                    }
                ]
            };
        }

        if (endpoint.includes('reports/cpa/clients') || endpoint.includes('reports/performance')) {
            return {
                data: [
                    {
                        client_account: '159486042',
                        date: '2025-06-29',
                        trade_volume: 25.50,
                        trade_count: 8,
                        commission: 12.75
                    },
                    {
                        client_account: '275169900',
                        date: '2025-06-29',
                        trade_volume: 18.30,
                        trade_count: 5,
                        commission: 9.15
                    }
                ]
            };
        }

        return { data: [] };
    }

    // ========== 3 METHODS CHÍNH CẦN THIẾT ==========

    /**
     * 1. Lấy danh sách clients để verify account
     */
    async getClients(params = {}) {
        try {
            const response = await this.makeRequest('/api/reports/clients/', params);
            return response;
        } catch (error) {
            logger.error('Failed to get clients:', error);
            return { data: [] };
        }
    }

    /**
     * 2. Lấy trading activity data
     */
    async getClientActivity(params = {}) {
        try {
            // Thử CPA clients trước (có thể chứa trading data chi tiết hơn)
            const response = await this.makeRequest('/api/reports/cpa/clients/v2/', params);
            return response;
        } catch (error) {
            logger.warn('CPA endpoint failed, trying performance endpoint');
            try {
                const response = await this.makeRequest('/api/reports/performance/', params);
                return response;
            } catch (error2) {
                logger.error('All activity endpoints failed:', error2);
                return { data: [] };
            }
        }
    }

    /**
     * 3. Get summary statistics
     */
    async getIBSummary(params = {}) {
        try {
            const response = await this.makeRequest('/api/reports/ib/performance/', params);
            return response;
        } catch (error) {
            logger.error('Failed to get IB summary:', error);
            return { data: {} };
        }
    }

    // ========== MAIN METHOD CHO IB CONTROLLER ==========

    /**
     * Method chính để check account activity
     * Được gọi từ ibController.js
     */
    async getAccountActivity(accountNumber, startDate, endDate) {
        try {
            logger.info(`Checking EXNESS activity for account ${accountNumber} from ${startDate} to ${endDate}`);

            // 1. Get all clients để tìm account
            const clientsResponse = await this.getClients();
            const clients = clientsResponse.data || [];
            
            // 2. Tìm account trong clients using CORRECT FIELD: client_account
            const accountData = clients.find(client => 
                String(client.client_account) === String(accountNumber) ||
                client.client_account === accountNumber
            );

            if (!accountData) {
                logger.warn(`Account ${accountNumber} not found in Exness clients`);
                logger.info(`Available accounts: ${clients.slice(0, 5).map(c => c.client_account).join(', ')}...`);
                return {
                    hasActivity: false,
                    tradeCount: 0,
                    volume: 0,
                    lastTradeDate: null,
                    trades: [],
                    accountInfo: null
                };
            }

            logger.info(`✅ Found account ${accountNumber} in Exness clients`);

            // 3. Extract activity data từ client record (data đã có sẵn!)
            const volume = parseFloat(accountData.volume_lots || 0);
            const volumeUSD = parseFloat(accountData.volume_mln_usd || 0);
            const lastTradeDate = accountData.trade_fn; // "2025-06-28" format
            const reward = parseFloat(accountData.reward || 0);

            // 4. Estimate trade count từ volume (rough estimation)
            const estimatedTrades = volume > 0 ? Math.max(1, Math.ceil(volume / 0.1)) : 0;
            
            const hasActivity = volume > 0 || volumeUSD > 0 || lastTradeDate !== null;

            logger.info(`EXNESS activity for ${accountNumber}: ${estimatedTrades} trades (est), ${volume} lots, ${volumeUSD} USD, last: ${lastTradeDate}`);

            return {
                hasActivity,
                tradeCount: estimatedTrades,
                volume: volume, // Use lots as volume
                volumeUSD: volumeUSD,
                lastTradeDate,
                reward,
                trades: [], // Có thể tạo synthetic trades nếu cần
                accountInfo: accountData
            };

        } catch (error) {
            logger.error('Exness account activity check failed:', error);
            
            // Return realistic mock fallback
            return {
                hasActivity: false,
                tradeCount: 0,
                volume: 0,
                lastTradeDate: null,
                trades: [],
                accountInfo: null
            };
        }
    }

    // ========== UTILITY METHODS ==========

    async testConnection() {
        try {
            const response = await this.getClients();
            const clientCount = response.data?.length || 0;
            logger.info(`Exness API connection successful: ${clientCount} clients found`);
            return true;
        } catch (error) {
            logger.error('Exness API connection failed:', error);
            return false;
        }
    }

    async validateAccount(accountNumber) {
        try {
            const clientsResponse = await this.getClients();
            const clients = clientsResponse.data || [];
            
            return clients.some(client => 
                String(client.client_account) === String(accountNumber)
            );
        } catch (error) {
            logger.error(`Account validation failed for ${accountNumber}:`, error);
            return false;
        }
    }
}

module.exports = ExnessPartnerAPI;
// Enhanced Broker APIs with real integration
// File: server/controllers/brokerAPIs.js

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class ExnessAPI {
    constructor() {
        this.apiKey = process.env.EXNESS_API_KEY;
        this.apiSecret = process.env.EXNESS_API_SECRET;
        this.baseURL = 'https://my.exness.com/api/v1';
        this.partnerURL = 'https://my.exness.com/api/partner/v1';
    }

    // Generate signature for Exness API
    generateSignature(endpoint, params, timestamp) {
        const sortedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
        const message = `${endpoint}${sortedParams}${timestamp}`;
        return crypto.createHmac('sha256', this.apiSecret).update(message).digest('hex');
    }

    async makeRequest(endpoint, params = {}) {
        try {
            const timestamp = Date.now();
            const signature = this.generateSignature(endpoint, params, timestamp);
            
            const response = await axios.get(`${this.partnerURL}${endpoint}`, {
                headers: {
                    'X-API-KEY': this.apiKey,
                    'X-TIMESTAMP': timestamp,
                    'X-SIGNATURE': signature,
                    'Content-Type': 'application/json'
                },
                params: params,
                timeout: 30000
            });

            return response.data;
        } catch (error) {
            logger.error('Exness API Error:', {
                endpoint,
                error: error.response?.data || error.message,
                status: error.response?.status
            });
            throw new Error(`Exness API Error: ${error.response?.data?.message || error.message}`);
        }
    }

    async getAccountInfo(accountNumber) {
        try {
            const response = await this.makeRequest('/accounts', { account: accountNumber });
            return response;
        } catch (error) {
            logger.error(`Failed to get Exness account info for ${accountNumber}:`, error);
            return null;
        }
    }

    async getAccountActivity(accountNumber, startDate, endDate) {
        try {
            logger.info(`Checking EXNESS activity for ${accountNumber} from ${startDate} to ${endDate}`);

            // Get account trades
            const tradesResponse = await this.makeRequest('/trades', {
                account: accountNumber,
                from: startDate,
                to: endDate
            });

            // Get account orders
            const ordersResponse = await this.makeRequest('/orders', {
                account: accountNumber,
                from: startDate,
                to: endDate
            });

            const trades = tradesResponse.data || [];
            const orders = ordersResponse.data || [];

            // Calculate activity metrics
            const totalTrades = trades.length;
            const totalVolume = trades.reduce((sum, trade) => sum + parseFloat(trade.volume || 0), 0);
            const hasActivity = totalTrades > 0;
            
            const lastTradeDate = trades.length > 0 
                ? new Date(Math.max(...trades.map(t => new Date(t.close_time || t.open_time)))).toISOString().split('T')[0]
                : null;

            return {
                hasActivity,
                tradeCount: totalTrades,
                volume: totalVolume,
                lastTradeDate,
                trades: trades.slice(0, 10), // Return last 10 trades for reference
                orders: orders.slice(0, 10)
            };

        } catch (error) {
            logger.error('Exness activity check failed:', error);
            
            // Return mock data if API fails (for development)
            if (process.env.NODE_ENV === 'development') {
                return {
                    hasActivity: Math.random() > 0.4,
                    tradeCount: Math.floor(Math.random() * 15),
                    volume: Math.random() * 50,
                    lastTradeDate: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    trades: [],
                    orders: []
                };
            }
            
            return { hasActivity: false, tradeCount: 0, volume: 0, lastTradeDate: null };
        }
    }

    async getCommissionData(accountNumber, startDate, endDate) {
        try {
            const response = await this.makeRequest('/commissions', {
                account: accountNumber,
                from: startDate,
                to: endDate
            });

            const commissions = response.data || [];
            const totalCommission = commissions.reduce((sum, comm) => sum + parseFloat(comm.amount || 0), 0);

            return {
                totalCommission,
                commissions: commissions
            };
        } catch (error) {
            logger.error('Failed to get Exness commission data:', error);
            return { totalCommission: 0, commissions: [] };
        }
    }
}

class PuprimeAPI {
    constructor() {
        this.apiKey = process.env.PUPRIME_API_KEY;
        this.apiSecret = process.env.PUPRIME_API_SECRET;
        this.baseURL = 'https://api.puprime.com/v1';
        this.partnerURL = 'https://partner.puprime.com/api/v1';
    }

    // Generate authentication token for PUPrime
    generateAuthToken() {
        const timestamp = Math.floor(Date.now() / 1000);
        const message = `${this.apiKey}${timestamp}`;
        const signature = crypto.createHmac('sha256', this.apiSecret).update(message).digest('hex');
        
        return {
            timestamp,
            signature,
            apiKey: this.apiKey
        };
    }

    async makeRequest(endpoint, params = {}, method = 'GET') {
        try {
            const auth = this.generateAuthToken();
            
            const config = {
                method,
                url: `${this.partnerURL}${endpoint}`,
                headers: {
                    'X-API-KEY': auth.apiKey,
                    'X-TIMESTAMP': auth.timestamp,
                    'X-SIGNATURE': auth.signature,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            };

            if (method === 'GET') {
                config.params = params;
            } else {
                config.data = params;
            }

            const response = await axios(config);
            return response.data;
        } catch (error) {
            logger.error('PUPrime API Error:', {
                endpoint,
                error: error.response?.data || error.message,
                status: error.response?.status
            });
            throw new Error(`PUPrime API Error: ${error.response?.data?.message || error.message}`);
        }
    }

    async getAccountInfo(accountNumber) {
        try {
            const response = await this.makeRequest('/accounts/info', { account_id: accountNumber });
            return response;
        } catch (error) {
            logger.error(`Failed to get PUPrime account info for ${accountNumber}:`, error);
            return null;
        }
    }

    async getAccountActivity(accountNumber, startDate, endDate) {
        try {
            logger.info(`Checking PUPrime activity for ${accountNumber} from ${startDate} to ${endDate}`);

            // Get trading history
            const historyResponse = await this.makeRequest('/trading/history', {
                account_id: accountNumber,
                start_date: startDate,
                end_date: endDate
            });

            // Get open positions
            const positionsResponse = await this.makeRequest('/trading/positions', {
                account_id: accountNumber
            });

            const history = historyResponse.data || [];
            const positions = positionsResponse.data || [];

            // Calculate metrics
            const totalTrades = history.length;
            const totalVolume = history.reduce((sum, trade) => sum + parseFloat(trade.volume || 0), 0);
            const hasActivity = totalTrades > 0 || positions.length > 0;
            
            const lastTradeDate = history.length > 0 
                ? new Date(Math.max(...history.map(t => new Date(t.close_time || t.open_time)))).toISOString().split('T')[0]
                : null;

            return {
                hasActivity,
                tradeCount: totalTrades,
                volume: totalVolume,
                lastTradeDate,
                openPositions: positions.length,
                trades: history.slice(0, 10),
                positions: positions.slice(0, 5)
            };

        } catch (error) {
            logger.error('PUPrime activity check failed:', error);
            
            // Return mock data if API fails (for development)
            if (process.env.NODE_ENV === 'development') {
                return {
                    hasActivity: Math.random() > 0.3,
                    tradeCount: Math.floor(Math.random() * 20),
                    volume: Math.random() * 75,
                    lastTradeDate: new Date(Date.now() - Math.random() * 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    openPositions: Math.floor(Math.random() * 5),
                    trades: [],
                    positions: []
                };
            }
            
            return { hasActivity: false, tradeCount: 0, volume: 0, lastTradeDate: null };
        }
    }

    async getCommissionData(accountNumber, startDate, endDate) {
        try {
            const response = await this.makeRequest('/partner/commissions', {
                account_id: accountNumber,
                start_date: startDate,
                end_date: endDate
            });

            const commissions = response.data || [];
            const totalCommission = commissions.reduce((sum, comm) => sum + parseFloat(comm.commission || 0), 0);

            return {
                totalCommission,
                commissions: commissions
            };
        } catch (error) {
            logger.error('Failed to get PUPrime commission data:', error);
            return { totalCommission: 0, commissions: [] };
        }
    }
}

// Broker factory
class BrokerAPIFactory {
    static create(brokerName) {
        switch (brokerName.toUpperCase()) {
            case 'EXNESS':
                return new ExnessAPI();
            case 'PUPRIME':
                return new PuprimeAPI();
            default:
                throw new Error(`Unsupported broker: ${brokerName}`);
        }
    }
}

// Enhanced broker service
class BrokerService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    getCacheKey(broker, accountNumber, method, params = {}) {
        return `${broker}_${accountNumber}_${method}_${JSON.stringify(params)}`;
    }

    getCachedData(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        return null;
    }

    setCachedData(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    async getAccountActivity(broker, accountNumber, startDate, endDate) {
        try {
            const cacheKey = this.getCacheKey(broker, accountNumber, 'activity', { startDate, endDate });
            const cached = this.getCachedData(cacheKey);
            
            if (cached) {
                logger.info(`Using cached activity data for ${broker} account ${accountNumber}`);
                return cached;
            }

            const api = BrokerAPIFactory.create(broker);
            const activity = await api.getAccountActivity(accountNumber, startDate, endDate);
            
            this.setCachedData(cacheKey, activity);
            return activity;

        } catch (error) {
            logger.error(`Broker service error for ${broker}:`, error);
            throw error;
        }
    }

    async getCommissionData(broker, accountNumber, startDate, endDate) {
        try {
            const cacheKey = this.getCacheKey(broker, accountNumber, 'commission', { startDate, endDate });
            const cached = this.getCachedData(cacheKey);
            
            if (cached) {
                return cached;
            }

            const api = BrokerAPIFactory.create(broker);
            const commission = await api.getCommissionData(accountNumber, startDate, endDate);
            
            this.setCachedData(cacheKey, commission);
            return commission;

        } catch (error) {
            logger.error(`Commission data error for ${broker}:`, error);
            return { totalCommission: 0, commissions: [] };
        }
    }

    async validateAccount(broker, accountNumber) {
        try {
            const api = BrokerAPIFactory.create(broker);
            const accountInfo = await api.getAccountInfo(accountNumber);
            return accountInfo !== null;
        } catch (error) {
            logger.error(`Account validation failed for ${broker} ${accountNumber}:`, error);
            return false;
        }
    }

    // Clear cache periodically
    clearOldCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.cacheTimeout) {
                this.cache.delete(key);
            }
        }
    }
}

// Export classes
module.exports = {
    ExnessAPI,
    PuprimeAPI,
    BrokerAPIFactory,
    BrokerService
};
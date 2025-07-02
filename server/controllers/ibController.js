const moment = require('moment');
const db = require('../config/database');
const logger = require('../utils/logger');
const ExnessPartnerAPI = require('./exnessAPI');

// Mock PUPrime API (since PUPrime is updating)
class PuprimeAPI {
    constructor() {
        this.apiKey = process.env.PUPRIME_API_KEY || 'mock_key';
        this.apiSecret = process.env.PUPRIME_API_SECRET || 'mock_secret';
    }

    async getAccountActivity(accountNumber, startDate, endDate) {
        try {
            logger.info(`Checking PUPrime activity (MOCK) for ${accountNumber} from ${startDate} to ${endDate}`);
            
            // Mock response since PUPrime is updating
            return {
                hasActivity: Math.random() > 0.3,
                tradeCount: Math.floor(Math.random() * 20),
                volume: Math.random() * 75,
                lastTradeDate: new Date(Date.now() - Math.random() * 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                openPositions: Math.floor(Math.random() * 5),
                trades: [],
                positions: []
            };
        } catch (error) {
            logger.error('PUPrime activity check failed:', error);
            return { hasActivity: false, tradeCount: 0, volume: 0, lastTradeDate: null };
        }
    }
}

// Enhanced IB tracking with real-time monitoring
class IBManager {
    constructor() {
        this.brokerAPIs = {
            'EXNESS': new ExnessPartnerAPI(),
            'PUPrime': new PuprimeAPI()
        };
        
        // Test Exness API connection on startup
        this.testExnessConnection();
    }

    async testExnessConnection() {
        try {
            const exnessAPI = this.brokerAPIs['EXNESS'];
            const isConnected = await exnessAPI.testConnection();
            
            if (isConnected) {
                logger.info('✅ REAL Exness API connected successfully!');
            } else {
                logger.warn('⚠️ Exness API connection failed, using mock data');
            }
        } catch (error) {
            logger.error('❌ Exness API connection test failed:', error);
        }
    }

    // Real-time activity checker với cron job
    async checkAllUsersActivity() {
        try {
            const [users] = await db.query(`
                SELECT u.id, u.username, u.broker, u.account_number, u.referral_code,
                       l.license_key, l.last_trade_date, l.status
                FROM users u 
                LEFT JOIN licenses l ON u.id = l.user_id 
                WHERE l.status = 'active'
            `);

            logger.info(`🔍 Checking activity for ${users.length} active users using SIMPLIFIED APIs`);

            for (const user of users) {
                await this.checkUserActivity(user);
                // Delay để tránh rate limit
                await this.delay(2000);
            }
        } catch (error) {
            logger.error('Bulk activity check error:', error);
        }
    }

    async checkUserActivity(user) {
        try {
            const broker = this.brokerAPIs[user.broker];
            if (!broker) {
                logger.warn(`No API handler for broker: ${user.broker}`);
                return;
            }

            // Check last 7 days activity
            const endDate = moment();
            const startDate = moment().subtract(7, 'days');
            
            logger.info(`🔍 Checking ${user.broker} activity for user ${user.username} (Account: ${user.account_number})`);
            
            const activity = await broker.getAccountActivity(
                user.account_number, 
                startDate.format('YYYY-MM-DD'),
                endDate.format('YYYY-MM-DD')
            );

            if (activity.hasActivity) {
                // Update last activity
                await this.updateUserActivity(user.id, activity);
                logger.info(`✅ User ${user.username} has activity: ${activity.tradeCount} trades, ${activity.volume} volume`);
            } else {
                // Check if should revoke license
                const daysSinceLastTrade = moment().diff(moment(user.last_trade_date), 'days');
                if (daysSinceLastTrade > 7) {
                    await this.revokeUserLicense(user.id, 'No trading activity');
                    logger.warn(`❌ License revoked for ${user.username} - ${daysSinceLastTrade} days inactive`);
                }
            }
        } catch (error) {
            logger.error(`Activity check failed for user ${user.id}:`, error);
        }
    }

    async updateUserActivity(userId, activity) {
        try {
            // Update licenses table
            await db.query(
                'UPDATE licenses SET last_trade_date = NOW() WHERE user_id = ? AND status = "active"',
                [userId]
            );

            // Insert into referral_activities table for tracking
            await db.query(`
                INSERT INTO referral_activities (user_id, activity_date, trade_volume, trade_count)
                VALUES (?, CURDATE(), ?, ?)
                ON DUPLICATE KEY UPDATE 
                trade_volume = VALUES(trade_volume),
                trade_count = VALUES(trade_count)
            `, [userId, activity.volume, activity.tradeCount]);

            // Update ib_tracking table
            await db.query(`
                INSERT INTO ib_tracking (user_id, broker, account_number, referral_code, 
                                       registration_date, last_activity, total_volume, total_trades)
                SELECT id, broker, account_number, referral_code, created_date, NOW(), ?, ?
                FROM users WHERE id = ?
                ON DUPLICATE KEY UPDATE 
                last_activity = NOW(),
                total_volume = total_volume + VALUES(total_volume),
                total_trades = total_trades + VALUES(total_trades)
            `, [activity.volume, activity.tradeCount, userId]);

            logger.info(`📊 Updated activity for user ${userId}: ${activity.tradeCount} trades, ${activity.volume} volume`);

        } catch (error) {
            logger.error('Update user activity error:', error);
        }
    }

    async revokeUserLicense(userId, reason) {
        try {
            await db.query(
                'UPDATE licenses SET status = "revoked", updated_date = NOW() WHERE user_id = ?',
                [userId]
            );

            // Update ib_tracking
            await db.query(
                'UPDATE ib_tracking SET status = "inactive", updated_date = NOW() WHERE user_id = ?',
                [userId]
            );

            // Insert notification
            await db.query(`
                INSERT INTO notifications (user_id, type, title, message)
                VALUES (?, 'license_revoked', 'License Revoked', ?)
            `, [userId, `Your license has been revoked. Reason: ${reason}`]);

            logger.info(`🚫 License revoked for user ${userId}: ${reason}`);
        } catch (error) {
            logger.error('License revocation error:', error);
        }
    }

    async getIBStats() {
        try {
            logger.info('📊 Getting IB stats with SIMPLIFIED API data...');
            
            const [stats] = await db.query(`
                SELECT 
                    COUNT(DISTINCT u.id) as total_users,
                    COUNT(DISTINCT CASE WHEN l.status = 'active' THEN u.id END) as active_users,
                    u.broker,
                    COUNT(DISTINCT CASE WHEN ra.activity_date >= CURDATE() - INTERVAL 7 DAY THEN u.id END) as active_last_7_days,
                    COALESCE(SUM(ra.trade_volume), 0) as total_volume,
                    COALESCE(SUM(ra.trade_count), 0) as total_trades
                FROM users u
                LEFT JOIN licenses l ON u.id = l.user_id
                LEFT JOIN referral_activities ra ON u.id = ra.user_id AND ra.activity_date >= CURDATE() - INTERVAL 30 DAY
                GROUP BY u.broker
            `);
    
            // Add API status info
            const enrichedStats = stats.map(stat => ({
                ...stat,
                api_status: stat.broker === 'EXNESS' ? 'simplified_api' : 'mock'
            }));
    
            return enrichedStats;
        } catch (error) {
            logger.error('Get IB stats error:', error);
            return [];
        }
    }

    async getUsersAtRisk() {
        try {
            const [users] = await db.query(`
                SELECT u.id, u.username, u.broker, u.account_number,
                       l.license_key, l.last_trade_date,
                       DATEDIFF(NOW(), l.last_trade_date) as days_inactive
                FROM users u
                JOIN licenses l ON u.id = l.user_id
                WHERE l.status = 'active' 
                AND DATEDIFF(NOW(), l.last_trade_date) > 5
                ORDER BY days_inactive DESC
            `);

            return users;
        } catch (error) {
            logger.error('Get users at risk error:', error);
            return [];
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ========== CONTROLLER FUNCTIONS ==========

const ibManager = new IBManager();

const getIBStats = async (req, res) => {
    try {
        logger.info('🎯 API Request: Getting IB Stats');
        const stats = await ibManager.getIBStats();
        
        // Log which API is being used
        logger.info(`📈 Returning stats for ${stats.length} brokers`);
        stats.forEach(stat => {
            logger.info(`   ${stat.broker}: ${stat.total_users} users, API: ${stat.api_status}`);
        });
        
        res.json({ success: true, stats });
    } catch (error) {
        logger.error('Get IB stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const checkUserActivity = async (req, res) => {
    try {
        const { userId } = req.params;
        
        logger.info(`🔍 Manual activity check requested for user ${userId}`);
        
        const [users] = await db.query(`
            SELECT u.*, l.license_key, l.last_trade_date, l.status
            FROM users u 
            LEFT JOIN licenses l ON u.id = l.user_id 
            WHERE u.id = ?
        `, [userId]);

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        await ibManager.checkUserActivity(users[0]);
        
        logger.info(`✅ Activity check completed for user ${userId}`);
        res.json({ success: true, message: 'Activity check completed using SIMPLIFIED APIs' });
    } catch (error) {
        logger.error('Manual activity check error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getUserActivity = async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const [activities] = await db.query(`
            SELECT activity_date, trade_volume, trade_count, created_date
            FROM referral_activities 
            WHERE user_id = ? 
            ORDER BY activity_date DESC 
            LIMIT 30
        `, [userId]);

        res.json({ success: true, activities });
    } catch (error) {
        logger.error('Get user activity error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getUsersAtRisk = async (req, res) => {
    try {
        const users = await ibManager.getUsersAtRisk();
        res.json({ success: true, users });
    } catch (error) {
        logger.error('Get users at risk error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const revokeUserLicense = async (req, res) => {
    try {
        const { userId } = req.params;
        const { reason } = req.body;
        
        await ibManager.revokeUserLicense(userId, reason || 'Manual revocation');
        res.json({ success: true, message: 'License revoked successfully' });
    } catch (error) {
        logger.error('Revoke license error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const forceSyncAllUsers = async (req, res) => {
    try {
        logger.info('🔄 Force syncing all users with SIMPLIFIED API...');
        
        // Get all users (not just active license ones)
        const [users] = await db.query(`
            SELECT u.id, u.username, u.broker, u.account_number 
            FROM users u 
            WHERE u.broker IN ('EXNESS', 'PUPrime')
        `);

        logger.info(`🎯 Found ${users.length} users to sync`);
        const results = [];
        
        for (const user of users) {
            try {
                logger.info(`🔍 Syncing user: ${user.username} (${user.broker}) - Account: ${user.account_number}`);
                
                const broker = ibManager.brokerAPIs[user.broker];
                
                if (!broker) {
                    results.push({
                        userId: user.id,
                        username: user.username,
                        broker: user.broker,
                        status: 'error',
                        message: `No API handler for ${user.broker}`
                    });
                    continue;
                }

                // Get activity for last 30 days với simplified API
                const endDate = moment().format('YYYY-MM-DD');
                const startDate = moment().subtract(30, 'days').format('YYYY-MM-DD');
                
                const activity = await broker.getAccountActivity(
                    user.account_number, 
                    startDate, 
                    endDate
                );

                logger.info(`📊 Activity result for ${user.username}: hasActivity=${activity.hasActivity}, volume=${activity.volume}, trades=${activity.tradeCount}`);

                // Update database if has activity
                if (activity.hasActivity && (activity.volume > 0 || activity.tradeCount > 0)) {
                    await db.query(`
                        INSERT INTO referral_activities (user_id, activity_date, trade_volume, trade_count)
                        VALUES (?, CURDATE(), ?, ?)
                        ON DUPLICATE KEY UPDATE 
                        trade_volume = VALUES(trade_volume),
                        trade_count = VALUES(trade_count)
                    `, [user.id, activity.volume || 0, activity.tradeCount || 0]);

                    // Also update ib_tracking table
                    await db.query(`
                        INSERT INTO ib_tracking (user_id, broker, account_number, referral_code, 
                                               registration_date, last_activity, total_volume, total_trades)
                        SELECT id, broker, account_number, referral_code, created_date, NOW(), ?, ?
                        FROM users WHERE id = ?
                        ON DUPLICATE KEY UPDATE 
                        last_activity = NOW(),
                        total_volume = total_volume + VALUES(total_volume),
                        total_trades = total_trades + VALUES(total_trades)
                    `, [activity.volume || 0, activity.tradeCount || 0, user.id]);

                    logger.info(`✅ Database updated for user ${user.username}`);
                }

                results.push({
                    userId: user.id,
                    username: user.username,
                    broker: user.broker,
                    accountNumber: user.account_number,
                    status: 'success',
                    activity: {
                        hasActivity: activity.hasActivity,
                        volume: parseFloat((activity.volume || 0).toFixed(2)),
                        tradeCount: activity.tradeCount || 0,
                        lastTradeDate: activity.lastTradeDate
                    }
                });

                // Delay để tránh rate limit
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                logger.error(`Error syncing user ${user.id}:`, error);
                results.push({
                    userId: user.id,
                    username: user.username,
                    broker: user.broker,
                    status: 'error',
                    message: error.message
                });
            }
        }

        // Get updated stats sau khi sync
        logger.info('📈 Getting updated stats after sync...');
        const updatedStats = await ibManager.getIBStats();
        
        // Summary
        const successCount = results.filter(r => r.status === 'success').length;
        const errorCount = results.filter(r => r.status === 'error').length;
        const totalVolume = results
            .filter(r => r.status === 'success')
            .reduce((sum, r) => sum + (r.activity?.volume || 0), 0);
        const totalTrades = results
            .filter(r => r.status === 'success')
            .reduce((sum, r) => sum + (r.activity?.tradeCount || 0), 0);

        logger.info(`🎉 SIMPLIFIED API sync completed: ${successCount} success, ${errorCount} errors`);
        logger.info(`📊 Total synced: ${totalTrades} trades, ${totalVolume.toFixed(2)} volume`);
        
        res.json({
            success: true,
            message: `SIMPLIFIED API sync completed: ${successCount} users synced, ${errorCount} errors`,
            summary: {
                totalUsers: users.length,
                successCount,
                errorCount,
                totalVolume: parseFloat(totalVolume.toFixed(2)),
                totalTrades
            },
            results: results,
            updatedStats: updatedStats
        });

    } catch (error) {
        logger.error('Force sync error:', error);
        res.status(500).json({ error: error.message });
    }
};

const getAPIHealth = async (req, res) => {
    try {
        const health = {
            timestamp: new Date().toISOString(),
            apis: {}
        };
        
        // Test Exness với simplified API
        try {
            const exnessAPI = new ExnessPartnerAPI();
            const isConnected = await exnessAPI.testConnection();
            health.apis.exness = {
                status: isConnected ? 'connected' : 'failed',
                type: 'simplified_api',
                hasToken: !!process.env.EXNESS_JWT_TOKEN,
                baseURL: process.env.EXNESS_API_BASE_URL || 'https://my.exaffiliate.com'
            };
        } catch (error) {
            health.apis.exness = { 
                status: 'error', 
                type: 'simplified_api',
                error: error.message,
                hasToken: !!process.env.EXNESS_JWT_TOKEN
            };
        }
        
        // Test PUPrime
        health.apis.puprime = { 
            status: 'mock', 
            reason: 'API updating',
            hasKeys: !!(process.env.PUPRIME_API_KEY && process.env.PUPRIME_API_SECRET)
        };
        
        res.json({ success: true, health });
    } catch (error) {
        logger.error('API health check error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ========== DEBUG FUNCTIONS ==========

const debugExnessClients = async (req, res) => {
    try {
        logger.info('🔍 DEBUG: Getting all Exness clients...');
        
        const exnessAPI = new ExnessPartnerAPI();
        
        // 1. Get all clients
        const clientsResponse = await exnessAPI.getClients();
        const clients = clientsResponse.data || [];
        
        logger.info(`📊 Found ${clients.length} clients from Exness API`);
        
        // 2. Get sample activity data
        const activityResponse = await exnessAPI.getClientActivity({});
        const activities = activityResponse.data || [];
        
        logger.info(`📈 Found ${activities.length} activity records`);
        
        // 3. Phân tích data structure
        const clientSample = clients.slice(0, 5);
        const activitySample = activities.slice(0, 5);
        
        // 4. Extract unique account numbers
        const accountNumbers = [
            ...clients.map(c => c.client_account || c.account_number || c.account || c.id).filter(Boolean),
            ...activities.map(a => a.account_number || a.account || a.client_id).filter(Boolean)
        ];
        
        const uniqueAccounts = [...new Set(accountNumbers)].slice(0, 20);
        
        // 5. Field analysis
        const clientFields = clients.length > 0 ? Object.keys(clients[0]) : [];
        const activityFields = activities.length > 0 ? Object.keys(activities[0]) : [];
        
        res.json({
            success: true,
            debug_info: {
                timestamp: new Date().toISOString(),
                total_clients: clients.length,
                total_activities: activities.length,
                client_sample: clientSample,
                activity_sample: activitySample,
                unique_accounts: uniqueAccounts,
                client_fields: clientFields,
                activity_fields: activityFields,
                account_field_candidates: {
                    in_clients: clientFields.filter(field => 
                        field.toLowerCase().includes('account') || 
                        field.toLowerCase().includes('id') ||
                        field.toLowerCase().includes('number')
                    ),
                    in_activities: activityFields.filter(field => 
                        field.toLowerCase().includes('account') || 
                        field.toLowerCase().includes('id') ||
                        field.toLowerCase().includes('client')
                    )
                }
            },
            raw_data: {
                first_10_clients: clients.slice(0, 10),
                first_10_activities: activities.slice(0, 10)
            }
        });
        
    } catch (error) {
        logger.error('Debug Exness clients error:', error);
        res.status(500).json({ 
            error: error.message,
            stack: error.stack 
        });
    }
};

const testRealAccountActivity = async (req, res) => {
    try {
        const { accountNumber } = req.params;
        const { startDate, endDate } = req.query;
        
        logger.info(`🧪 TESTING real account activity for: ${accountNumber}`);
        
        const exnessAPI = new ExnessPartnerAPI();
        
        const activity = await exnessAPI.getAccountActivity(
            accountNumber, 
            startDate || '2025-05-01', 
            endDate || '2025-06-29'
        );
        
        res.json({
            success: true,
            test_result: {
                account_number: accountNumber,
                period: `${startDate || '2025-05-01'} to ${endDate || '2025-06-29'}`,
                activity: activity
            }
        });
        
    } catch (error) {
        logger.error('Test real account activity error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ========== LICENSE MANAGEMENT FUNCTIONS ==========

const reactivateUserLicense = async (req, res) => {
    try {
        const { userId } = req.params;
        const { reason } = req.body;
        
        logger.info(`🔄 Manual reactivation requested for user ${userId}`);
        
        // Check if user exists
        const [users] = await db.query('SELECT username FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Import reactivate function từ ibMonitor
        const { reactivateLicense } = require('../jobs/ibMonitor');
        await reactivateLicense(userId, reason || 'Manual reactivation by admin');
        
        logger.info(`✅ License reactivated for user ${userId}`);
        res.json({ 
            success: true, 
            message: `License reactivated successfully for user ${users[0].username}` 
        });
        
    } catch (error) {
        logger.error('Manual reactivate error:', error);
        res.status(500).json({ error: error.message });
    }
};

const getRevokedUsers = async (req, res) => {
    try {
        const [revokedUsers] = await db.query(`
            SELECT 
                u.id,
                u.username,
                u.email,
                u.account_number,
                u.broker,
                l.license_key,
                l.last_trade_date,
                l.updated_date as revoked_date,
                DATEDIFF(NOW(), l.last_trade_date) as days_since_last_trade
            FROM users u
            JOIN licenses l ON u.id = l.user_id
            WHERE l.status = 'revoked'
            ORDER BY l.updated_date DESC
            LIMIT 50
        `);

        res.json({ success: true, revokedUsers });
    } catch (error) {
        logger.error('Get revoked users error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const forceAutoRevokeCheck = async (req, res) => {
    try {
        logger.info('🚫 Manual auto-revoke check triggered');
        
        // Import auto-revoke function từ ibMonitor
        const { autoRevokeLicenses } = require('../jobs/ibMonitor');
        await autoRevokeLicenses();
        
        res.json({ 
            success: true, 
            message: 'Auto-revoke check completed successfully' 
        });
        
    } catch (error) {
        logger.error('Force auto-revoke error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ========== EXPORTS ==========
module.exports = { 
    IBManager, 
    getIBStats, 
    checkUserActivity, 
    getUserActivity, 
    getUsersAtRisk,
    revokeUserLicense,
    forceSyncAllUsers,
    getAPIHealth,
    debugExnessClients,
    testRealAccountActivity,
    reactivateUserLicense,
    getRevokedUsers,
    forceAutoRevokeCheck
};
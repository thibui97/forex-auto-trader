const moment = require('moment');
const db = require('../config/database');
const logger = require('../utils/logger');

const processWebhook = async (req, res) => {
    try {
        const { userId, licenseKey } = req.params;
        const signalData = req.body;

        logger.info(`Webhook received for user ${userId}:`, signalData);

        // Verify license
        const isValid = await checkLicense(userId, licenseKey);
        if (!isValid) {
            logger.warn(`Invalid license for user ${userId}`);
            return res.status(403).json({ error: 'License invalid or expired' });
        }

        // Validate signal data
        if (!signalData.symbol || !signalData.action || !signalData.volume) {
            return res.status(400).json({ error: 'Invalid signal data. Required: symbol, action, volume' });
        }

        // Validate action
        if (!['BUY', 'SELL'].includes(signalData.action.toUpperCase())) {
            return res.status(400).json({ error: 'Invalid action. Must be BUY or SELL' });
        }

        // Process trade signal
        const tradeId = await processTradeSignal(userId, signalData);

        // Update last trade date
        await updateLastTradeDate(userId);

        logger.info(`Trade processed successfully for user ${userId}, trade ID: ${tradeId}`);

        res.json({ 
            success: true, 
            tradeId: tradeId,
            message: 'Signal processed successfully',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Webhook processing error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const checkLicense = async (userId, licenseKey) => {
    try {
        const [licenses] = await db.query(
            `SELECT * FROM licenses 
             WHERE user_id = ? AND license_key = ? AND status = 'active'`,
            [userId, licenseKey]
        );

        if (licenses.length === 0) {
            logger.warn(`License not found for user ${userId} with key ${licenseKey}`);
            return false;
        }

        const license = licenses[0];
        const lastTrade = moment(license.last_trade_date);
        const daysSinceLastTrade = moment().diff(lastTrade, 'days');

        // If no trade in 7 days, revoke license
        if (daysSinceLastTrade > 7) {
            await revokeLicense(userId);
            logger.warn(`License expired for user ${userId} - ${daysSinceLastTrade} days since last trade`);
            return false;
        }

        return true;
    } catch (error) {
        logger.error('License check error:', error);
        return false;
    }
};

const processTradeSignal = async (userId, signalData) => {
    try {
        const [result] = await db.query(
            `INSERT INTO trades (user_id, symbol, action, volume, entry_price, stop_loss, take_profit, status, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
            [
                userId,
                signalData.symbol,
                signalData.action.toUpperCase(),
                parseFloat(signalData.volume) || 0.01,
                parseFloat(signalData.price) || 0,
                parseFloat(signalData.stopLoss) || 0,
                parseFloat(signalData.takeProfit) || 0
            ]
        );

        logger.info(`Trade signal saved to database: ${result.insertId}`);
        
        return result.insertId;
    } catch (error) {
        logger.error('Trade signal processing error:', error);
        throw error;
    }
};

const updateLastTradeDate = async (userId) => {
    try {
        await db.query(
            'UPDATE licenses SET last_trade_date = NOW() WHERE user_id = ? AND status = "active"',
            [userId]
        );
        logger.info(`Updated last trade date for user ${userId}`);
    } catch (error) {
        logger.error('Update last trade date error:', error);
    }
};

const revokeLicense = async (userId) => {
    try {
        await db.query(
            'UPDATE licenses SET status = "revoked" WHERE user_id = ?',
            [userId]
        );
        logger.info(`License revoked for user ${userId}`);
    } catch (error) {
        logger.error('License revocation error:', error);
    }
};

const getPendingTrades = async (req, res) => {
    try {
        const { userId, licenseKey } = req.params;

        // Verify license
        const isValid = await checkLicense(userId, licenseKey);
        if (!isValid) {
            return res.status(403).json({ error: 'License invalid or expired' });
        }

        // Get pending trades
        const [trades] = await db.query(
            `SELECT id, symbol, action, volume, entry_price, stop_loss, take_profit, timestamp
             FROM trades 
             WHERE user_id = ? AND status = 'pending'
             ORDER BY timestamp ASC
             LIMIT 50`,
            [userId]
        );

        logger.info(`Retrieved ${trades.length} pending trades for user ${userId}`);

        res.json({ 
            success: true,
            trades: trades,
            count: trades.length
        });

    } catch (error) {
        logger.error('Get pending trades error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const updateTradeStatus = async (req, res) => {
    try {
        const { tradeId, status, ticketNumber, userId } = req.body;

        // Validate input
        if (!tradeId || !status) {
            return res.status(400).json({ error: 'tradeId and status are required' });
        }

        if (!['executed', 'failed'].includes(status.toLowerCase())) {
            return res.status(400).json({ error: 'Status must be executed or failed' });
        }

        // Update trade
        const [result] = await db.query(
            'UPDATE trades SET status = ?, ticket_number = ?, executed_date = NOW() WHERE id = ?',
            [status.toLowerCase(), ticketNumber || null, tradeId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Trade not found' });
        }

        logger.info(`Trade ${tradeId} updated to status: ${status}, ticket: ${ticketNumber}`);

        res.json({ 
            success: true,
            message: `Trade ${tradeId} updated successfully`
        });

    } catch (error) {
        logger.error('Update trade status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getTradeHistory = async (req, res) => {
    try {
        const userId = req.user.userId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        // Get trades with pagination
        const [trades] = await db.query(
            `SELECT id, symbol, action, volume, entry_price, stop_loss, take_profit, 
                    status, ticket_number, timestamp, executed_date
             FROM trades 
             WHERE user_id = ? 
             ORDER BY timestamp DESC
             LIMIT ? OFFSET ?`,
            [userId, limit, offset]
        );

        // Get total count
        const [countResult] = await db.query(
            'SELECT COUNT(*) as total FROM trades WHERE user_id = ?',
            [userId]
        );

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            trades: trades,
            pagination: {
                page: page,
                limit: limit,
                total: total,
                totalPages: totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        logger.error('Get trade history error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    processWebhook,
    getPendingTrades,
    updateTradeStatus,
    getTradeHistory
};
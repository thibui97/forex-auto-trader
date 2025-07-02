const crypto = require('crypto');
const moment = require('moment');
const db = require('../config/database');
const logger = require('../utils/logger');

const createLicense = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Check if user already has an active license
        const [existingLicenses] = await db.query(
            'SELECT id FROM licenses WHERE user_id = ? AND status = "active"',
            [userId]
        );

        if (existingLicenses.length > 0) {
            return res.status(400).json({ error: 'User already has an active license' });
        }

        // Verify trading activity (simplified - you'll need to implement broker API integration)
        const hasActivity = await verifyTradingActivity(userId);
        if (!hasActivity) {
            return res.status(400).json({ 
                error: 'No trading activity found. Please trade using our referral link first.',
                message: 'You need to have trading activity to get a license'
            });
        }

        // Generate license key
        const licenseKey = crypto.randomBytes(32).toString('hex');

        // Insert license
        const [result] = await db.query(
            `INSERT INTO licenses (user_id, license_key, status, created_date, last_trade_date)
             VALUES (?, ?, 'active', NOW(), NOW())`,
            [userId, licenseKey]
        );

        logger.info(`License created for user ${userId}: ${licenseKey}`);

        res.json({
            message: 'License created successfully',
            licenseKey: licenseKey,
            licenseId: result.insertId,
            status: 'active'
        });

    } catch (error) {
        logger.error('License creation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getLicenseStatus = async (req, res) => {
    try {
        const userId = req.user.userId;

        const [licenses] = await db.query(
            `SELECT license_key, status, created_date, last_trade_date 
             FROM licenses WHERE user_id = ? ORDER BY created_date DESC LIMIT 1`,
            [userId]
        );

        if (licenses.length === 0) {
            return res.json({ 
                hasLicense: false,
                message: 'No license found. Please create a license first.'
            });
        }

        const license = licenses[0];
        const daysSinceLastTrade = moment().diff(moment(license.last_trade_date), 'days');

        res.json({
            hasLicense: true,
            licenseKey: license.license_key,
            status: license.status,
            createdDate: license.created_date,
            lastTradeDate: license.last_trade_date,
            daysSinceLastTrade: daysSinceLastTrade,
            willExpireIn: Math.max(0, 7 - daysSinceLastTrade)
        });

    } catch (error) {
        logger.error('Get license status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const verifyTradingActivity = async (userId) => {
    try {
        // Get user broker info
        const [users] = await db.query('SELECT broker, account_number FROM users WHERE id = ?', [userId]);
        if (users.length === 0) return false;
        
        const user = users[0];
        
        // TODO: Implement actual broker API integration
        // For now, we'll return true for testing purposes
        // In production, you need to integrate with EXNESS/PUPrime APIs
        
        logger.info(`Checking trading activity for user ${userId}, broker: ${user.broker}, account: ${user.account_number}`);
        
        // Simplified check - in real implementation, call broker APIs
        if (user.broker === 'EXNESS') {
            return await checkExnessActivity(user.account_number);
        } else if (user.broker === 'PUPrime') {
            return await checkPuprimeActivity(user.account_number);
        }
        
        return false;
    } catch (error) {
        logger.error('Verify trading activity error:', error);
        return true; // Return true for testing - change to false in production
    }
};

const checkExnessActivity = async (accountNumber) => {
    // TODO: Implement EXNESS API integration
    // This is a placeholder - you need to integrate with EXNESS Partner API
    logger.info(`Checking EXNESS activity for account: ${accountNumber}`);
    return true; // Placeholder - implement actual API call
};

const checkPuprimeActivity = async (accountNumber) => {
    // TODO: Implement PUPrime API integration  
    // This is a placeholder - you need to integrate with PUPrime Partner API
    logger.info(`Checking PUPrime activity for account: ${accountNumber}`);
    return true; // Placeholder - implement actual API call
};

module.exports = { createLicense, getLicenseStatus };
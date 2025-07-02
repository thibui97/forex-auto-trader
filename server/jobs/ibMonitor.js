const cron = require('node-cron');
const { IBManager } = require('../controllers/ibController');
const logger = require('../utils/logger');
const db = require('../config/database');

const ibManager = new IBManager();

// Run every 6 hours
cron.schedule('0 */6 * * *', async () => {
    logger.info('Starting scheduled IB activity check...');
    try {
        await ibManager.checkAllUsersActivity();
        logger.info('Scheduled IB activity check completed');
    } catch (error) {
        logger.error('Scheduled IB activity check failed:', error);
    }
});

// Run daily at 2 AM for cleanup
cron.schedule('0 2 * * *', async () => {
    logger.info('Starting daily license cleanup...');
    try {
        await cleanupExpiredData();
        logger.info('Daily cleanup completed');
    } catch (error) {
        logger.error('Daily cleanup failed:', error);
    }
});

// ========== THÊM: AUTO-REVOKE LICENSES DAILY AT 3 AM ==========
cron.schedule('0 3 * * *', async () => {
    logger.info('🚫 Starting daily auto-revoke check...');
    try {
        await autoRevokeLicenses();
        logger.info('✅ Auto-revoke check completed');
    } catch (error) {
        logger.error('❌ Auto-revoke check failed:', error);
    }
});

// Run every hour to check users at risk
cron.schedule('0 * * * *', async () => {
    logger.info('Checking users at risk...');
    try {
        const users = await ibManager.getUsersAtRisk();
        if (users.length > 0) {
            logger.warn(`Found ${users.length} users at risk of license revocation`);
            
            // Send warning notifications to users with 6 days inactive
            for (const user of users) {
                if (user.days_inactive === 6) {
                    await sendWarningNotification(user);
                }
            }
        }
    } catch (error) {
        logger.error('Users at risk check failed:', error);
    }
});

// ========== THÊM: AUTO-REVOKE FUNCTION ==========
async function autoRevokeLicenses() {
    try {
        logger.info('🔍 Scanning for licenses to auto-revoke...');
        
        // Find users with licenses inactive for 7+ days
        const [usersToRevoke] = await db.query(`
            SELECT 
                u.id,
                u.username,
                u.email,
                u.account_number,
                u.broker,
                l.license_key,
                l.last_trade_date,
                DATEDIFF(NOW(), l.last_trade_date) as days_inactive
            FROM users u
            JOIN licenses l ON u.id = l.user_id
            WHERE l.status = 'active'
            AND (
                l.last_trade_date IS NULL 
                OR DATEDIFF(NOW(), l.last_trade_date) >= 7
            )
            ORDER BY days_inactive DESC
        `);

        if (usersToRevoke.length === 0) {
            logger.info('✅ No licenses need to be revoked');
            return;
        }

        logger.info(`🚫 Found ${usersToRevoke.length} licenses to revoke`);

        let revokedCount = 0;
        let errors = 0;

        for (const user of usersToRevoke) {
            try {
                // Double-check với real-time API trước khi revoke
                const hasRecentActivity = await verifyUserActivity(user);
                
                if (!hasRecentActivity) {
                    // Revoke license
                    await revokeLicense(user);
                    revokedCount++;
                    
                    logger.warn(`🚫 License revoked: ${user.username} (${user.days_inactive} days inactive)`);
                } else {
                    logger.info(`✅ User ${user.username} has recent activity, keeping license`);
                }
                
                // Delay để tránh spam API
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                errors++;
                logger.error(`Error processing user ${user.username}:`, error);
            }
        }

        logger.info(`📊 Auto-revoke completed: ${revokedCount} revoked, ${errors} errors, ${usersToRevoke.length - revokedCount - errors} kept`);

    } catch (error) {
        logger.error('Auto-revoke licenses error:', error);
    }
}

async function verifyUserActivity(user) {
    try {
        // Call real-time API để double-check activity
        const broker = ibManager.brokerAPIs[user.broker];
        if (!broker) {
            logger.warn(`No API for broker ${user.broker}, using database data`);
            return false; // Rely on database if no API
        }
        
        // Check last 7 days activity từ API
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        const activity = await broker.getAccountActivity(user.account_number, startDate, endDate);
        
        // Nếu có activity thì update database
        if (activity.hasActivity) {
            await db.query(
                'UPDATE licenses SET last_trade_date = NOW() WHERE user_id = ?',
                [user.id]
            );
            
            // Update activity tracking
            await ibManager.updateUserActivity(user.id, activity);
            
            logger.info(`✅ Updated activity for ${user.username}: ${activity.tradeCount} trades, ${activity.volume} volume`);
            return true; // Có activity, keep license
        }
        
        return false; // Không có activity, revoke license
        
    } catch (error) {
        logger.error(`Activity verification failed for user ${user.username}:`, error);
        return false; // Default to revoke if verification fails
    }
}

async function revokeLicense(user) {
    try {
        // 1. Revoke license
        await db.query(
            'UPDATE licenses SET status = "revoked", updated_date = NOW() WHERE user_id = ?',
            [user.id]
        );

        // 2. Update ib_tracking status
        await db.query(
            'UPDATE ib_tracking SET status = "inactive", updated_date = NOW() WHERE user_id = ?',
            [user.id]
        );

        // 3. Send notification to user
        await db.query(`
            INSERT INTO notifications (user_id, type, title, message, created_date)
            VALUES (?, 'license_revoked', 'License Expired', ?, NOW())
        `, [user.id, `Your trading license has been automatically revoked due to ${user.days_inactive || 7} days of inactivity. Start trading again to reactivate your license.`]);

        // 4. Log admin action
        await db.query(`
            INSERT INTO admin_logs (action_type, user_id, description, created_date)
            VALUES ('AUTO_REVOKE', ?, ?, NOW())
        `, [user.id, `License auto-revoked after ${user.days_inactive || 7} days of inactivity`]);

        logger.info(`✅ License revoked successfully for user ${user.username}`);
        
    } catch (error) {
        logger.error(`Failed to revoke license for user ${user.username}:`, error);
        throw error;
    }
}

// ========== THÊM: MANUAL REACTIVATE FUNCTION ==========
async function reactivateLicense(userId, reason = 'Manual reactivation') {
    try {
        // Reactivate license
        await db.query(
            'UPDATE licenses SET status = "active", last_trade_date = NOW(), updated_date = NOW() WHERE user_id = ?',
            [userId]
        );

        // Update ib_tracking
        await db.query(
            'UPDATE ib_tracking SET status = "active", updated_date = NOW() WHERE user_id = ?',
            [userId]
        );

        // Log action
        await db.query(`
            INSERT INTO admin_logs (action_type, user_id, description, created_date)
            VALUES ('REACTIVATE', ?, ?, NOW())
        `, [userId, reason]);

        // Send notification
        await db.query(`
            INSERT INTO notifications (user_id, type, title, message, created_date)
            VALUES (?, 'license_reactivated', 'License Reactivated', 'Your trading license has been reactivated. You can now use the trading tools again.', NOW())
        `, [userId]);

        logger.info(`✅ License reactivated for user ${userId}`);
        return true;
        
    } catch (error) {
        logger.error(`Failed to reactivate license for user ${userId}:`, error);
        throw error;
    }
}

async function cleanupExpiredData() {
    try {
        // Clean old referral activities (keep last 90 days)
        const [result1] = await db.query(
            'DELETE FROM referral_activities WHERE created_date < DATE_SUB(NOW(), INTERVAL 90 DAY)'
        );
        logger.info(`Cleaned up ${result1.affectedRows} old referral activities`);
        
        // Clean old notifications (keep last 30 days)
        const [result2] = await db.query(
            'DELETE FROM notifications WHERE created_date < DATE_SUB(NOW(), INTERVAL 30 DAY) AND is_read = TRUE'
        );
        logger.info(`Cleaned up ${result2.affectedRows} old notifications`);

        // Clean old admin logs (keep last 180 days)
        const [result3] = await db.query(
            'DELETE FROM admin_logs WHERE created_date < DATE_SUB(NOW(), INTERVAL 180 DAY)'
        );
        logger.info(`Cleaned up ${result3.affectedRows} old admin logs`);

    } catch (error) {
        logger.error('Cleanup error:', error);
    }
}

async function sendWarningNotification(user) {
    try {
        await db.query(`
            INSERT INTO notifications (user_id, type, title, message, created_date)
            VALUES (?, 'activity_warning', 'License Expiring Soon', ?, NOW())
        `, [user.id, `Your license will expire in 1 day due to inactivity. Please start trading to keep your license active.`]);
        
        logger.info(`Warning notification sent to user ${user.username}`);
    } catch (error) {
        logger.error(`Failed to send warning notification to user ${user.id}:`, error);
    }
}

logger.info('🤖 IB Monitor with Auto-Revoke system initialized');

module.exports = {
    cleanupExpiredData,
    sendWarningNotification,
    autoRevokeLicenses,     // ← THÊM
    reactivateLicense       // ← THÊM
};
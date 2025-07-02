// server/services/tokenRefreshService.js
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');

class TokenRefreshService {
    constructor() {
        this.envPath = path.join(__dirname, '../../.env');
        this.backupTokens = []; // Store multiple backup tokens
        this.currentTokenIndex = 0;
        this.refreshInterval = '0 */5 * * *'; // Every 5 hours
        
        // Load backup tokens from env or config
        this.loadBackupTokens();
        this.startAutoRefresh();
        this.startTokenValidation();
    }

    loadBackupTokens() {
        // You can add multiple backup tokens here
        this.backupTokens = [
            process.env.EXNESS_JWT_TOKEN,
            process.env.EXNESS_JWT_TOKEN_BACKUP_1,
            process.env.EXNESS_JWT_TOKEN_BACKUP_2,
            process.env.EXNESS_JWT_TOKEN_BACKUP_3
        ].filter(Boolean); // Remove undefined tokens

        logger.info(`📋 Loaded ${this.backupTokens.length} backup tokens`);
    }

    startAutoRefresh() {
        // Run every 5 hours to refresh token before it expires
        cron.schedule(this.refreshInterval, async () => {
            logger.info('🔄 Starting automatic EXNESS token refresh...');
            await this.refreshExnessToken();
        });

        logger.info('🤖 Token auto-refresh service initialized');
    }

    startTokenValidation() {
        // Check token validity every 30 minutes
        cron.schedule('*/30 * * * *', async () => {
            await this.validateCurrentToken();
        });

        logger.info('🔍 Token validation service initialized');
    }

    async validateCurrentToken() {
        try {
            const currentToken = process.env.EXNESS_JWT_TOKEN;
            const isValid = await this.testTokenValidity(currentToken);
            
            if (!isValid) {
                logger.warn('⚠️ Current token is invalid, attempting to switch to backup...');
                await this.switchToBackupToken();
            } else {
                logger.info('✅ Current token is valid');
            }
            
        } catch (error) {
            logger.error('Token validation error:', error);
        }
    }

    async testTokenValidity(token) {
        try {
            // Test token with a simple API call
            const response = await axios.get('https://my.exaffiliate.com/api/schema/api/reports/clients/', {
                headers: {
                    'Authorization': `JWT ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                params: { limit: 1 }, // Small request
                timeout: 10000
            });

            return response.status === 200;
            
        } catch (error) {
            if (error.response?.status === 401) {
                logger.warn('🔑 Token is expired or invalid');
                return false;
            }
            
            // Network or other errors - assume token is still valid
            logger.warn('⚠️ Token test failed due to network error, assuming valid');
            return true;
        }
    }

    async switchToBackupToken() {
        try {
            // Try each backup token
            for (let i = 0; i < this.backupTokens.length; i++) {
                const testToken = this.backupTokens[i];
                
                if (testToken && testToken !== process.env.EXNESS_JWT_TOKEN) {
                    logger.info(`🔄 Testing backup token ${i + 1}...`);
                    
                    const isValid = await this.testTokenValidity(testToken);
                    
                    if (isValid) {
                        await this.updateEnvFile(testToken);
                        logger.info(`✅ Switched to backup token ${i + 1}`);
                        return true;
                    }
                }
            }
            
            // No valid backup found
            logger.error('❌ No valid backup tokens found');
            await this.notifyTokenExpiry();
            return false;
            
        } catch (error) {
            logger.error('Backup token switch failed:', error);
            return false;
        }
    }

    async refreshExnessToken() {
        try {
            // First try to switch to a valid backup token
            const switched = await this.switchToBackupToken();
            
            if (switched) {
                logger.info('✅ Token refreshed using backup');
                return true;
            }
            
            // If no backup works, try to get new token from API
            const newToken = await this.getNewTokenFromAPI();
            
            if (newToken) {
                await this.updateEnvFile(newToken);
                logger.info('✅ EXNESS token refreshed from API');
                return true;
            } else {
                logger.warn('⚠️ Token refresh failed - manual update needed');
                await this.notifyTokenExpiry();
                return false;
            }

        } catch (error) {
            logger.error('❌ Token refresh error:', error);
            await this.notifyTokenExpiry();
            return false;
        }
    }

    async getNewTokenFromAPI() {
        try {
            // TODO: Implement actual EXNESS token refresh API
            // This would require EXNESS API credentials and refresh endpoint
            
            // For now, return null - implement when EXNESS provides refresh API
            logger.info('💡 API token refresh not implemented - using backup rotation');
            return null;
            
        } catch (error) {
            logger.error('Failed to get new token from API:', error);
            return null;
        }
    }

    async updateEnvFile(newToken) {
        try {
            let envContent = fs.readFileSync(this.envPath, 'utf8');
            
            // Replace old token with new token
            const tokenRegex = /EXNESS_JWT_TOKEN=.*/;
            envContent = envContent.replace(tokenRegex, `EXNESS_JWT_TOKEN=${newToken}`);
            
            // Backup old .env
            const backupPath = `${this.envPath}.backup.${Date.now()}`;
            fs.writeFileSync(backupPath, fs.readFileSync(this.envPath, 'utf8'));
            
            // Write new .env
            fs.writeFileSync(this.envPath, envContent, 'utf8');
            
            // Update process.env
            process.env.EXNESS_JWT_TOKEN = newToken;
            
            logger.info('✅ .env file updated with new token');
            
            // Clean old backups (keep last 5)
            this.cleanOldBackups();
            
        } catch (error) {
            logger.error('Failed to update .env file:', error);
            throw error;
        }
    }

    cleanOldBackups() {
        try {
            const envDir = path.dirname(this.envPath);
            const files = fs.readdirSync(envDir);
            const backupFiles = files
                .filter(file => file.startsWith('.env.backup.'))
                .sort()
                .reverse();

            // Keep only last 5 backups
            if (backupFiles.length > 5) {
                backupFiles.slice(5).forEach(file => {
                    fs.unlinkSync(path.join(envDir, file));
                });
                logger.info(`🧹 Cleaned ${backupFiles.length - 5} old backup files`);
            }
        } catch (error) {
            logger.error('Failed to clean old backups:', error);
        }
    }

    async notifyTokenExpiry() {
        try {
            const notificationPath = path.join(__dirname, '../../TOKEN_EXPIRED.txt');
            const message = `
⚠️ EXNESS TOKEN SYSTEM ALERT ⚠️
Time: ${new Date().toISOString()}

ALL EXNESS JWT TOKENS HAVE EXPIRED OR ARE INVALID

Immediate Action Required:
1. Login to EXNESS Partner portal: https://my.exness.com
2. Navigate to API section
3. Generate new JWT tokens
4. Update tokens in .env file:
   - EXNESS_JWT_TOKEN=your_new_primary_token
   - EXNESS_JWT_TOKEN_BACKUP_1=your_backup_token_1
   - EXNESS_JWT_TOKEN_BACKUP_2=your_backup_token_2
   - EXNESS_JWT_TOKEN_BACKUP_3=your_backup_token_3

5. Restart application: pm2 restart forex-auto-trader

System Impact:
- IB activity monitoring may be affected
- Client trading activity verification disabled
- Auto-trading system may not function properly

Current tokens expire every 6 hours.
Please update as soon as possible.

System Status: ${new Date().toLocaleString()}
`;
            
            fs.writeFileSync(notificationPath, message, 'utf8');
            logger.error('🚨 CRITICAL: All tokens expired - notification created');
            
            // Also create a flag file for dashboard
            const flagPath = path.join(__dirname, '../../TOKEN_ALERT_FLAG');
            fs.writeFileSync(flagPath, Date.now().toString());
            
        } catch (error) {
            logger.error('Failed to create expiry notification:', error);
        }
    }

    // API endpoint methods for manual management
    async getTokenStatus() {
        const currentToken = process.env.EXNESS_JWT_TOKEN;
        const isValid = await this.testTokenValidity(currentToken);
        
        return {
            currentTokenValid: isValid,
            backupTokensCount: this.backupTokens.length,
            lastRefresh: this.lastRefreshTime || 'Never',
            nextRefresh: 'Every 5 hours',
            tokenExpired: !isValid
        };
    }

    async manualRefresh(newTokens = null) {
        try {
            if (newTokens && Array.isArray(newTokens)) {
                // Update multiple tokens
                let envContent = fs.readFileSync(this.envPath, 'utf8');
                
                newTokens.forEach((token, index) => {
                    if (index === 0) {
                        envContent = envContent.replace(/EXNESS_JWT_TOKEN=.*/, `EXNESS_JWT_TOKEN=${token}`);
                    } else {
                        const backupKey = `EXNESS_JWT_TOKEN_BACKUP_${index}`;
                        const backupRegex = new RegExp(`${backupKey}=.*`);
                        
                        if (envContent.includes(backupKey)) {
                            envContent = envContent.replace(backupRegex, `${backupKey}=${token}`);
                        } else {
                            envContent += `\n${backupKey}=${token}`;
                        }
                    }
                });
                
                fs.writeFileSync(this.envPath, envContent, 'utf8');
                this.loadBackupTokens(); // Reload tokens
                
                logger.info(`✅ Manual refresh completed with ${newTokens.length} tokens`);
            } else {
                // Try backup rotation
                await this.switchToBackupToken();
            }
            
            // Remove alert files
            const notificationPath = path.join(__dirname, '../../TOKEN_EXPIRED.txt');
            const flagPath = path.join(__dirname, '../../TOKEN_ALERT_FLAG');
            
            [notificationPath, flagPath].forEach(file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            });
            
            this.lastRefreshTime = new Date().toISOString();
            return true;
            
        } catch (error) {
            logger.error('Manual token refresh failed:', error);
            return false;
        }
    }
}

module.exports = new TokenRefreshService();
// server/routes/admin.js - FIXED VERSION

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const logger = require('../utils/logger');
const ClientPackageGenerator = require('../controllers/packageGenerator');

// Initialize package generator
const packageGenerator = new ClientPackageGenerator();

// Middleware to authenticate admin requests
const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    const jwt = require('jsonwebtoken');
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Generate client package
router.post('/generate-package/:userId', authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        
        logger.info(`Admin generating package for user ${userId}`);
        
        const packageData = await packageGenerator.generatePackage(userId);
        
        res.json({
            success: true,
            message: 'Package generated successfully',
            ...packageData
        });
        
    } catch (error) {
        logger.error('Package generation error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Package generation failed' 
        });
    }
});

// Download package - SUPPORTS BOTH .txt AND .zip FILES
router.get('/download-package/:packageName', (req, res) => {
    try {
        const packageName = req.params.packageName;
        
        logger.info(`📥 Download request for: ${packageName}`);
        
        // Determine file type and path
        let filePath;
        let fileName;
        
        if (packageName.endsWith('.zip')) {
            // ZIP file download
            fileName = packageName;
            filePath = path.join(__dirname, '../client_packages', fileName);
        } else if (packageName.endsWith('.txt')) {
            // TXT file download
            fileName = packageName;
            filePath = path.join(__dirname, '../client_packages', fileName);
        } else {
            // Try different extensions
            const baseName = packageName;
            
            // Priority: ZIP first, then TXT
            const possibleFiles = [
                { name: `${baseName}.zip`, path: path.join(__dirname, '../client_packages', `${baseName}.zip`) },
                { name: `${baseName}.txt`, path: path.join(__dirname, '../client_packages', `${baseName}.txt`) }
            ];
            
            // Find existing file
            for (const file of possibleFiles) {
                if (fs.existsSync(file.path)) {
                    filePath = file.path;
                    fileName = file.name;
                    break;
                }
            }
            
            if (!filePath) {
                logger.error(`📁 No file found for package: ${packageName}`);
                
                // Debug: List available files
                const packagesDir = path.join(__dirname, '../client_packages');
                if (fs.existsSync(packagesDir)) {
                    const files = fs.readdirSync(packagesDir);
                    logger.info(`📂 Available files: ${files.join(', ')}`);
                }
                
                return res.status(404).json({ error: 'Package file not found' });
            }
        }
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            logger.error(`❌ File not found: ${filePath}`);
            return res.status(404).json({ error: 'Package file not found' });
        }
        
        // Get file stats
        const stats = fs.statSync(filePath);
        logger.info(`✅ Found file: ${fileName} (${stats.size} bytes)`);
        
        // Set appropriate headers based on file type
        if (fileName.endsWith('.zip')) {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        } else {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        }
        
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'no-cache');
        
        // Send file
        res.sendFile(filePath, (err) => {
            if (err) {
                logger.error('📤 File send error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Download failed' });
                }
            } else {
                logger.info(`📥 Package downloaded successfully: ${fileName}`);
            }
        });
        
    } catch (error) {
        logger.error('Download package error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Download specific file type (alternative endpoint)
router.get('/download-zip/:packageName', (req, res) => {
    try {
        const packageName = req.params.packageName;
        const fileName = packageName.endsWith('.zip') ? packageName : `${packageName}.zip`;
        const filePath = path.join(__dirname, '../client_packages', fileName);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'ZIP package not found' });
        }
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.sendFile(filePath);
        
        logger.info(`📦 ZIP package downloaded: ${fileName}`);
        
    } catch (error) {
        logger.error('Download ZIP error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Secure download with token in URL (alternative method)
router.get('/download-secure/:packageName/:token', (req, res) => {
    try {
        const { packageName, token } = req.params;
        
        // Verify token
        const jwt = require('jsonwebtoken');
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                logger.error('Token verification failed:', err);
                return res.status(401).json({ error: 'Invalid or expired token' });
            }
            
            // Determine file type
            let fileName = packageName;
            if (!packageName.includes('.')) {
                // Try ZIP first, then TXT
                const zipPath = path.join(__dirname, '../client_packages', `${packageName}.zip`);
                const txtPath = path.join(__dirname, '../client_packages', `${packageName}.txt`);
                
                if (fs.existsSync(zipPath)) {
                    fileName = `${packageName}.zip`;
                } else if (fs.existsSync(txtPath)) {
                    fileName = `${packageName}.txt`;
                } else {
                    return res.status(404).json({ error: 'Package file not found' });
                }
            }
            
            const filePath = path.join(__dirname, '../client_packages', fileName);
            
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: 'Package file not found' });
            }
            
            // Set headers based on file type
            if (fileName.endsWith('.zip')) {
                res.setHeader('Content-Type', 'application/zip');
            } else {
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            }
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.sendFile(filePath);
            
            logger.info(`🔒 Secure download completed: ${fileName} by user ${decoded.username}`);
        });
        
    } catch (error) {
        logger.error('Secure download error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all packages (admin only)
router.get('/packages', authenticateAdmin, (req, res) => {
    try {
        const packagesDir = path.join(__dirname, '../client_packages');
        
        if (!fs.existsSync(packagesDir)) {
            return res.json({ packages: [] });
        }
        
        const files = fs.readdirSync(packagesDir);
        const packages = files
            .filter(file => file.endsWith('.txt') || file.endsWith('.zip'))
            .map(file => {
                const filePath = path.join(packagesDir, file);
                const stats = fs.statSync(filePath);
                
                return {
                    name: file,
                    type: file.endsWith('.zip') ? 'Complete Package (ZIP)' : 'Text File',
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime
                };
            })
            .sort((a, b) => new Date(b.created) - new Date(a.created));
        
        res.json({ packages });
        
    } catch (error) {
        logger.error('Get packages error:', error);
        res.status(500).json({ error: 'Failed to get packages' });
    }
});

// Delete package (admin only)
router.delete('/package/:packageName', authenticateAdmin, (req, res) => {
    try {
        const packageName = req.params.packageName;
        
        // Delete both ZIP and TXT if they exist
        const baseName = packageName.replace(/\.(zip|txt)$/, '');
        const filesToDelete = [
            path.join(__dirname, '../client_packages', `${baseName}.zip`),
            path.join(__dirname, '../client_packages', `${baseName}.txt`),
            path.join(__dirname, '../client_packages', packageName)
        ];
        
        let deletedFiles = 0;
        
        filesToDelete.forEach(filePath => {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                deletedFiles++;
                logger.info(`🗑️ Deleted: ${path.basename(filePath)}`);
            }
        });
        
        if (deletedFiles === 0) {
            return res.status(404).json({ error: 'Package not found' });
        }
        
        res.json({ 
            success: true, 
            message: `Package deleted successfully (${deletedFiles} files)` 
        });
        
    } catch (error) {
        logger.error('Delete package error:', error);
        res.status(500).json({ error: 'Failed to delete package' });
    }
});

// Get admin dashboard stats
router.get('/stats', authenticateAdmin, async (req, res) => {
    try {
        // Get user statistics
        const [userStats] = await db.query(`
            SELECT 
                broker,
                COUNT(*) as total_users,
                COUNT(CASE WHEN l.status = 'active' THEN 1 END) as active_licenses,
                COUNT(CASE WHEN l.last_trade_date >= CURDATE() - INTERVAL 7 DAY THEN 1 END) as active_last_7_days
            FROM users u
            LEFT JOIN licenses l ON u.id = l.user_id
            GROUP BY broker
        `);
        
        // Get package statistics
        const packagesDir = path.join(__dirname, '../client_packages');
        let packageCount = 0;
        let zipCount = 0;
        
        if (fs.existsSync(packagesDir)) {
            const files = fs.readdirSync(packagesDir);
            packageCount = files.filter(file => file.endsWith('.txt')).length;
            zipCount = files.filter(file => file.endsWith('.zip')).length;
        }
        
        // Get recent activity
        const [recentActivity] = await db.query(`
            SELECT 
                u.username,
                u.broker,
                l.created_date,
                'license_created' as activity_type
            FROM users u
            JOIN licenses l ON u.id = l.user_id
            WHERE l.created_date >= CURDATE() - INTERVAL 7 DAY
            ORDER BY l.created_date DESC
            LIMIT 10
        `);
        
        res.json({
            success: true,
            stats: {
                users: userStats,
                packages: packageCount,
                zipPackages: zipCount,
                recent_activity: recentActivity
            }
        });
        
    } catch (error) {
        logger.error('Get admin stats error:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

// Manual token refresh (if needed)
router.post('/refresh-token', authenticateAdmin, async (req, res) => {
    try {
        // This would implement token refresh logic
        // For now, just return success
        res.json({ 
            success: true, 
            message: 'Token refresh not implemented yet',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('Token refresh error:', error);
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

// Health check
router.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'Admin API',
        version: '1.0.0'
    });
});

// Token Management Routes
const tokenService = require('../services/tokenRefreshService');

// Get token status
router.get('/token-status', authenticateAdmin, async (req, res) => {
    try {
        const status = await tokenService.getTokenStatus();
        res.json({ success: true, status });
    } catch (error) {
        logger.error('Get token status error:', error);
        res.status(500).json({ error: 'Failed to get token status' });
    }
});

// Manual token refresh
router.post('/refresh-tokens', authenticateAdmin, async (req, res) => {
    try {
        const { tokens } = req.body; // Array of new tokens
        const success = await tokenService.manualRefresh(tokens);
        
        if (success) {
            res.json({ success: true, message: 'Tokens refreshed successfully' });
        } else {
            res.status(500).json({ error: 'Token refresh failed' });
        }
    } catch (error) {
        logger.error('Manual token refresh error:', error);
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

// Force token validation
router.post('/validate-token', authenticateAdmin, async (req, res) => {
    try {
        await tokenService.validateCurrentToken();
        const status = await tokenService.getTokenStatus();
        res.json({ success: true, message: 'Token validation completed', status });
    } catch (error) {
        logger.error('Token validation error:', error);
        res.status(500).json({ error: 'Token validation failed' });
    }
});

module.exports = router;
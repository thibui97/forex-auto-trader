const express = require('express');
const cors = require('cors');
//const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const logger = require('./utils/logger');
const authRoutes = require('./routes/auth');
const licenseRoutes = require('./routes/license');
const webhookRoutes = require('./routes/webhook');
const ibRoutes = require('./routes/ib');
const adminRoutes = require('./routes/admin'); // ← DI CHUYỂN VÀO ĐÂY

const app = express();
const PORT = process.env.PORT || 3000;

// Import cron jobs AFTER app is created
require('./jobs/ibMonitor');

// Import token refresh service
require('./services/tokenRefreshService');

// Middleware
//app.use(helmet());
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001', 'https://your-domain.com'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve admin dashboard
app.use('/admin', express.static(path.join(__dirname, '../client/admin')));

// Logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path} - ${req.ip}`);
    next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/license', licenseRoutes);
app.use('/api', webhookRoutes);
app.use('/api/ib', ibRoutes);
app.use('/api/admin', adminRoutes); // ← SỬA: Dùng biến đã import

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Forex Auto Trading API Server',
        version: '1.0.0',
        endpoints: {
            health: '/health',
            auth: {
                register: 'POST /api/auth/register',
                login: 'POST /api/auth/login'
            },
            license: {
                create: 'POST /api/license/create',
                status: 'GET /api/license/status'
            },
            webhook: {
                tradingview: 'POST /api/webhook/:userId/:licenseKey',
                mt5_trades: 'GET /api/trades/:userId/:licenseKey',
                trade_feedback: 'POST /api/trade-feedback'
            },
            ib: {
                stats: 'GET /api/ib/stats',
                user_activity: 'GET /api/ib/user-activity',
                users_at_risk: 'GET /api/ib/users-at-risk',
                check_activity: 'POST /api/ib/check-activity/:userId',
                revoke_license: 'POST /api/ib/revoke/:userId',
                force_sync: 'POST /api/ib/force-sync',
                health_check: 'GET /api/ib/health'
            },
            admin: {
                dashboard: '/admin/fixed.html', // ← SỬA: Đúng tên file
                generate_package: 'POST /api/admin/generate-package/:userId' // ← THÊM
            }
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Route not found',
        path: req.originalUrl,
        method: req.method
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
});

app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`
        🚀 Forex Auto Trading Server Started!
        📍 Server: ${process.env.PUBLIC_URL || process.env.SERVER_URL || `http://localhost:${PORT}`}
        📍 Health: ${process.env.PUBLIC_URL || process.env.SERVER_URL || `http://localhost:${PORT}`}/health
        📍 Admin Dashboard: ${process.env.PUBLIC_URL || process.env.SERVER_URL || `http://localhost:${PORT}`}/admin/fixed.html
        📍 Environment: ${process.env.NODE_ENV || 'development'}
        📍 IB Management: ${process.env.PUBLIC_URL || process.env.SERVER_URL || `http://localhost:${PORT}`}/api/ib/stats
        📍 Package Generation: ${process.env.PUBLIC_URL || process.env.SERVER_URL || `http://localhost:${PORT}`}/api/admin/generate-package/:userId
            `);
});

module.exports = app;
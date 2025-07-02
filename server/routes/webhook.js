const express = require('express');
const { processWebhook, getPendingTrades, updateTradeStatus, getTradeHistory } = require('../controllers/tradeController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Webhook endpoint from TradingView (no auth required)
router.post('/webhook/:userId/:licenseKey', processWebhook);

// MT5 EA endpoints (no auth required for EA)
router.get('/trades/:userId/:licenseKey', getPendingTrades);
router.post('/trade-feedback', updateTradeStatus);

// User endpoints (auth required)
router.get('/trade-history', authenticateToken, getTradeHistory);

module.exports = router;
const express = require('express');
const { createLicense, getLicenseStatus } = require('../controllers/licenseController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/license/create - Tạo license mới
router.post('/create', authenticateToken, createLicense);

// GET /api/license/status - Kiểm tra status license
router.get('/status', authenticateToken, getLicenseStatus);

module.exports = router;
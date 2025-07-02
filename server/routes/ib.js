const express = require('express');
const { 
    getIBStats, 
    checkUserActivity, 
    getUserActivity, 
    getUsersAtRisk,
    revokeUserLicense,
    forceSyncAllUsers,
    getAPIHealth,
    debugExnessClients,
    testRealAccountActivity,
    reactivateUserLicense,    // ← THÊM IMPORT
    getRevokedUsers,          // ← THÊM IMPORT
    forceAutoRevokeCheck      // ← THÊM IMPORT
} = require('../controllers/ibController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ========== CORE IB MANAGEMENT ROUTES ==========

// GET /api/ib/stats - Get IB statistics (admin only)
router.get('/stats', authenticateToken, getIBStats);

// POST /api/ib/check-activity/:userId - Manual activity check for specific user
router.post('/check-activity/:userId', authenticateToken, checkUserActivity);

// GET /api/ib/user-activity - Get current user's referral activity
router.get('/user-activity', authenticateToken, getUserActivity);

// GET /api/ib/users-at-risk - Get users at risk of license revocation
router.get('/users-at-risk', authenticateToken, getUsersAtRisk);

// POST /api/ib/revoke/:userId - Revoke user license
router.post('/revoke/:userId', authenticateToken, revokeUserLicense);

// POST /api/ib/force-sync - Force sync all users activity
router.post('/force-sync', authenticateToken, forceSyncAllUsers);

// GET /api/ib/health - API health check
router.get('/health', getAPIHealth);

// ========== LICENSE MANAGEMENT ROUTES ==========

// POST /api/ib/reactivate/:userId - Reactivate revoked license
router.post('/reactivate/:userId', authenticateToken, reactivateUserLicense);

// GET /api/ib/revoked-users - Get list of users with revoked licenses
router.get('/revoked-users', authenticateToken, getRevokedUsers);

// POST /api/ib/force-auto-revoke - Manually trigger auto-revoke check
router.post('/force-auto-revoke', authenticateToken, forceAutoRevokeCheck);

// ========== DEBUG ROUTES ==========

// GET /api/ib/debug/exness-clients - Debug để xem 70 clients từ Exness
router.get('/debug/exness-clients', authenticateToken, debugExnessClients);

// GET /api/ib/debug/test-account/:accountNumber - Test activity cho 1 account cụ thể
router.get('/debug/test-account/:accountNumber', authenticateToken, testRealAccountActivity);

module.exports = router;
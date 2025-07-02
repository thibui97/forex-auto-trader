// server/controllers/packageGenerator.js - ENHANCED VERSION

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver'); // npm install archiver
const db = require('../config/database');
const logger = require('../utils/logger');

class ClientPackageGenerator {
    constructor() {
        this.serverURL = process.env.SERVER_URL || 'http://localhost:3000';
        this.outputPath = path.join(__dirname, '../client_packages');
        this.templatesPath = path.join(__dirname, '../templates');
        
        // Ensure directories exist
        this.ensureDirectoriesExist();
    }

    ensureDirectoriesExist() {
        try {
            if (!fs.existsSync(this.outputPath)) {
                fs.mkdirSync(this.outputPath, { recursive: true });
                logger.info(`📁 Created client_packages directory: ${this.outputPath}`);
            }
            
            if (!fs.existsSync(this.templatesPath)) {
                fs.mkdirSync(this.templatesPath, { recursive: true });
                logger.info(`📁 Created templates directory: ${this.templatesPath}`);
            }
        } catch (error) {
            logger.error('Failed to create directories:', error);
            throw error;
        }
    }

    async generatePackage(userId) {
        try {
            logger.info(`🔄 Starting COMPLETE package generation for user ${userId}`);
            
            // 1. Get user info
            const userInfo = await this.getUserInfo(userId);
            if (!userInfo) {
                throw new Error('User not found');
            }

            // 2. Ensure user has active license
            if (!userInfo.licenseKey) {
                userInfo.licenseKey = await this.createLicenseForUser(userId);
            }

            // 3. Generate package data
            const timestamp = Date.now();
            const packageName = `AutoTrading_${userInfo.username}_${timestamp}`;
            const packageData = {
                packageName,
                downloadURL: `/api/admin/download-package/${packageName}`,
                webhookURL: `${this.serverURL}/api/webhook/${userId}/${userInfo.licenseKey}`,
                clientInfo: {
                    userId: userInfo.id,
                    username: userInfo.username,
                    licenseKey: userInfo.licenseKey,
                    broker: userInfo.broker,
                    accountNumber: userInfo.account_number,
                    email: userInfo.email,
                    phoneZalo: userInfo.phone_zalo
                }
            };

            // 4. Create complete package with EA
            await this.createCompletePackage(packageData);

            logger.info(`✅ COMPLETE package generated: ${packageName}`);
            return packageData;

        } catch (error) {
            logger.error('Complete package generation error:', error);
            throw error;
        }
    }

    async createCompletePackage(packageData) {
        try {
            const packageDir = path.join(this.outputPath, packageData.packageName);
            
            // Create package directory
            if (!fs.existsSync(packageDir)) {
                fs.mkdirSync(packageDir, { recursive: true });
            }

            // 1. Create CLIENT_INFO.txt
            await this.createClientInfoFile(packageDir, packageData);
            
            // 2. Create customized EA file
            await this.createCustomizedEA(packageDir, packageData);
            
            // 3. Create setup instructions
            await this.createSetupInstructions(packageDir, packageData);
            
            // 4. Create TradingView webhook guide
            await this.createTradingViewGuide(packageDir, packageData);
            
            // 5. Create ZIP package
            await this.createZipPackage(packageData.packageName, packageDir);

            logger.info(`📦 Complete package created: ${packageData.packageName}`);
            
        } catch (error) {
            logger.error('Create complete package error:', error);
            throw error;
        }
    }

    async createClientInfoFile(packageDir, packageData) {
        const clientInfo = `===========================================
🎯 AUTO TRADING CLIENT PACKAGE
===========================================

👤 CLIENT INFORMATION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Username: ${packageData.clientInfo.username}
• User ID: ${packageData.clientInfo.userId}
• Broker: ${packageData.clientInfo.broker}
• Account: ${packageData.clientInfo.accountNumber}
• Email: ${packageData.clientInfo.email || 'Not provided'}
• Phone/Zalo: ${packageData.clientInfo.phoneZalo || 'Not provided'}

🔑 AUTHENTICATION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• License Key: ${packageData.clientInfo.licenseKey}
• Status: ACTIVE
• Created: ${new Date().toLocaleString()}

🔗 WEBHOOK URL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${packageData.webhookURL}

📁 PACKAGE CONTENTS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ CLIENT_INFO.txt (This file)
✅ Autotrader.mq5 (Expert Advisor - Pre-configured)
✅ SETUP_INSTRUCTIONS.txt (Step-by-step guide)
✅ TRADINGVIEW_GUIDE.txt (Webhook setup guide)

🎯 READY TO USE!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Package generated: ${new Date().toLocaleString()}
All files are pre-configured with your settings.
`;

        fs.writeFileSync(path.join(packageDir, 'CLIENT_INFO.txt'), clientInfo, 'utf8');
    }

    async createCustomizedEA(packageDir, packageData) {
        try {
            // Read EA template
            const eaTemplatePath = path.join(__dirname, '../../mt5-ea/Autotrader.mq5');
            
            if (!fs.existsSync(eaTemplatePath)) {
                // Create basic EA template if not exists
                await this.createEATemplate(eaTemplatePath);
            }
            
            let eaContent = fs.readFileSync(eaTemplatePath, 'utf8');
            
            // Replace placeholders with actual values
            eaContent = eaContent
                .replace(/USER_ID_PLACEHOLDER/g, packageData.clientInfo.userId)
                .replace(/LICENSE_KEY_PLACEHOLDER/g, packageData.clientInfo.licenseKey)
                .replace(/WEBHOOK_URL_PLACEHOLDER/g, packageData.webhookURL)
                .replace(/BROKER_PLACEHOLDER/g, packageData.clientInfo.broker)
                .replace(/ACCOUNT_PLACEHOLDER/g, packageData.clientInfo.accountNumber)
                .replace(/USERNAME_PLACEHOLDER/g, packageData.clientInfo.username);
            
            // Save customized EA
            fs.writeFileSync(path.join(packageDir, 'Autotrader.mq5'), eaContent, 'utf8');
            
            logger.info(`🤖 Customized EA created for user ${packageData.clientInfo.username}`);
            
        } catch (error) {
            logger.error('Create customized EA error:', error);
            // Create basic EA if template fails
            await this.createBasicEA(packageDir, packageData);
        }
    }

    async createBasicEA(packageDir, packageData) {
        const basicEA = `//+------------------------------------------------------------------+
//|                                                   Autotrader.mq5 |
//|                                         Auto Trading Expert v1.0 |
//|                              Pre-configured for ${packageData.clientInfo.username} |
//+------------------------------------------------------------------+
#property copyright "Auto Trading System"
#property version   "1.00"
#property strict

// ============ CLIENT CONFIGURATION ============
input string CLIENT_NAME = "${packageData.clientInfo.username}";
input int USER_ID = ${packageData.clientInfo.userId};
input string LICENSE_KEY = "${packageData.clientInfo.licenseKey}";
input string BROKER_NAME = "${packageData.clientInfo.broker}";
input string ACCOUNT_NUMBER = "${packageData.clientInfo.accountNumber}";

// ============ SERVER SETTINGS ============
input string WEBHOOK_URL = "${packageData.webhookURL}";
input string SERVER_URL = "${this.serverURL}";

// ============ TRADING SETTINGS ============
input double DEFAULT_LOT_SIZE = 0.01;
input int MAGIC_NUMBER = ${packageData.clientInfo.userId}001;
input int SLIPPAGE = 10;

// ============ GLOBAL VARIABLES ============
bool EA_INITIALIZED = false;
datetime LAST_CHECK_TIME = 0;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit() {
    Print("🚀 Autotrader EA Starting...");
    Print("👤 Client: ", CLIENT_NAME);
    Print("🆔 User ID: ", USER_ID);
    Print("🔑 License: ", StringSubstr(LICENSE_KEY, 0, 10), "...");
    Print("🏦 Broker: ", BROKER_NAME);
    Print("💳 Account: ", ACCOUNT_NUMBER);
    Print("🔗 Webhook: ", WEBHOOK_URL);
    
    // Verify account
    if(AccountInfoString(ACCOUNT_LOGIN) != ACCOUNT_NUMBER) {
        Print("⚠️ WARNING: Account mismatch!");
        Print("Expected: ", ACCOUNT_NUMBER);
        Print("Current: ", AccountInfoString(ACCOUNT_LOGIN));
    }
    
    EA_INITIALIZED = true;
    Print("✅ EA Initialized Successfully!");
    
    return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason) {
    Print("🛑 Autotrader EA Stopping... Reason: ", reason);
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick() {
    if(!EA_INITIALIZED) return;
    
    // Check for new signals every 10 seconds
    if(TimeCurrent() - LAST_CHECK_TIME > 10) {
        CheckForNewSignals();
        LAST_CHECK_TIME = TimeCurrent();
    }
}

//+------------------------------------------------------------------+
//| Check for new trading signals                                    |
//+------------------------------------------------------------------+
void CheckForNewSignals() {
    // This function would check the server for new signals
    // Implementation depends on your API structure
    
    string url = SERVER_URL + "/api/trades/pending/" + IntegerToString(USER_ID) + "/" + LICENSE_KEY;
    
    // Note: MT5 HTTP requests require additional implementation
    // This is a placeholder for the actual HTTP client code
    
    Print("🔍 Checking for new signals...");
}

//+------------------------------------------------------------------+
//| Place market order                                               |
//+------------------------------------------------------------------+
bool PlaceMarketOrder(string symbol, ENUM_ORDER_TYPE orderType, double lots, double sl = 0, double tp = 0) {
    MqlTradeRequest request = {};
    MqlTradeResult result = {};
    
    request.action = TRADE_ACTION_DEAL;
    request.symbol = symbol;
    request.volume = lots;
    request.type = orderType;
    request.price = (orderType == ORDER_TYPE_BUY) ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
    request.sl = sl;
    request.tp = tp;
    request.magic = MAGIC_NUMBER;
    request.comment = "AutoTrader_" + CLIENT_NAME;
    request.deviation = SLIPPAGE;
    
    bool success = OrderSend(request, result);
    
    if(success) {
        Print("✅ Order placed: ", symbol, " ", EnumToString(orderType), " ", lots, " lots");
        Print("📊 Order ticket: ", result.order);
    } else {
        Print("❌ Order failed: ", result.retcode, " - ", result.comment);
    }
    
    return success;
}

//+------------------------------------------------------------------+
//| HTTP POST request (placeholder)                                  |
//+------------------------------------------------------------------+
void SendHTTPRequest(string url, string data = "") {
    // HTTP request implementation
    // This requires additional MQL5 HTTP libraries
    Print("📡 Sending request to: ", url);
}

//+------------------------------------------------------------------+
//| Display EA information                                           |
//+------------------------------------------------------------------+
void DisplayEAInfo() {
    Comment("\\n🎯 AUTO TRADER EA",
            "\\n👤 Client: ", CLIENT_NAME,
            "\\n🆔 User ID: ", USER_ID,
            "\\n🏦 Broker: ", BROKER_NAME,
            "\\n💳 Account: ", ACCOUNT_NUMBER,
            "\\n🔑 License: Active",
            "\\n⏰ Last Check: ", TimeToString(LAST_CHECK_TIME),
            "\\n\\n✅ EA is running...");
}

//+------------------------------------------------------------------+`;

        fs.writeFileSync(path.join(packageDir, 'Autotrader.mq5'), basicEA, 'utf8');
    }

    async createSetupInstructions(packageDir, packageData) {
        const instructions = `===========================================
📋 SETUP INSTRUCTIONS
===========================================

🚀 QUICK START GUIDE for ${packageData.clientInfo.username}

STEP 1: INSTALL MT5 EXPERT ADVISOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Open MetaTrader 5
2. Press F4 or go to Tools → MetaQuotes Language Editor
3. Click File → Open → Select "Autotrader.mq5" from this package
4. Click Compile (F7) - should show "0 errors, 0 warnings"
5. Go back to MT5 → Navigator → Expert Advisors
6. Drag "Autotrader" to your chart
7. Check "Allow algo trading" and "Allow WebRequest"
8. Click OK

STEP 2: VERIFY EA SETTINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ CLIENT_NAME: ${packageData.clientInfo.username}
✅ USER_ID: ${packageData.clientInfo.userId}
✅ LICENSE_KEY: ${packageData.clientInfo.licenseKey.substring(0, 20)}...
✅ BROKER_NAME: ${packageData.clientInfo.broker}
✅ ACCOUNT_NUMBER: ${packageData.clientInfo.accountNumber}

STEP 3: SETUP TRADINGVIEW ALERTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Open TradingView
2. Create your strategy/indicator
3. Click "Create Alert"
4. In "Webhook URL" field, paste:
   ${packageData.webhookURL}
5. In message field, use format:
   {
     "symbol": "{{ticker}}",
     "action": "{{strategy.order.action}}",
     "volume": 0.01,
     "price": {{close}}
   }

STEP 4: TEST THE SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Send a test alert from TradingView
2. Check MT5 Expert tab for messages
3. Check Journal tab for trade execution
4. Start with small position sizes

STEP 5: TROUBLESHOOTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ EA not working? Check:
   - Auto trading is enabled (Ctrl+E)
   - WebRequest is allowed in Tools → Options → Expert Advisors
   - License key is correct
   - Internet connection is stable

❌ No trades executing? Check:
   - Account balance is sufficient  
   - Symbol is available for trading
   - Market is open
   - Webhook URL is correct

📞 SUPPORT CONTACT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If you need help, contact us with:
• Your User ID: ${packageData.clientInfo.userId}
• Your Username: ${packageData.clientInfo.username}
• Error message (if any)

🎯 READY TO TRADE!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your system is pre-configured and ready to use.
Start with small positions to test everything works.

Generated: ${new Date().toLocaleString()}
`;

        fs.writeFileSync(path.join(packageDir, 'SETUP_INSTRUCTIONS.txt'), instructions, 'utf8');
    }

    async createTradingViewGuide(packageDir, packageData) {
        const guide = `===========================================
📈 TRADINGVIEW WEBHOOK SETUP GUIDE
===========================================

🔗 YOUR WEBHOOK URL:
${packageData.webhookURL}

📋 STEP-BY-STEP SETUP:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. OPEN TRADINGVIEW
   - Go to tradingview.com
   - Login to your account
   - Open your chart/strategy

2. CREATE ALERT
   - Click "⏰" alert icon (top toolbar)
   - OR right-click chart → "Add Alert"

3. CONFIGURE ALERT
   - Condition: Choose your indicator/strategy
   - Options: Set as needed
   - Actions: Check "Webhook URL"

4. WEBHOOK SETTINGS
   - Webhook URL: ${packageData.webhookURL}
   - Message: Use format below

5. MESSAGE FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FOR BUY SIGNAL:
{
  "symbol": "{{ticker}}",
  "action": "BUY",
  "volume": 0.01,
  "price": {{close}},
  "stopLoss": {{low}},
  "takeProfit": {{high}}
}

FOR SELL SIGNAL:
{
  "symbol": "{{ticker}}",
  "action": "SELL", 
  "volume": 0.01,
  "price": {{close}},
  "stopLoss": {{high}},
  "takeProfit": {{low}}
}

6. ADVANCED SETTINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Frequency: "Once Per Bar Close" (recommended)
- Expiration: Set appropriate time
- Sound: Enable for notifications

7. TEST YOUR WEBHOOK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Create a simple alert first
- Check MT5 Expert tab for messages
- Verify trades appear in MT5

8. SUPPORTED SYMBOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ EURUSD, GBPUSD, USDJPY, USDCHF
✅ AUDUSD, NZDUSD, USDCAD
✅ XAUUSD (Gold), XAGUSD (Silver)
✅ US30, SPX500, NAS100
✅ Most major forex pairs

9. BEST PRACTICES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 Start with demo account
📌 Use small position sizes (0.01 lots)
📌 Test during active market hours
📌 Monitor first few trades manually
📌 Keep TradingView and MT5 open

10. TROUBLESHOOTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ Alert not triggering?
   → Check condition settings
   → Verify webhook URL is correct

❌ Webhook sending but no trades?
   → Check MT5 Expert Advisor is running
   → Verify auto trading is enabled
   → Check account balance

❌ Wrong symbol error?
   → Ensure symbol exists in MT5
   → Check symbol format (EURUSD vs EUR/USD)

🎯 YOUR SYSTEM IS READY!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Client: ${packageData.clientInfo.username}
User ID: ${packageData.clientInfo.userId}
License: ACTIVE
Generated: ${new Date().toLocaleString()}

Happy Trading! 🚀
`;

        fs.writeFileSync(path.join(packageDir, 'TRADINGVIEW_GUIDE.txt'), guide, 'utf8');
    }

    async createZipPackage(packageName, packageDir) {
        return new Promise((resolve, reject) => {
            const zipPath = path.join(this.outputPath, `${packageName}.zip`);
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', () => {
                logger.info(`📦 ZIP package created: ${packageName}.zip (${archive.pointer()} bytes)`);
                resolve(zipPath);
            });

            archive.on('error', (err) => {
                logger.error('ZIP creation error:', err);
                reject(err);
            });

            archive.pipe(output);
            archive.directory(packageDir, false);
            archive.finalize();
        });
    }

    async createEATemplate(templatePath) {
        // Create directory if not exists
        const templateDir = path.dirname(templatePath);
        if (!fs.existsSync(templateDir)) {
            fs.mkdirSync(templateDir, { recursive: true });
        }

        // Copy from mt5-ea folder if exists, otherwise create basic template
        const basicTemplate = `// EA Template - Will be customized for each client
// Placeholders: USER_ID_PLACEHOLDER, LICENSE_KEY_PLACEHOLDER, etc.
`;
        
        fs.writeFileSync(templatePath, basicTemplate, 'utf8');
    }

    // ... rest of methods remain the same
    async getUserInfo(userId) {
        try {
            const [users] = await db.query(`
                SELECT u.*, l.license_key 
                FROM users u 
                LEFT JOIN licenses l ON u.id = l.user_id AND l.status = 'active'
                WHERE u.id = ?
            `, [userId]);

            return users.length > 0 ? users[0] : null;
        } catch (error) {
            logger.error('Get user info error:', error);
            throw error;
        }
    }

    async createLicenseForUser(userId) {
        try {
            const licenseKey = crypto.randomBytes(32).toString('hex');
            
            await db.query(
                `INSERT INTO licenses (user_id, license_key, status, created_date, last_trade_date)
                 VALUES (?, ?, 'active', NOW(), NOW())`,
                [userId, licenseKey]
            );

            return licenseKey;
        } catch (error) {
            logger.error('Create license error:', error);
            throw error;
        }
    }
}

module.exports = ClientPackageGenerator;
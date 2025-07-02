//+------------------------------------------------------------------+
//| AutoTrader.mq5                                                   |
//| Copyright 2025, Forex Auto Trading System                       |
//| Version 1.1 - Fixed Connection Issues                           |
//| Pre-configured for: trader014                        |
//+------------------------------------------------------------------+
#property copyright "Forex Auto Trading System"
#property version   "1.10"
#property description "Auto Trading EA - Connects to Trading Server (Fixed Connection)"

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\AccountInfo.mqh>

//--- Input parameters - PRE-CONFIGURED FOR CLIENT
input group "=== CLIENT INFORMATION (PRE-CONFIGURED) ==="
input string CLIENT_NAME = "trader014"; // Client Name
input string USER_ID = "26"; // Your User ID from registration
input string LICENSE_KEY = "7fea0b90628a0725ea5e0ce95cee268e26db9aa8ff733ddc21cec58c904f916d"; // Your License Key
input string BROKER_NAME = "PUPrime"; // Your Broker
input string ACCOUNT_NUMBER = "15953467"; // Your Account Number

input group "=== CONNECTION SETTINGS ==="
input string PrimaryServerURL = "http://127.0.0.1:3000"; // Primary Server URL
input string BackupServerURL = "http://127.0.0.1:3000"; // Backup Server URL
input string WEBHOOK_URL = "https://ac52-2a09-bac5-d5cd-16dc-00-247-123.ngrok-free.app/api/webhook/26/7fea0b90628a0725ea5e0ce95cee268e26db9aa8ff733ddc21cec58c904f916d"; // Your Webhook URL
input int CheckInterval = 5; // Check interval in seconds

input group "=== TRADING SETTINGS ==="
input double DefaultLotSize = 0.01; // Default lot size
input int MaxSlippage = 30; // Maximum slippage in points
input bool EnableAutoTrading = true; // Enable auto trading
input int MaxOpenTrades = 5; // Maximum number of open trades

input group "=== RISK MANAGEMENT ==="
input double MaxRiskPercent = 2.0; // Maximum risk per trade (%)
input double MaxDailyLoss = 100.0; // Maximum daily loss in account currency
input bool UseStopLoss = true; // Use stop loss from signals
input bool UseTakeProfit = true; // Use take profit from signals

//--- Global variables
CTrade trade;
CPositionInfo position;
CAccountInfo account;

datetime lastCheck = 0;
double dailyStartBalance = 0;
bool initialized = false;
string ActiveServerURL = ""; // Currently working server URL

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
    Print("=== AutoTrader EA Started ===");
    Print("🎯 PRE-CONFIGURED FOR CLIENT: ", CLIENT_NAME);
    Print("🆔 User ID: ", USER_ID);
    Print("🔑 License Key: ", StringSubstr(LICENSE_KEY, 0, 10), "...");
    Print("🏦 Broker: ", BROKER_NAME);
    Print("💳 Account: ", ACCOUNT_NUMBER);
    Print("🔗 Webhook URL: ", WEBHOOK_URL);
    Print("📡 Primary Server: ", PrimaryServerURL);
    Print("📡 Backup Server: ", BackupServerURL);
    
    // Validate pre-configured settings
    if(USER_ID == "26" || LICENSE_KEY == "7fea0b90628a0725ea5e0ce95cee268e26db9aa8ff733ddc21cec58c904f916d")
    {
        Print("❌ ERROR: EA not properly configured!");
        Print("   This EA was not generated correctly.");
        Print("   Please contact support with your client name: ", CLIENT_NAME);
        return INIT_FAILED;
    }
    
    // Verify account matches configuration
    string currentAccount = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
    if(ACCOUNT_NUMBER != "15953467" && currentAccount != ACCOUNT_NUMBER)
    {
        Print("⚠️ WARNING: Account mismatch detected!");
        Print("   Expected Account: ", ACCOUNT_NUMBER);
        Print("   Current Account: ", currentAccount);
        Print("   Please verify you're using the correct account.");
        // Continue anyway, but warn user
    }
    
    if(!EnableAutoTrading)
    {
        Print("⚠️ WARNING: Auto trading is disabled in EA settings");
    }
    
    // Check if auto trading is enabled in terminal
    if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
    {
        Print("❌ ERROR: Auto trading is not allowed in terminal");
        Print("   Please enable auto trading in MT5:");
        Print("   1. Click the 'Auto Trading' button in toolbar");
        Print("   2. Or press Ctrl+E");
        return INIT_FAILED;
    }
    
    // Initialize daily balance
    dailyStartBalance = account.Balance();
    
    // Set timer
    EventSetTimer(CheckInterval);
    
    // Test connection and find working server
    if(!FindWorkingServer())
    {
        Print("❌ ERROR: Cannot connect to trading server!");
        Print("📋 Please check the following:");
        Print("   1. Server is running on port 3000");
        Print("   2. WebRequest URLs are added in MT5 Options:");
        Print("      - Tools → Options → Expert Advisors");
        Print("      - Check 'Allow WebRequest for listed URLs'");
        Print("      - Add: http://localhost:3000");
        Print("      - Add: http://127.0.0.1:3000");
        Print("   3. Windows Firewall allows MT5 connections");
        Print("   4. Contact support if issues persist");
        return INIT_FAILED;
    }
    
    initialized = true;
    Print("✅ AutoTrader EA initialized successfully!");
    Print("🎯 Client: ", CLIENT_NAME);
    Print("📡 Using server: ", ActiveServerURL);
    Print("🚀 Ready to receive trading signals!");
    
    // Display client info on chart
    DisplayClientInfo();
    
    return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                               |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
    EventKillTimer();
    Print("🛑 AutoTrader EA stopped for client: ", CLIENT_NAME);
    Print("   Reason code: ", reason);
    
    // Clear chart comment
    Comment("");
}

//+------------------------------------------------------------------+
//| Display client information on chart                            |
//+------------------------------------------------------------------+
void DisplayClientInfo()
{
    string info = "\n🎯 AUTO TRADER EA - ACTIVE";
    info += "\n👤 Client: " + CLIENT_NAME;
    info += "\n🆔 User ID: " + USER_ID;
    info += "\n🏦 Broker: " + BROKER_NAME;
    info += "\n💳 Account: " + ACCOUNT_NUMBER;
    info += "\n🔑 License: ACTIVE";
    info += "\n📡 Server: " + ActiveServerURL;
    info += "\n⏰ Last Check: " + TimeToString(TimeCurrent());
    info += "\n\n✅ Ready for signals...";
    
    Comment(info);
}

//+------------------------------------------------------------------+
//| Timer function                                                  |
//+------------------------------------------------------------------+
void OnTimer()
{
    if(!initialized || !EnableAutoTrading) return;
    
    // Update display
    DisplayClientInfo();
    
    // Check daily loss limit
    if(CheckDailyLoss()) return;
    
    // Check for new trades from server
    CheckForNewTrades();
    
    // Update trade statuses
    UpdateTradeStatuses();
}

//+------------------------------------------------------------------+
//| Find working server URL                                        |
//+------------------------------------------------------------------+
bool FindWorkingServer()
{
    string testURLs[2];
    testURLs[0] = PrimaryServerURL;
    testURLs[1] = BackupServerURL;
    
    for(int i = 0; i < 2; i++)
    {
        if(TestServerConnection(testURLs[i]))
        {
            ActiveServerURL = testURLs[i];
            Print("✅ Connected to server: ", ActiveServerURL);
            return true;
        }
    }
    
    Print("❌ Failed to connect to any server");
    return false;
}

//+------------------------------------------------------------------+
//| Test connection to specific server                             |
//+------------------------------------------------------------------+
bool TestServerConnection(string serverURL)
{
    string url = serverURL + "/health";
    string headers = "Content-Type: application/json\r\n";
    char data[];
    char response[];
    string responseHeaders;
    
    Print("🔍 Testing connection to: ", serverURL);
    
    int res = WebRequest("GET", url, headers, 5000, data, response, responseHeaders);
    
    if(res == 200)
    {
        string result = CharArrayToString(response);
        Print("✅ Server connection successful: ", serverURL);
        Print("📡 Server response: ", StringSubstr(result, 0, 100));
        return true;
    }
    else if(res == -1)
    {
        Print("❌ WebRequest error for ", serverURL, " - URL not in allowed list");
        Print("   📋 Please add this URL to MT5 Options:");
        Print("   Tools → Options → Expert Advisors → Allow WebRequest for listed URL");
        Print("   Add: ", serverURL);
    }
    else
    {
        Print("❌ Server connection failed: ", serverURL, " Code: ", res);
    }
    
    return false;
}

//+------------------------------------------------------------------+
//| Check for new trades from server                               |
//+------------------------------------------------------------------+
void CheckForNewTrades()
{
    if(ActiveServerURL == "")
    {
        Print("⚠️ No active server connection. Trying to reconnect...");
        if(!FindWorkingServer()) return;
    }
    
    string url = ActiveServerURL + "/api/trades/" + USER_ID + "/" + LICENSE_KEY;
    string headers = "Content-Type: application/json\r\n";
    char data[];
    char response[];
    string responseHeaders;
    
    int res = WebRequest("GET", url, headers, 5000, data, response, responseHeaders);
    
    if(res == 200)
    {
        string result = CharArrayToString(response);
        ProcessTradeData(result);
    }
    else if(res == 403)
    {
        Print("❌ ERROR: License invalid or expired for client: ", CLIENT_NAME);
        Print("   Please contact support to renew your license");
        Print("   User ID: ", USER_ID);
    }
    else if(res == -1)
    {
        Print("❌ WebRequest failed - URL may not be in allowed list");
        // Try to find alternative server
        if(!FindWorkingServer())
        {
            Print("❌ Cannot establish server connection");
        }
    }
    else if(res != 0)
    {
        Print("⚠️ Server request failed. Code: ", res);
        // Try backup server if primary fails
        if(ActiveServerURL == PrimaryServerURL)
        {
            Print("🔄 Trying backup server...");
            if(TestServerConnection(BackupServerURL))
            {
                ActiveServerURL = BackupServerURL;
            }
        }
    }
}

//+------------------------------------------------------------------+
//| Process trade data from server                                 |
//+------------------------------------------------------------------+
void ProcessTradeData(string jsonData)
{
    // Simple JSON parsing (in production, use a proper JSON library)
    if(StringFind(jsonData, "\"success\":true") < 0) return;
    
    // Extract trades array
    int tradesStart = StringFind(jsonData, "\"trades\":[");
    if(tradesStart < 0) return;
    
    string tradesData = StringSubstr(jsonData, tradesStart);
    
    // Process each trade (simplified parsing)
    if(StringFind(tradesData, "\"action\":\"BUY\"") >= 0)
    {
        ExecuteBuyTrade(tradesData);
    }
    else if(StringFind(tradesData, "\"action\":\"SELL\"") >= 0)
    {
        ExecuteSellTrade(tradesData);
    }
}

//+------------------------------------------------------------------+
//| Execute buy trade                                               |
//+------------------------------------------------------------------+
void ExecuteBuyTrade(string tradeData)
{
    // Extract trade parameters (simplified)
    string symbol = ExtractJsonValue(tradeData, "symbol");
    double volume = StringToDouble(ExtractJsonValue(tradeData, "volume"));
    double sl = StringToDouble(ExtractJsonValue(tradeData, "stop_loss"));
    double tp = StringToDouble(ExtractJsonValue(tradeData, "take_profit"));
    int tradeId = (int)StringToInteger(ExtractJsonValue(tradeData, "id"));
    
    if(symbol == "") symbol = Symbol(); // Use current symbol if not specified
    if(volume <= 0) volume = DefaultLotSize;
    
    Print("📈 Processing BUY signal for client: ", CLIENT_NAME);
    Print("   Symbol: ", symbol, " Volume: ", volume);
    
    // Validate lot size
    volume = ValidateLotSize(symbol, volume);
    
    // Calculate risk
    if(!ValidateRisk(symbol, volume, sl)) 
    {
        SendTradeUpdate(tradeId, "failed", 0, "Risk management rejected trade");
        return;
    }
    
    // Execute trade
    if(trade.Buy(volume, symbol, 0, UseStopLoss ? sl : 0, UseTakeProfit ? tp : 0))
    {
        ulong ticket = trade.ResultOrder();
        Print("✅ BUY order executed for ", CLIENT_NAME);
        Print("   Symbol: ", symbol, " Volume: ", volume, " Ticket: ", ticket);
        SendTradeUpdate(tradeId, "executed", ticket, "Trade executed successfully");
    }
    else
    {
        Print("❌ BUY order failed for ", CLIENT_NAME, ": ", trade.ResultComment());
        SendTradeUpdate(tradeId, "failed", 0, trade.ResultComment());
    }
}

//+------------------------------------------------------------------+
//| Execute sell trade                                              |
//+------------------------------------------------------------------+
void ExecuteSellTrade(string tradeData)
{
    // Extract trade parameters (simplified)
    string symbol = ExtractJsonValue(tradeData, "symbol");
    double volume = StringToDouble(ExtractJsonValue(tradeData, "volume"));
    double sl = StringToDouble(ExtractJsonValue(tradeData, "stop_loss"));
    double tp = StringToDouble(ExtractJsonValue(tradeData, "take_profit"));
    int tradeId = (int)StringToInteger(ExtractJsonValue(tradeData, "id"));
    
    if(symbol == "") symbol = Symbol();
    if(volume <= 0) volume = DefaultLotSize;
    
    Print("📉 Processing SELL signal for client: ", CLIENT_NAME);
    Print("   Symbol: ", symbol, " Volume: ", volume);
    
    // Validate lot size
    volume = ValidateLotSize(symbol, volume);
    
    // Calculate risk
    if(!ValidateRisk(symbol, volume, sl)) 
    {
        SendTradeUpdate(tradeId, "failed", 0, "Risk management rejected trade");
        return;
    }
    
    // Execute trade
    if(trade.Sell(volume, symbol, 0, UseStopLoss ? sl : 0, UseTakeProfit ? tp : 0))
    {
        ulong ticket = trade.ResultOrder();
        Print("✅ SELL order executed for ", CLIENT_NAME);
        Print("   Symbol: ", symbol, " Volume: ", volume, " Ticket: ", ticket);
        SendTradeUpdate(tradeId, "executed", ticket, "Trade executed successfully");
    }
    else
    {
        Print("❌ SELL order failed for ", CLIENT_NAME, ": ", trade.ResultComment());
        SendTradeUpdate(tradeId, "failed", 0, trade.ResultComment());
    }
}

//+------------------------------------------------------------------+
//| Send trade update to server                                    |
//+------------------------------------------------------------------+
void SendTradeUpdate(int tradeId, string status, ulong ticket, string comment)
{
    if(ActiveServerURL == "") return;
    
    string url = ActiveServerURL + "/api/trade-feedback";
    string jsonData = StringFormat(
        "{\"tradeId\":%d,\"status\":\"%s\",\"ticketNumber\":%d,\"userId\":%s,\"comment\":\"%s\",\"clientName\":\"%s\"}",
        tradeId, status, ticket, USER_ID, comment, CLIENT_NAME
    );
    
    char data[];
    char response[];
    string headers = "Content-Type: application/json\r\n";
    
    StringToCharArray(jsonData, data, 0, StringLen(jsonData));
    
    int res = WebRequest("POST", url, headers, 5000, data, response, headers);
    
    if(res == 200)
    {
        Print("✅ Trade status updated on server for ", CLIENT_NAME);
    }
    else
    {
        Print("❌ Failed to update trade status for ", CLIENT_NAME, ". Code: ", res);
    }
}

//+------------------------------------------------------------------+
//| Extract value from JSON string (simplified)                    |
//+------------------------------------------------------------------+
string ExtractJsonValue(string json, string key)
{
    string searchKey = "\"" + key + "\":";
    int keyPos = StringFind(json, searchKey);
    if(keyPos < 0) return "";
    
    int valueStart = keyPos + StringLen(searchKey);
    
    // Skip whitespace and quotes
    while(valueStart < StringLen(json) && 
          (StringGetCharacter(json, valueStart) == ' ' || 
           StringGetCharacter(json, valueStart) == '\"'))
        valueStart++;
    
    // Find end of value
    int valueEnd = valueStart;
    bool inQuotes = false;
    
    for(int i = valueStart; i < StringLen(json); i++)
    {
        ushort ch = StringGetCharacter(json, i);
        if(ch == '\"') inQuotes = !inQuotes;
        if(!inQuotes && (ch == ',' || ch == '}' || ch == ']'))
        {
            valueEnd = i;
            break;
        }
    }
    
    string value = StringSubstr(json, valueStart, valueEnd - valueStart);
    
    // Remove trailing quotes
    if(StringLen(value) > 0 && StringGetCharacter(value, StringLen(value)-1) == '\"')
        value = StringSubstr(value, 0, StringLen(value)-1);
    
    return value;
}

//+------------------------------------------------------------------+
//| Validate lot size                                              |
//+------------------------------------------------------------------+
double ValidateLotSize(string symbol, double volume)
{
    double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    double maxLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
    double stepLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    
    if(volume < minLot) volume = minLot;
    if(volume > maxLot) volume = maxLot;
    
    // Round to step
    volume = NormalizeDouble(MathRound(volume / stepLot) * stepLot, 2);
    
    return volume;
}

//+------------------------------------------------------------------+
//| Validate risk management                                       |
//+------------------------------------------------------------------+
bool ValidateRisk(string symbol, double volume, double stopLoss)
{
    if(MaxRiskPercent <= 0) return true;
    
    double balance = account.Balance();
    double maxRisk = balance * MaxRiskPercent / 100.0;
    
    if(stopLoss > 0)
    {
        double currentPrice = SymbolInfoDouble(symbol, SYMBOL_BID);
        double riskPoints = MathAbs(currentPrice - stopLoss);
        double pointValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
        double riskAmount = volume * riskPoints * pointValue;
        
        if(riskAmount > maxRisk)
        {
            Print("⚠️ Trade rejected for ", CLIENT_NAME, ": Risk too high");
            Print("   Risk Amount: ", riskAmount, " Max Allowed: ", maxRisk);
            return false;
        }
    }
    
    return true;
}

//+------------------------------------------------------------------+
//| Check daily loss limit                                         |
//+------------------------------------------------------------------+
bool CheckDailyLoss()
{
    if(MaxDailyLoss <= 0) return false;
    
    double currentBalance = account.Balance();
    double dailyLoss = dailyStartBalance - currentBalance;
    
    if(dailyLoss >= MaxDailyLoss)
    {
        Print("🚨 ALERT: Daily loss limit reached for ", CLIENT_NAME);
        Print("   Daily Loss: ", dailyLoss, " Limit: ", MaxDailyLoss);
        Print("   Trading stopped for today!");
        return true;
    }
    
    return false;
}

//+------------------------------------------------------------------+
//| Update trade statuses                                          |
//+------------------------------------------------------------------+
void UpdateTradeStatuses()
{
    // This function can be expanded to monitor open positions
    // and update their status on the server
}

//+------------------------------------------------------------------+
//| Expert tick function (optional)                               |
//+------------------------------------------------------------------+
void OnTick()
{
    // Can be used for additional monitoring
    // Update display every 10 seconds
    static datetime lastDisplay = 0;
    if(TimeCurrent() - lastDisplay > 10)
    {
        if(initialized) DisplayClientInfo();
        lastDisplay = TimeCurrent();
    }
}
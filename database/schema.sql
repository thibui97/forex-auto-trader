-- Create database
CREATE DATABASE IF NOT EXISTS forex_system;
USE forex_system;

-- Users table
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    referral_code VARCHAR(50),
    broker ENUM('EXNESS', 'PUPrime') NOT NULL,
    account_number VARCHAR(50),
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Licenses table
CREATE TABLE licenses (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    license_key VARCHAR(64) UNIQUE NOT NULL,
    status ENUM('active', 'revoked', 'expired') DEFAULT 'active',
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_trade_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Trades table
CREATE TABLE trades (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    symbol VARCHAR(20) NOT NULL,
    action ENUM('BUY', 'SELL') NOT NULL,
    volume DECIMAL(10,2) NOT NULL,
    entry_price DECIMAL(10,5) DEFAULT 0,
    stop_loss DECIMAL(10,5) DEFAULT 0,
    take_profit DECIMAL(10,5) DEFAULT 0,
    status ENUM('pending', 'executed', 'failed') DEFAULT 'pending',
    ticket_number BIGINT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    executed_date DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Referral activities table
CREATE TABLE referral_activities (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    activity_date DATE,
    trade_volume DECIMAL(15,2) DEFAULT 0,
    trade_count INT DEFAULT 0,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX idx_licenses_user_status ON licenses(user_id, status);
CREATE INDEX idx_trades_user_status ON trades(user_id, status);
CREATE INDEX idx_trades_timestamp ON trades(timestamp);

-- Insert test data (optional)
INSERT INTO users (username, email, password, referral_code, broker, account_number) VALUES
('testuser', 'test@example.com', '$2a$10$K5zD8pQXJ7oQXJ7oQXJ7oQXJ7oQXJ7oQXJ7oQXJ7oQXJ7oQXJ7oQXJ', 'pb22s871d', 'EXNESS', '12345678');
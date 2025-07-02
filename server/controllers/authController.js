const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const logger = require('../utils/logger');

// Validate referral code cho cả 2 sàn
const isValidReferral = (referralCode, broker) => {
    if (broker === 'EXNESS') {
        return referralCode === process.env.EXNESS_REFERRAL_CODE;
    } else if (broker === 'PUPrime') {
        return referralCode === process.env.PUPRIME_REFERRAL_CODE;
    }
    return false;
};

const register = async (req, res) => {
    try {
        const { username, email, password, referralCode, broker, accountNumber, phoneZalo } = req.body;

        // Validate input - email giờ là optional
        if (!username || !password || !referralCode || !broker || !accountNumber) {
            return res.status(400).json({ 
                error: 'Required fields: username, password, referralCode, broker, accountNumber' 
            });
        }

        // Validate referral code
        if (!isValidReferral(referralCode, broker)) {
            return res.status(400).json({ 
                error: `Invalid referral code for ${broker}. Please use the correct referral code.` 
            });
        }

        // Check if user exists (by username)
        const [existingUsers] = await db.query(
            'SELECT id FROM users WHERE username = ?',
            [username]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Check if email exists (only if email is provided)
        if (email) {
            const [existingEmails] = await db.query(
                'SELECT id FROM users WHERE email = ?',
                [email]
            );

            if (existingEmails.length > 0) {
                return res.status(400).json({ error: 'Email already exists' });
            }
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        const [result] = await db.query(
            `INSERT INTO users (username, email, password, referral_code, broker, account_number, phone_zalo) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [username, email || null, hashedPassword, referralCode, broker, accountNumber, phoneZalo || null]
        );

        logger.info(`New user registered: ${username}, broker: ${broker}, phone: ${phoneZalo || 'none'}`);

        res.status(201).json({ 
            message: 'User registered successfully',
            userId: result.insertId,
            broker: broker,
            hasEmail: !!email,
            hasPhone: !!phoneZalo
        });

    } catch (error) {
        logger.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const login = async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validate input
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        // Find user
        const [users] = await db.query(
            'SELECT id, username, email, password, broker, phone_zalo FROM users WHERE username = ?',
            [username]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = users[0];

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, username: user.username, broker: user.broker },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        logger.info(`User logged in: ${username}`);

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                broker: user.broker,
                phoneZalo: user.phone_zalo
            }
        });

    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = { register, login };
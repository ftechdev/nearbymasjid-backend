const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      if (!token || token === 'undefined' || token === 'null' || token.trim() === '') {
        return res.status(401).json({ message: 'Authentication required. Authorization token format is invalid.' });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findByPk(decoded.id, { attributes: { exclude: ['password'] } });

      if (!req.user) {
        return res.status(401).json({ message: 'Authentication failed. The account associated with this session no longer exists.' });
      }

      return next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Your login session has expired. Please log in again to continue.' });
      }
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ message: 'Invalid authentication token. Please log in again.' });
      }
      console.error('[authMiddleware] Unexpected error:', error);
      return res.status(401).json({ message: 'Authentication failed. Please sign in again.' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Authentication required. No authorization token was provided.' });
  }
};

const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Administrator privileges are required for this request.' });
  }
};

module.exports = { protect, admin };

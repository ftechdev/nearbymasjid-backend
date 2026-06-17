const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // If token is literally string 'undefined' or empty, reject it early
      if (!token || token === 'undefined' || token === 'null') {
        return res.status(401).json({ message: 'Not authorized, invalid token format' });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findByPk(decoded.id, { attributes: { exclude: ['password'] } });

      // User deleted but token still valid
      if (!req.user) {
        return res.status(401).json({ message: 'Not authorized, account not found' });
      }

      return next();
    } catch (error) {
      // Don't clutter console with jwt malformed errors
      if (error.name !== 'JsonWebTokenError') {
        console.error(error);
      }
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};

const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Forbidden: admin access required' });
  }
};

module.exports = { protect, admin };

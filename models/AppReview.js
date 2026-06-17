const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const User = require('./User');

const AppReview = sequelize.define('AppReview', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  rating: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1,
      max: 5,
    },
  },
  comment: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  isApproved: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  timestamps: true,
});

// Relationships
User.hasOne(AppReview, { foreignKey: 'userId', as: 'appReview', onDelete: 'CASCADE' });
AppReview.belongsTo(User, { foreignKey: 'userId', as: 'user' });

module.exports = AppReview;

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Quote = sequelize.define('Quote', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  text: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  reference: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: '',
  },
  lastShownDate: {
    type: DataTypes.DATEONLY, // Just the date part
    allowNull: true,
  }
}, {
  timestamps: true,
});

module.exports = Quote;

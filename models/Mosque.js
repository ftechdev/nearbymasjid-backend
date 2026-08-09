const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const User = require('./User');

const Mosque = sequelize.define('Mosque', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  address: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  lat: {
    type: DataTypes.FLOAT(10, 6),
    allowNull: false,
  },
  lng: {
    type: DataTypes.FLOAT(10, 6),
    allowNull: false,
  },
  isApproved: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  googlePlaceId: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  // Stored as JSON; getter ensures it always comes back as an object (never a string)
  // regardless of how MySQL/Sequelize serialised it.
  iqamahTimings: {
    type: DataTypes.JSON,
    allowNull: true,
    get() {
      const raw = this.getDataValue('iqamahTimings');
      if (!raw) return null;
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return null; }
      }
      return raw;
    },
  },
  timingsApproved: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  photoUrl: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  // Pending replacement photo — goes live only after admin approves it.
  // The live photoUrl above is untouched until then.
  pendingPhotoUrl: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  photoSubmittedBy: {
    type: DataTypes.JSON, // { id, name, email, submittedAt }
    allowNull: true,
  },
  school: {
    type: DataTypes.ENUM('hanafi', 'shafi'),
    defaultValue: 'hanafi',
  },
  timingsSubmittedBy: {
    type: DataTypes.JSON, // { id, name, email, submittedAt }
    allowNull: true,
  },
}, {
  timestamps: true,
  indexes: [
    // Matches the WHERE clause used by the nearby-mosques search (GET /api/mosques)
    { fields: ['isApproved', 'lat', 'lng'] },
  ],
});

// Relationships
User.hasMany(Mosque, { foreignKey: 'userId', as: 'mosques' });
Mosque.belongsTo(User, { foreignKey: 'userId', as: 'addedBy' });

module.exports = Mosque;

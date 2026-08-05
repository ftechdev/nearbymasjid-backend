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
  iqamahTimings: {
    type: DataTypes.JSON, // { fajr: '05:30', dhuhr: '13:30', ... }
    allowNull: true,
  },
  timingsApproved: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  photoUrl: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  // Set whenever someone updates an existing mosque's photo after creation; the live
  // photoUrl above only changes once an admin approves it (see /mosques/:id/photo and
  // /admin/mosques/:id/approve-photo).
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

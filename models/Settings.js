const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Settings = sequelize.define('Settings', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  key: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  // The underlying column is actually `longtext` (created before this field was
  // typed as JSON; sequelize.sync() never alters existing column types), so it
  // doesn't get auto-parsed back into an object on every read the way a native
  // JSON column would — some routes defensively JSON.parse() it themselves,
  // others don't, which is what caused GET/apply-default-timings and
  // GET hijri-adjustment to silently see a raw string instead of the value's
  // fields. Centralising the parse here (same pattern as Mosque.iqamahTimings)
  // makes every consumer correct without needing its own workaround.
  value: {
    type: DataTypes.JSON,
    allowNull: false,
    get() {
      const raw = this.getDataValue('value');
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return raw; }
      }
      return raw;
    },
  },
}, {
  timestamps: true,
});

module.exports = Settings;

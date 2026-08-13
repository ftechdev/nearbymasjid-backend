const { sequelize } = require('../config/db');

async function increaseLimit() {
  console.log('Attempting to increase Hostinger MySQL connection limits...');
  try {
    await sequelize.authenticate();
    console.log('✅ DB Connected');

    const [results] = await sequelize.query("SHOW VARIABLES LIKE 'max_connections';");
    console.log('Current max_connections variable:', results);

    try {
      await sequelize.query("ALTER USER 'u184056080_masjidfinder'@'%' WITH MAX_CONNECTIONS_PER_HOUR 0;");
      console.log('✅ Success: Set MAX_CONNECTIONS_PER_HOUR to 0 (Unlimited) for %');
    } catch (e1) {
      console.warn('Notice 1:', e1.message);
    }

    try {
      await sequelize.query("ALTER USER 'u184056080_masjidfinder'@'localhost' WITH MAX_CONNECTIONS_PER_HOUR 0;");
      console.log('✅ Success: Set MAX_CONNECTIONS_PER_HOUR to 0 (Unlimited) for localhost');
    } catch (e2) {
      console.warn('Notice 2:', e2.message);
    }

    try {
      await sequelize.query("FLUSH PRIVILEGES;");
      console.log('✅ Flushed privileges successfully');
    } catch (e3) {
      console.warn('Notice 3:', e3.message);
    }

  } catch (err) {
    console.error('❌ Connection Error:', err.message);
  } finally {
    process.exit(0);
  }
}

increaseLimit();

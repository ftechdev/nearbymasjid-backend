const { connectDB, sequelize } = require('../config/db');
const User = require('../models/User');

const seedAdmin = async () => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminEmail || !adminPassword) {
      console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables before running this script.');
      process.exit(1);
    }

    await connectDB();

    const existingAdmin = await User.findOne({ where: { email: adminEmail } });
    if (existingAdmin) {
      console.log('Admin already exists. Upgrading to admin role just in case...');
      existingAdmin.role = 'admin';
      await existingAdmin.save();
    } else {
      await User.create({
        name: 'Super Admin',
        email: adminEmail,
        password: adminPassword,
        role: 'admin'
      });
      console.log('Admin account created successfully!');
    }
    
    console.log('---------------------------');
    console.log('Admin ready: ' + adminEmail);
    console.log('---------------------------');

    process.exit();
  } catch (error) {
    console.error('Error seeding admin:', error);
    process.exit(1);
  }
};

seedAdmin();

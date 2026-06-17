const { connectDB, sequelize } = require('../config/db');
const User = require('../models/User');

const seedAdmin = async () => {
  try {
    await connectDB();
    
    const adminEmail = 'admin@masjid.com';
    const adminPassword = 'adminpassword123';

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
    console.log('Email: ' + adminEmail);
    console.log('Password: ' + adminPassword);
    console.log('---------------------------');
    
    process.exit();
  } catch (error) {
    console.error('Error seeding admin:', error);
    process.exit(1);
  }
};

seedAdmin();

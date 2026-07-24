const { connectDB } = require('../config/db');
const User = require('../models/User');

const seedAccounts = async () => {
  try {
    await connectDB();
    
    // 1. Seed/ensure Admin account
    const adminEmail = 'admin@gmail.com';
    const adminPassword = 'admin123';
    const existingAdmin = await User.findOne({ where: { email: adminEmail } });
    if (existingAdmin) {
      console.log('Admin account found. Updating password and role to ensure access...');
      existingAdmin.role = 'admin';
      existingAdmin.password = adminPassword;
      await existingAdmin.save();
    } else {
      await User.create({
        name: 'App Admin',
        email: adminEmail,
        password: adminPassword,
        role: 'admin',
      });
      console.log('Admin account created successfully!');
    }

    // 2. Seed/ensure Regular User account
    const userEmail = 'user@gmail.com';
    const userPassword = 'user123';
    const existingUser = await User.findOne({ where: { email: userEmail } });
    if (existingUser) {
      console.log('User account found. Updating password and role to ensure access...');
      existingUser.role = 'user'; // Default user role
      existingUser.password = userPassword;
      await existingUser.save();
    } else {
      await User.create({
        name: 'App User',
        email: userEmail,
        password: userPassword,
        role: 'user',
      });
      console.log('User account created successfully!');
    }
    
    console.log('\n─────────────────────────────────');
    console.log('  Accounts Synced Successfully');
    console.log('─────────────────────────────────');
    console.log('  Admin Account Details:');
    console.log('  Email   : ' + adminEmail);
    console.log('  Password: ' + adminPassword);
    console.log('─────────────────────────────────');
    console.log('  User Account Details:');
    console.log('  Email   : ' + userEmail);
    console.log('  Password: ' + userPassword);
    console.log('─────────────────────────────────\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding accounts:', error);
    process.exit(1);
  }
};

seedAccounts();

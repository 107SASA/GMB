import mongoose from 'mongoose';
const MONGODB_URI = "mongodb+srv://ishantoraskar07_db_user:pTK7ExeS3IYWVfHW@gmbboost.bnnszbl.mongodb.net/gmbboost?retryWrites=true&w=majority&appName=GMBBoost";

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('--- DATABASE STATE ---');
  
  const Business = mongoose.connection.collection('businesses');
  const User = mongoose.connection.collection('users');

  const users = await User.find({}).toArray();
  for (const user of users) {
    console.log(`\nUser: ${user.email} (ID: ${user._id})`);
    console.log(`activeBusinessId: ${user.activeBusinessId}`);
  }

  console.log('\nBusinesses:');
  const businesses = await Business.find({}).toArray();
  for (const b of businesses) {
    console.log(`ID: ${b._id} | Name: ${b.name} | CreatedAt: ${b.createdAt}`);
  }

  process.exit(0);
}

run().catch(console.error);

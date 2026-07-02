import mongoose from 'mongoose';
const MONGODB_URI = "mongodb+srv://ishantoraskar07_db_user:pTK7ExeS3IYWVfHW@gmbboost.bnnszbl.mongodb.net/gmbboost?retryWrites=true&w=majority&appName=GMBBoost";

async function run() {
  if (!MONGODB_URI) {
    console.error('No MONGODB_URI found');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to DB');

  const Business = mongoose.connection.collection('businesses');
  const User = mongoose.connection.collection('users');

  const business = await Business.findOne({ name: { $regex: /desun/i } });
  
  if (!business) {
    console.log('Business not found');
    process.exit(0);
  }
  console.log('Found business:', business.name);

  if (!business.userId) {
    console.log('No user associated with this business');
    process.exit(0);
  }

  const user = await User.findOne({ _id: business.userId });
  if (!user) {
    console.log('User not found');
    process.exit(0);
  }

  console.log('User details:');
  console.log('Email:', user.email);
  console.log('ID:', user._id);
  console.log('Password Hash:', user.passwordHash);

  process.exit(0);
}

run().catch(console.error);

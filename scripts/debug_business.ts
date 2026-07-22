import mongoose from 'mongoose';

// Never hardcode credentials here — this file is committed. Pass the URI in:
//   MONGODB_URI="mongodb+srv://..." npx tsx scripts/debug_business.ts
function requireMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Prefix the command with MONGODB_URI="..."');
    process.exit(1);
  }
  return uri;
}
const MONGODB_URI = requireMongoUri();

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

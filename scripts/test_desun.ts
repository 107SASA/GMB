import mongoose from 'mongoose';

// Never hardcode credentials here — this file is committed. Pass the URI in:
//   MONGODB_URI="mongodb+srv://..." npx tsx scripts/test_desun.ts
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
  const Business = mongoose.connection.collection('businesses');
  const business = await Business.findOne({ name: { $regex: /Desun/, $options: 'i' } });
  console.log("Business:", business);
  const User = mongoose.connection.collection('users');
  const user = await User.findOne({ _id: business?.userId });
  console.log("User:", user);
  process.exit(0);
}
run();

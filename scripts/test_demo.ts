import mongoose from 'mongoose';

// Never hardcode credentials here — this file is committed. Pass the URI in:
//   MONGODB_URI="mongodb+srv://..." npx tsx scripts/test_demo.ts
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
  const User = mongoose.connection.collection('users');
  const user = await User.findOne({ email: "demo@example.com" });
  console.log("demo@example.com:", user);
  const user2 = await User.findOne({ email: "demo@gmbboost.com" });
  console.log("demo@gmbboost.com:", user2);
  process.exit(0);
}
run();

import mongoose from 'mongoose';
const MONGODB_URI = "mongodb+srv://ishantoraskar07_db_user:pTK7ExeS3IYWVfHW@gmbboost.bnnszbl.mongodb.net/gmbboost?retryWrites=true&w=majority&appName=GMBBoost";
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

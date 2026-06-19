import mongoose from 'mongoose';
const MONGODB_URI = "mongodb+srv://ishantoraskar07_db_user:pTK7ExeS3IYWVfHW@gmbboost.bnnszbl.mongodb.net/gmbboost?retryWrites=true&w=majority&appName=GMBBoost";
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

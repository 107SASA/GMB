const mongoose = require("mongodb");
async function run() {
  const uri = "mongodb+srv://ishantoraskar07_db_user:pTK7ExeS3IYWVfHW@gmbboost.bnnszbl.mongodb.net/gmbboost?retryWrites=true&w=majority&appName=GMBBoost";
  const client = new mongoose.MongoClient(uri);
  try {
    await client.connect();
    const b = await client.db().collection('businesses').findOne({ _id: new mongoose.ObjectId('6a09b71bece19dbcd240d010') });
    console.log("Business:", b ? b._id : "null");
  } finally {
    await client.close();
  }
}
run().catch(console.dir);

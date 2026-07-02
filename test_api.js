const { MongoClient, ObjectId } = require("mongodb");

async function run() {
  const uri = "mongodb+srv://ishantoraskar07_db_user:pTK7ExeS3IYWVfHW@gmbboost.bnnszbl.mongodb.net/gmbboost?retryWrites=true&w=majority&appName=GMBBoost";
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const business = await db.collection("businesses").findOne({ _id: new ObjectId('6a09b71bece19dbcd240d010') });
    console.log("Found business:", business ? business.name : "null");
  } finally {
    await client.close();
  }
}
run().catch(console.dir);

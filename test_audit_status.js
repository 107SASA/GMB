const { MongoClient } = require("mongodb");
async function run() {
  const uri = "mongodb+srv://ishantoraskar07_db_user:pTK7ExeS3IYWVfHW@gmbboost.bnnszbl.mongodb.net/gmbboost?retryWrites=true&w=majority&appName=GMBBoost";
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const audits = await client.db().collection('audits').find({}).sort({createdAt:-1}).limit(1).toArray();
    console.log("Latest Audit Status:", audits[0] ? audits[0].status : "null");
  } finally {
    await client.close();
  }
}
run().catch(console.dir);

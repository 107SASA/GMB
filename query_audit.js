const { MongoClient } = require("mongodb");
async function run() {
  const uri = "mongodb+srv://ishantoraskar07_db_user:pTK7ExeS3IYWVfHW@gmbboost.bnnszbl.mongodb.net/gmbboost?retryWrites=true&w=majority&appName=GMBBoost";
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const audits = await db.collection("audits").find({}).sort({createdAt:-1}).limit(2).toArray();
    console.log("Audits:", audits.map(a => ({ id: a._id, status: a.status, businessId: a.businessId })));
    const businesses = await db.collection("businesses").find({}).limit(1).toArray();
    console.log("Businesses:", businesses.map(b => ({ id: b._id, name: b.name })));
  } finally {
    await client.close();
  }
}
run().catch(console.dir);

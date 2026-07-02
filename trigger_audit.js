require("dotenv").config({ path: ".env.local" });
const { MongoClient, ObjectId } = require("mongodb");

async function run() {
  const uri = process.env.MONGODB_URI;
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const audits = await db.collection("audits").find({ status: "PENDING" }).sort({createdAt:-1}).limit(1).toArray();
    if (audits.length > 0) {
       console.log("Found pending audit:", audits[0]._id.toString());
       const id = audits[0]._id.toString();
       const res = await fetch("http://localhost:3000/api/inngest", {
         method: "POST",
         headers: { "Content-Type": "application/json" }
       });
       console.log("Inngest trigger attempt:", res.status);
    } else {
       console.log("No pending audits.");
    }
  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }
}
run();

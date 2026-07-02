const mongoose = require('mongoose');

async function cleanup() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");
    
    // Find the user
    const db = mongoose.connection.db;
    const result = await db.collection('users').deleteOne({ email: "ishan.toraskar23@pccoepune.org" });
    
    if (result.deletedCount > 0) {
      console.log("SUCCESS: Test user ishan.toraskar23@pccoepune.org has been deleted.");
    } else {
      console.log("User not found or already deleted.");
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected.");
  }
}

cleanup();

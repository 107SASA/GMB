const { Inngest } = require('inngest');

const inngest = new Inngest({ id: "test", eventKey: "local" });

async function run() {
  try {
    await inngest.send({ name: 'test/event', data: {} });
    console.log("Success default");
  } catch(e) {
    console.error("Default failed:", e.message);
  }
}
run();

const bcrypt = require('bcryptjs');
const hash = "$2b$12$bFQq0XtmccfDO.QHmKidseLT9OMTFsU4Os/IypX0W2m39aTecn28u";
console.log("password123:", bcrypt.compareSync("password123", hash));
console.log("demo123:", bcrypt.compareSync("demo123", hash));
console.log("demo", bcrypt.compareSync("demo", hash));

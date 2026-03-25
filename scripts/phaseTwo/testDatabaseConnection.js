const { testDatabaseConnection } = require("../../server/monolith/src/config/database");

testDatabaseConnection()
  .then(() => {
    console.log("Database connection test passed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Database connection test failed:");
    console.error(error);
    process.exit(1);
  });
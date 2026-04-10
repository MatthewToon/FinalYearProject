/*
 * Script: testDatabaseConnection
 *
 * This is a small development/testing script used during the project.
 * Read the code below to see which server event or workflow it exercises.
 */

const { testDatabaseConnection } = require("../../server/monolith/src/persistence/db");

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

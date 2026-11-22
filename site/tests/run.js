// Runs every test file in this directory in-process and exits non-zero on any failure.
// Usage: node site/tests/run.js
"use strict";
const path = require("path");
const { execFileSync } = require("child_process");

const files = ["lib.test.js", "app.test.js"];
let failed = false;
for (const file of files) {
  console.log("=== " + file + " ===");
  try {
    execFileSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
  } catch (e) {
    failed = true;
  }
}
process.exit(failed ? 1 : 0);

const mongoose = require("mongoose");
const { id } = require("./migrations/update-dreammoon-quantities");

async function main(args = process.argv.slice(2)) {
  return require("./migrate").main(args, [id]);
}

module.exports = { main };
if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}

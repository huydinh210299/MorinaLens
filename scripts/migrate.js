const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { runMigrations } = require("../services/migrationService");

async function main(args = process.argv.slice(2), selectedIds) {
  if (args.some((arg) => !["--apply", "--dry-run"].includes(arg)) ||
      (args.includes("--apply") && args.includes("--dry-run"))) {
    throw new Error("Cách dùng: npm run migrate -- [--dry-run | --apply]");
  }
  require("dotenv").config();
  // Preview không tự tạo collection/index khi nạp model.
  mongoose.set("autoCreate", false);
  mongoose.set("autoIndex", false);
  const all = require("./migrations");
  if (selectedIds?.some((id) => !all.some((migration) => migration.id === id))) {
    throw new Error("Không tìm thấy migration được yêu cầu.");
  }
  const migrations = selectedIds ? all.filter((migration) => selectedIds.includes(migration.id)) : all;
  await connectDB();
  const results = await runMigrations(migrations, { apply: args.includes("--apply") });
  for (const { id, status, result } of results) {
    if (result?.products) console.table(result.products.map(({ sku, name, quantity, status }) => ({ sku, name, quantity, status })));
    const { products, ...summary } = result || {};
    console.log(JSON.stringify({ id, status, ...summary }, null, 2));
  }
  if (!args.includes("--apply")) console.log("Chỉ xem trước. Thêm --apply để chạy các migration chưa hoàn tất.");
  return results;
}

module.exports = { main };
if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}

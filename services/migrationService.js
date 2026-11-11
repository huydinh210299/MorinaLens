// Mỗi migration có ID cố định. Chỉ completed mới được coi là đã chạy xong.
async function runMigration(migration, { apply = false, model } = {}) {
  if (!migration?.id || typeof migration.up !== "function") throw new Error("Migration cần id và hàm up.");
  model ??= require("../models/Migration");
  const skipped = (record) => ({ id: migration.id, status: "skipped", result: record.result });
  const runningError = () => new Error(`Migration ${migration.id} đang chạy. Không chạy đồng thời; kiểm tra tiến trình trước khi thử lại.`);
  const existing = await model.findById(migration.id).lean();
  if (existing?.status === "completed") return skipped(existing);
  if (!apply) return { id: migration.id, status: existing?.status || "pending",
    result: migration.preview ? await migration.preview() : null };
  if (existing?.status === "running") throw runningError();

  const started = { description: migration.description || migration.id, status: "running",
    startedAt: new Date(), completedAt: null, error: null, result: null };
  // _id là unique: chỉ một tiến trình được nhận chạy migration này.
  const retry = existing?.status === "failed"
    ? await model.findOneAndUpdate({ _id: migration.id, status: "failed" }, { $set: started }, { new: true })
    : null;
  if (!retry) {
    try {
      await model.create({ _id: migration.id, ...started });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const latest = await model.findById(migration.id).lean();
      if (latest?.status === "completed") return skipped(latest);
      throw runningError();
    }
  }

  try {
    const result = await migration.up();
    const saved = await model.updateOne({ _id: migration.id, status: "running" }, {
      $set: { status: "completed", completedAt: new Date(), result: result ?? null, error: null }
    });
    if (saved.modifiedCount !== 1) throw new Error(`Không lưu được lịch sử migration ${migration.id}.`);
    return { id: migration.id, status: "completed", result };
  } catch (error) {
    await model.updateOne({ _id: migration.id, status: "running" }, {
      $set: { status: "failed", error: error.message }
    });
    throw error;
  }
}

async function runMigrations(migrations, options) {
  const ids = migrations.map((migration) => migration.id);
  if (new Set(ids).size !== ids.length) throw new Error("Danh sách migration bị trùng ID.");
  const results = [];
  for (const migration of migrations) results.push(await runMigration(migration, options));
  return results;
}

module.exports = { runMigration, runMigrations };

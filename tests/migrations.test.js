const test = require("node:test");
const assert = require("node:assert/strict");
const Migration = require("../models/Migration");
const { runMigration, runMigrations } = require("../services/migrationService");

function history(initial = []) {
  const documents = new Map(initial.map((record) => [record._id, structuredClone(record)]));
  const calls = { writes: 0 };
  const matches = (record, filter) => record && Object.entries(filter).every(([key, value]) => record[key] === value);
  const model = {
    findById(id) { return { lean: async () => structuredClone(documents.get(id) || null) }; },
    async create(record) {
      if (documents.has(record._id)) throw Object.assign(new Error("duplicate"), { code: 11000 });
      calls.writes += 1;
      documents.set(record._id, structuredClone(record));
    },
    async findOneAndUpdate(filter, update) {
      const record = documents.get(filter._id);
      if (!matches(record, filter)) return null;
      calls.writes += 1;
      Object.assign(record, structuredClone(update.$set));
      return structuredClone(record);
    },
    async updateOne(filter, update) {
      const record = documents.get(filter._id);
      if (!matches(record, filter)) return { modifiedCount: 0 };
      calls.writes += 1;
      Object.assign(record, structuredClone(update.$set));
      return { modifiedCount: 1 };
    }
  };
  return { documents, calls, model };
}

test("migration mới chỉ ghi completed sau khi up thành công và lưu kết quả", async () => {
  const db = history();
  const migration = { id: "001", description: "Tạo lens", up: async () => {
    assert.equal(db.documents.get("001").status, "running");
    assert.equal(db.documents.get("001").completedAt, null);
    return { created: 43 };
  } };
  const result = await runMigration(migration, { apply: true, model: db.model });
  assert.deepEqual(result, { id: "001", status: "completed", result: { created: 43 } });
  const record = db.documents.get("001");
  assert.equal(record.description, "Tạo lens");
  assert.ok(record.startedAt instanceof Date);
  assert.ok(record.completedAt instanceof Date);
  assert.equal(record.error, null);
  assert.equal(new Migration(record).validateSync(), undefined);
});

test("đã completed thì bỏ qua cả up và preview, không sửa lịch sử", async () => {
  const existing = { _id: "001", status: "completed", result: { created: 43 }, completedAt: new Date(0) };
  const db = history([existing]);
  const unexpected = () => assert.fail("Không được chạy script đã hoàn tất");
  for (const apply of [false, true]) {
    assert.equal((await runMigration({ id: "001", up: unexpected, preview: unexpected },
      { apply, model: db.model })).status, "skipped");
  }
  assert.equal(db.calls.writes, 0);
  assert.deepEqual(db.documents.get("001"), existing);
});

test("dry-run chỉ gọi preview và không ghi bản migration", async () => {
  const db = history();
  const result = await runMigration({ id: "001", up: () => assert.fail("Không được apply"),
    preview: async () => ({ pending: 43 }) }, { model: db.model });
  assert.deepEqual(result, { id: "001", status: "pending", result: { pending: 43 } });
  assert.equal(db.calls.writes, 0);
  assert.equal(db.documents.size, 0);
});

test("lỗi ghi failed, lần chạy sau retry và chỉ skip sau khi thành công", async () => {
  const db = history();
  let attempts = 0;
  const migration = { id: "001", up: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Mất kết nối khi nhập");
    return { created: 2, skipped: 41 };
  } };
  await assert.rejects(runMigration(migration, { apply: true, model: db.model }), /Mất kết nối/);
  assert.equal(db.documents.get("001").status, "failed");
  assert.equal(db.documents.get("001").completedAt, null);
  assert.equal(db.documents.get("001").error, "Mất kết nối khi nhập");
  assert.equal((await runMigration(migration, { apply: true, model: db.model })).status, "completed");
  assert.equal(db.documents.get("001").error, null);
  assert.equal((await runMigration(migration, { apply: true, model: db.model })).status, "skipped");
  assert.equal(attempts, 2);
});

test("hai tiến trình cùng nhận migration mới hoặc failed chỉ được chạy up một lần", async () => {
  for (const initial of [[], [{ _id: "001", status: "failed" }]]) {
    const db = history(initial);
    let attempts = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const migration = { id: "001", up: async () => { attempts += 1; await gate; } };
    const first = runMigration(migration, { apply: true, model: db.model });
    const second = runMigration(migration, { apply: true, model: db.model });
    // Tiến trình thua phải báo đang chạy, trong khi tiến trình thắng vẫn giữ khóa.
    const loser = await Promise.race([first, second].map((promise) => promise.then(
      () => assert.fail("Chưa được hoàn tất trước khi mở gate"), (error) => error)));
    assert.match(loser.message, /đang chạy/);
    assert.equal(attempts, 1);
    release();
    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(db.documents.get("001").status, "completed");
  }
});

test("running không tự chạy lại sau khi tiến trình trước bị tắt", async () => {
  const db = history([{ _id: "001", status: "running", startedAt: new Date(0) }]);
  await assert.rejects(runMigration({ id: "001", up: () => assert.fail("Không được chạy chồng") },
    { apply: true, model: db.model }), /đang chạy/);
  assert.equal(db.calls.writes, 0);
});

test("bộ chạy thực thi đúng thứ tự và dừng khi gặp migration lỗi", async () => {
  const db = history();
  const order = [];
  const migrations = [
    { id: "001", up: async () => { order.push(1); } },
    { id: "002", up: async () => { order.push(2); throw new Error("Lỗi 002"); } },
    { id: "003", up: async () => { order.push(3); } }
  ];
  await assert.rejects(runMigrations(migrations, { apply: true, model: db.model }), /Lỗi 002/);
  assert.deepEqual(order, [1, 2]);
  assert.equal(db.documents.get("001").status, "completed");
  assert.equal(db.documents.get("002").status, "failed");
  assert.equal(db.documents.has("003"), false);
});

test("từ chối ID trùng trước khi chạy bất cứ migration nào", async () => {
  const db = history();
  const migration = { id: "001", up: () => assert.fail("Không được ghi") };
  await assert.rejects(runMigrations([migration, migration], { apply: true, model: db.model }), /trùng ID/);
  assert.equal(db.calls.writes, 0);
});

test("lệnh build chạy Bear lens và Dreammoon, skip các lần sau qua cùng lịch sử", async (t) => {
  const mongoose = require("mongoose");
  const Product = require("../models/Product");
  const { main } = require("../scripts/migrate");
  const db = history();
  const products = new Map();
  const previousUri = process.env.MONGODB_URI;
  const previousOptions = { autoCreate: mongoose.get("autoCreate"), autoIndex: mongoose.get("autoIndex") };
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/morina-lens";
  t.after(() => {
    if (previousUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previousUri;
    mongoose.set(previousOptions);
  });
  t.mock.method(mongoose, "connect", async () => {});
  const logs = t.mock.method(console, "log", () => {});
  t.mock.method(console, "table", () => {});
  for (const method of ["findById", "create", "findOneAndUpdate", "updateOne"]) {
    t.mock.method(Migration, method, db.model[method]);
  }
  t.mock.method(Product, "createIndexes", async () => {});
  const find = t.mock.method(Product, "find", () => ({ select: () => ({ lean: async () => [...products.values()] }) }));
  t.mock.method(Product, "updateOne", async ({ sku }, { $setOnInsert }) => {
    if (products.has(sku)) return { upsertedCount: 0 };
    products.set(sku, structuredClone($setOnInsert));
    return { upsertedCount: 1 };
  });
  t.mock.method(Product, "updateMany", async (filter, update) => {
    assert.equal(db.documents.get("20261111_001_bear_lens").status, "completed");
    let modifiedCount = 0;
    for (const product of products.values()) {
      if (filter.sku.$in.includes(product.sku) && product.ads.shopee.enabled !== true) {
        product.ads.shopee.enabled = update.$set["ads.shopee.enabled"];
        modifiedCount += 1;
      }
    }
    return { matchedCount: modifiedCount, modifiedCount };
  });

  const first = await main(["--apply"]);
  assert.equal(first[0].status, "completed");
  assert.equal(first[0].result.created, 43);
  assert.equal(first[1].status, "completed");
  assert.equal(first[1].result.updated, 43);
  assert.equal(first[2].id, "20261112_001_dreammoon");
  assert.equal(first[2].status, "completed");
  assert.equal(first[2].result.created, 12);
  assert.equal(first[2].result.totalQuantity, 64);
  assert.equal(first[2].result.products, undefined);
  assert.equal(products.size, 55);
  assert.equal(products.get("DREAMMOON_PINK_SUMMER").purchasePrice, 25000);
  assert.equal(products.get("DREAMMOON_PINK_SUMMER").shopeePrice, 73000);
  assert.ok([...products.values()].every((product) => product.ads.shopee.enabled));
  // Tồn đã bán không bị nhập lại trong build sau.
  products.get("BEAR_AMBER_BROWN").quantity = 0;
  products.get("DREAMMOON_CHOCO_NATURE").quantity = 3;
  const second = await main(["--apply"]);
  assert.equal(second[0].status, "skipped");
  assert.equal(second[1].status, "skipped");
  assert.equal(second[2].status, "skipped");
  assert.equal(find.mock.callCount(), 2);
  assert.equal(products.get("DREAMMOON_CHOCO_NATURE").quantity, 3);
  assert.equal(products.get("BEAR_AMBER_BROWN").quantity, 0);
  assert.equal(db.documents.get("20261111_001_bear_lens").status, "completed");
  // Mô phỏng local/VPS chỉ đã hoàn tất bước nhập ở phiên bản trước.
  db.documents.delete("20261111_002_bear_lens_shopee_ads");
  for (const product of products.values()) {
    if (product.sku.startsWith("BEAR_")) product.ads.shopee.enabled = false;
  }
  const upgrade = await main(["--apply"]);
  assert.equal(upgrade[0].status, "skipped");
  assert.equal(upgrade[1].status, "completed");
  assert.equal(upgrade[1].result.updated, 43);
  assert.equal(upgrade[2].status, "skipped");
  assert.equal(find.mock.callCount(), 2);
  assert.equal(products.get("BEAR_AMBER_BROWN").quantity, 0);
  assert.ok([...products.values()].every((product) => product.ads.shopee.enabled));
  const output = logs.mock.calls.map((call) => call.arguments[0]).filter((line) => line.startsWith("{"));
  assert.deepEqual(output.map((line) => JSON.parse(line).status),
    ["completed", "completed", "completed", "skipped", "skipped", "skipped", "skipped", "completed", "skipped"]);
});

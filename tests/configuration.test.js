const test = require("node:test");
const assert = require("node:assert/strict");
const Configuration = require("../models/Configuration");
const { migratePricingConfiguration } = require("../services/configurationService");

test("chuyển cấu hình cũ một lần, reset voucher % về 0đ và giữ chỉnh sửa tiếp theo", async (t) => {
  const rows = [
    { platform: "shopee", key: "fixedFee", value: 17, unit: "percent" },
    { platform: "shopee", key: "shopVoucher", value: 10, unit: "percent" },
    { platform: "tiktok", key: "shopVoucher", value: 5, unit: "percent" },
    { platform: "tiktok", key: "fixedFee", value: 9, unit: "percent" }
  ];
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object") {
      if ("$ne" in value) return row[key] !== value.$ne;
      if ("$in" in value) return value.$in.includes(row[key]);
    }
    return row[key] === value;
  });
  t.mock.method(Configuration, "updateOne", async (filter, update) => {
    const row = rows.find((row) => matches(row, filter));
    if (row) Object.assign(row, update.$set);
  });
  t.mock.method(Configuration, "updateMany", async (filter, update) => {
    for (const row of rows.filter((row) => matches(row, filter))) Object.assign(row, update.$set);
  });
  await migratePricingConfiguration();
  assert.equal(rows[0].value, 16.5);
  assert.equal(rows[0].pricingRevision, 2);
  for (const row of rows.slice(1, 3)) {
    assert.equal(row.value, 0);
    assert.equal(row.unit, "vnd");
  }
  assert.equal(rows[3].value, 9);
  rows[0].value = 17;
  rows[1].value = 2000;
  const afterAdminEdit = structuredClone(rows);
  await migratePricingConfiguration();
  assert.deepEqual(rows, afterAdminEdit);
});

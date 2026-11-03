const mongoose = require("mongoose");
const Product = require("../models/Product");
const Movement = require("../models/ImportAndExport");
const User = require("../models/User");
const { recalculatePayroll, getDefaultOrderRate } = require("./userService");
const AppError = require("../utils/errors");
const input = require("../utils/input");
const pricing = require("./pricingService");
let operationTail = Promise.resolve();

async function runInventory(work) {
  let release;
  const previous = operationTail;
  operationTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (hello.setName || hello.msg === "isdbgrid") return await mongoose.connection.transaction((session) => work(session));
    return await work(null);
  } finally { release(); }
}

async function rollbackStock(applied) {
  for (const { productId, delta } of applied.reverse()) {
    await Product.updateOne({ _id: productId }, { $inc: { quantity: -delta } });
  }
}

function parse(body, role) {
  const type = String(body.type || "");
  if (!["import", "export", "return"].includes(type)) throw new AppError("Loại phiếu không hợp lệ.");
  if (role !== "admin" && type === "import") throw new AppError("Nhân viên chỉ được tạo phiếu xuất và hoàn hàng.", 403);
  const raw = Array.isArray(body.items) ? body.items : Object.values(body.items || {});
  const items = raw.filter((row) => row && (row.sku || row.amount)).map((row) => ({
    sku: input.text(row.sku, "SKU", 60).toUpperCase(),
    amount: input.number(row.amount, "Số lượng", { min: 1, integer: true })
  }));
  if (items.length === 0) throw new AppError("Cần ít nhất một sản phẩm trong phiếu.");
  if (new Set(items.map((row) => row.sku)).size !== items.length) throw new AppError("Một SKU chỉ được xuất hiện một lần trong phiếu.");
  const platform = body.platform || "shopee";
  if (!["shopee", "tiktok"].includes(platform)) throw new AppError("Sàn bán hàng không hợp lệ.");
  return { type, date: input.date(body.date), platform,
    note: input.optionalText(body.note), items };
}

async function prepareSaleItems(data, session, previous = null) {
  if (data.type !== "export") {
    for (const item of data.items) item.saleSnapshot = null;
    return;
  }
  const config = await pricing.getConfig(data.platform);
  if (!pricing.hasCompleteConfig(config)) throw new AppError(`Chưa đủ cấu hình phí ${data.platform === "shopee" ? "Shopee" : "TikTok"} để tính doanh thu và lợi nhuận.`);
  for (const item of data.items) {
    const oldItem = previous?.items.find((row) => row.sku === item.sku);
    if (previous?.type === "export" && previous.platform === data.platform && oldItem?.saleSnapshot) {
      item.saleSnapshot = oldItem.saleSnapshot.toObject ? oldItem.saleSnapshot.toObject() : oldItem.saleSnapshot;
      continue;
    }
    const product = await Product.findOne({ sku: item.sku }).session(session);
    if (!product) throw new AppError(`Không tìm thấy SKU ${item.sku}.`);
    const price = data.platform === "shopee" ? product.shopeePrice : product.tiktokPrice;
    if (price === null || price === undefined) throw new AppError(`SKU ${item.sku} chưa có giá bán trên sàn ${data.platform === "shopee" ? "Shopee" : "TikTok"}.`);
    const result = pricing.calculateProduct(product, config, data.platform);
    item.saleSnapshot = { listPrice: price, unitRevenue: result.sale, unitCost: result.cost, unitProfit: result.profit, adsPercentApplied: result.adsPercent };
  }
}

async function adjust(items, type, direction, session, applied = null) {
  const sign = (type === "export" ? -1 : 1) * direction;
  for (const item of items) {
    const filter = item.product ? { _id: item.product } : { sku: item.sku };
    if (sign < 0) filter.quantity = { $gte: item.amount };
    const product = await Product.findOneAndUpdate(filter, { $inc: { quantity: sign * item.amount } }, { new: true, session });
    if (!product) throw new AppError(`SKU ${item.sku}: không tồn tại hoặc không đủ tồn kho.`);
    item.product = product._id;
    if (applied) applied.push({ productId: product._id, delta: sign * item.amount });
  }
}

async function create(body, user) {
  const data = parse(body, user.role);
  await runInventory(async (session) => {
    const applied = [];
    try {
      await prepareSaleItems(data, session);
      await adjust(data.items, data.type, 1, session, applied);
      const requiresApproval = user.role === "staff";
      await Movement.create([{ ...data, createdBy: user._id, requiresApproval,
        approvalStatus: requiresApproval ? "pending" : "approved",
        approvedBy: requiresApproval ? null : user._id,
        approvedAt: requiresApproval ? null : new Date() }], { session });
    } catch (error) {
      if (!session) await rollbackStock(applied);
      throw error;
    }
  });
}
function applyMovementOrder(user, movement, deleting = false, defaultRate = 1500) {
  const existing = user.orders.find((row) => String(row.movement) === String(movement._id));
  const eligible = !deleting && movement.requiresApproval && movement.approvalStatus === "approved" && movement.type === "export";
  if (!existing && !eligible) return false;
  const months = new Set();
  if (existing) months.add(existing.date.toISOString().slice(0, 7));
  if (eligible) {
    if (existing) { existing.date = movement.date; existing.amount = 1; }
    else user.orders.push({ date: movement.date, amount: 1, movement: movement._id });
    months.add(movement.date.toISOString().slice(0, 7));
  } else existing.deleteOne();
  for (const month of months) recalculatePayroll(user, month, defaultRate);
  return true;
}
async function syncMovementOrder(movement, session, deleting = false) {
  const user = await User.findById(movement.createdBy).session(session);
  if (!user) throw new AppError("Không tìm thấy nhân viên tạo phiếu.", 404);
  const defaultRate = await getDefaultOrderRate(session);
  if (!applyMovementOrder(user, movement, deleting, defaultRate)) return;
  await user.save({ session });
}
async function approve(id, adminId) {
  await runInventory(async (session) => {
    const movement = await Movement.findById(id).session(session);
    if (!movement) throw new AppError("Không tìm thấy phiếu kho.", 404);
    if (!movement.requiresApproval) throw new AppError("Phiếu này không cần duyệt.");
    if (movement.approvalStatus === "approved") return syncMovementOrder(movement, session);
    movement.approvalStatus = "approved";
    movement.approvedBy = adminId;
    movement.approvedAt = new Date();
    await syncMovementOrder(movement, session);
    try { await movement.save({ session }); }
    catch (error) {
      if (!session) await syncMovementOrder({ ...movement.toObject(), approvalStatus: "pending" }, null);
      throw error;
    }
  });
}
async function update(id, body) {
  const data = parse(body, "admin");
  await runInventory(async (session) => {
    const previous = await Movement.findById(id).session(session);
    if (!previous) throw new AppError("Không tìm thấy phiếu kho.", 404);
    const original = previous.toObject();
    await prepareSaleItems(data, session, previous);
    for (const item of data.items) {
      const product = await Product.findOne({ sku: item.sku }).select("_id").session(session);
      if (!product) throw new AppError(`Không tìm thấy SKU ${item.sku}.`);
      item.product = product._id;
    }
    const deltas = new Map();
    const collect = (items, type, direction) => {
      for (const item of items) {
        const key = String(item.product);
        const entry = deltas.get(key) || { sku: item.sku, delta: 0 };
        entry.delta += (type === "export" ? -1 : 1) * direction * item.amount;
        deltas.set(key, entry);
      }
    };
    collect(previous.items, previous.type, -1);
    collect(data.items, data.type, 1);
    const applied = [];
    let saved = false;
    try {
      for (const [productId, { sku, delta }] of deltas) {
        if (delta === 0) continue;
        const filter = { _id: productId };
        if (delta < 0) filter.quantity = { $gte: -delta };
        const product = await Product.findOneAndUpdate(filter, { $inc: { quantity: delta } }, { session });
        if (!product) throw new AppError(`SKU ${sku}: không đủ tồn kho để sửa phiếu.`);
        applied.push({ productId, delta });
      }
      Object.assign(previous, data);
      await previous.save({ session });
      saved = true;
      await syncMovementOrder(previous, session);
    } catch (error) {
      if (!session) {
        if (saved) await Movement.collection.replaceOne({ _id: previous._id }, original);
        await rollbackStock(applied);
      }
      throw error;
    }
  });
}
async function remove(id) {
  await runInventory(async (session) => {
    const previous = await Movement.findById(id).session(session);
    if (!previous) throw new AppError("Không tìm thấy phiếu kho.", 404);
    const original = previous.toObject();
    const applied = [];
    let deleted = false;
    try {
      await adjust(previous.items, previous.type, -1, session, applied);
      await previous.deleteOne({ session });
      deleted = true;
      await syncMovementOrder(previous, session, true);
    } catch (error) {
      if (!session) {
        if (deleted) await Movement.collection.insertOne(original);
        await rollbackStock(applied);
      }
      throw error;
    }
  });
}
module.exports = { parse, create, approve, update, remove, applyMovementOrder, runInventory };

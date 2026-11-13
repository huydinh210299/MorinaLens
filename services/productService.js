const Product = require("../models/Product");
const ImportAndExport = require("../models/ImportAndExport");
const AppError = require("../utils/errors");
const input = require("../utils/input");
const { runInventory } = require("./inventoryService");
const { today, parseDay } = require("../utils/businessDate");

function parseIdentity(body) {
  const sku = input.text(body.sku, "SKU", 60).toUpperCase();
  if (!/^[A-Z0-9._-]+$/.test(sku)) throw new AppError("SKU chỉ gồm chữ, số, dấu chấm, gạch dưới và gạch ngang.");
  return { sku, name: input.text(body.name, "Tên sản phẩm") };
}

function parse(body, creating = false) {
  if (!Object.hasOwn(body, "shopeePrice") || !Object.hasOwn(body, "tiktokPrice")) {
    throw new AppError("Biểu mẫu giá theo sàn chưa đầy đủ. Hãy tải lại trang sản phẩm.");
  }
  const parseAds = (platform, label) => ({
    enabled: body.ads?.[platform]?.enabled === "on",
    percentOverride: input.optionalNumber(body.ads?.[platform]?.percentOverride, `Ads riêng ${label}`, { min: 0, max: 100 })
  });
  const result = {
    ...parseIdentity(body),
    purchasePrice: input.number(body.purchasePrice, "Giá nhập"),
    shopeePrice: input.optionalNumber(body.shopeePrice, "Giá bán Shopee"),
    tiktokPrice: input.optionalNumber(body.tiktokPrice, "Giá bán TikTok"),
    ads: { shopee: parseAds("shopee", "Shopee"), tiktok: parseAds("tiktok", "TikTok") },
    note: input.optionalText(body.note)
  };
  if (creating) result.quantity = input.number(body.quantity ?? 0, "Tồn đầu kỳ", { integer: true });
  return result;
}

async function create(body) {
  return saveNew(parse(body, true));
}
async function saveNew(data) {
  try { return await Product.create(data); }
  catch (error) { if (error.code === 11000) throw new AppError("SKU đã tồn tại."); throw error; }
}
async function clone(id, body) {
  const source = await Product.findById(id).lean();
  if (!source) throw new AppError("Không tìm thấy sản phẩm.", 404);
  return saveNew({
    ...parseIdentity(body),
    quantity: input.number(body.quantity, "Tồn đầu kỳ", { integer: true }),
    purchasePrice: source.purchasePrice,
    shopeePrice: source.shopeePrice,
    tiktokPrice: source.tiktokPrice,
    ads: source.ads,
    note: source.note
  });
}
async function update(id, body, actor) {
  const data = parse(body);
  try {
    return await runInventory(async (session) => {
      const item = await Product.findById(id).session(session);
      if (!item) throw new AppError("Không tìm thấy sản phẩm.", 404);
      const quantity = body.quantity === undefined ? item.quantity : input.number(body.quantity, "Số lượng tồn kho", { integer: true });
      if (body.quantity !== undefined && input.number(body.expectedQuantity, "Tồn kho lúc mở form", { integer: true }) !== item.quantity) {
        throw new AppError("Tồn kho đã thay đổi từ lúc mở form. Hãy tải lại trang trước khi cập nhật.");
      }
      const before = item.toObject();
      const difference = quantity - item.quantity;
      Object.assign(item, data, { quantity });
      let saved = false;
      try {
        await item.save({ session });
        saved = true;
        if (difference !== 0) {
          await ImportAndExport.create([{ type: difference > 0 ? "import" : "export", date: parseDay(today()),
            platform: "shopee", items: [{ product: item._id, sku: item.sku, amount: Math.abs(difference) }],
            source: "product_update", note: `Điều chỉnh tồn kho trong sản phẩm: ${before.quantity} → ${quantity}.`,
            createdBy: actor._id, requiresApproval: true, approvalStatus: "pending", approvedBy: null, approvedAt: null }], { session });
        }
        return item;
      } catch (error) {
        if (!session && saved) await Product.collection.replaceOne({ _id: item._id }, before);
        throw error;
      }
    });
  } catch (error) { if (error.code === 11000) throw new AppError("SKU đã tồn tại."); throw error; }
}
async function remove(id) {
  const product = await Product.findById(id);
  if (!product) throw new AppError("Không tìm thấy sản phẩm.", 404);
  if (await ImportAndExport.exists({ "items.product": id })) throw new AppError("Sản phẩm đã có lịch sử kho nên không thể xóa.");
  await product.deleteOne();
}
module.exports = { create, clone, update, remove };

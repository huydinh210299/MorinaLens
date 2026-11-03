const Product = require("../models/Product");
const ImportAndExport = require("../models/ImportAndExport");
const AppError = require("../utils/errors");
const input = require("../utils/input");
const { runInventory } = require("./inventoryService");

function parse(body, creating = false) {
  if (!Object.hasOwn(body, "shopeePrice") || !Object.hasOwn(body, "tiktokPrice")) {
    throw new AppError("Biểu mẫu giá theo sàn chưa đầy đủ. Hãy tải lại trang sản phẩm.");
  }
  const parseAds = (platform, label) => ({
    enabled: body.ads?.[platform]?.enabled === "on",
    percentOverride: input.optionalNumber(body.ads?.[platform]?.percentOverride, `Ads riêng ${label}`, { min: 0, max: 100 })
  });
  const result = {
    sku: input.text(body.sku, "SKU", 60).toUpperCase(),
    name: input.text(body.name, "Tên sản phẩm"),
    purchasePrice: input.number(body.purchasePrice, "Giá nhập"),
    shopeePrice: input.optionalNumber(body.shopeePrice, "Giá bán Shopee"),
    tiktokPrice: input.optionalNumber(body.tiktokPrice, "Giá bán TikTok"),
    ads: { shopee: parseAds("shopee", "Shopee"), tiktok: parseAds("tiktok", "TikTok") },
    note: input.optionalText(body.note)
  };
  if (!/^[A-Z0-9._-]+$/.test(result.sku)) throw new AppError("SKU chỉ gồm chữ, số, dấu chấm, gạch dưới và gạch ngang.");
  if (creating) result.quantity = input.number(body.quantity ?? 0, "Tồn đầu kỳ", { integer: true });
  return result;
}

async function create(body) {
  try { return await Product.create(parse(body, true)); }
  catch (error) { if (error.code === 11000) throw new AppError("SKU đã tồn tại."); throw error; }
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
          const now = new Date();
          await ImportAndExport.create([{ type: difference > 0 ? "import" : "export", date: now,
            platform: "shopee", items: [{ product: item._id, sku: item.sku, amount: Math.abs(difference) }],
            source: "product_update", note: `Điều chỉnh tồn kho trong sản phẩm: ${before.quantity} → ${quantity}.`,
            createdBy: actor._id, requiresApproval: false, approvalStatus: "approved", approvedBy: actor._id, approvedAt: now }], { session });
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
module.exports = { create, update, remove };

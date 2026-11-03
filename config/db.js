const mongoose = require("mongoose");

module.exports = async function connectDB() {
  if (!process.env.MONGODB_URI) throw new Error("Thiếu MONGODB_URI.");
  const uri = new URL(process.env.MONGODB_URI);
  if (uri.pathname.replace(/^\//, "") !== "morina-lens") {
    throw new Error("MONGODB_URI phải trỏ tới database morina-lens.");
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Đã kết nối MongoDB morina-lens.");
};

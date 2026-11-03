require("dotenv").config();
const path = require("path");
const express = require("express");
const layouts = require("express-ejs-layouts");
const cookieParser = require("cookie-parser");
const methodOverride = require("method-override");
const connectDB = require("./config/db");
const { attachUser, requireAuth } = require("./middleware/auth");
const csrf = require("./middleware/csrf");
const { wrap, notFound, handle } = require("./middleware/errors");
const dashboard = require("./controllers/dashboardController");
const seed = require("./scripts/seed");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET cần ít nhất 32 ký tự.");
const app = express();
app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("layout", "layouts/main");
app.use(layouts);
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public")));
app.use(csrf);
app.use(wrap(attachUser));
app.use((req, res, next) => {
  res.locals.message = req.query.message || "";
  res.locals.error = req.query.error || "";
  res.locals.money = (value) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value || 0)) + " ₫";
  res.locals.dateTime = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "—";
  res.locals.dateOnly = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeZone: "UTC" }).format(new Date(value)) : "—";
  res.locals.dateInput = (value) => value ? new Date(value).toISOString().slice(0, 10) : new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date());
  next();
});
app.get("/", (req, res) => res.redirect(req.user ? "/dashboard" : "/auth/login"));
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/auth", require("./routes/authRoutes"));
app.get("/dashboard", requireAuth, wrap(dashboard.index));
app.use("/products", require("./routes/productRoutes"));
app.use("/inventory", require("./routes/inventoryRoutes"));
app.use("/users", require("./routes/userRoutes"));
app.use("/configuration", require("./routes/configurationRoutes"));
app.use("/revenue", require("./routes/revenueRoutes"));
app.use(notFound);
app.use(handle);

async function start() {
  await connectDB();
  await seed();
  app.listen(Number(process.env.PORT || 3100), "127.0.0.1", () => console.log(`MorinaLens chạy tại cổng ${process.env.PORT || 3100}`));
}
if (require.main === module) start().catch((error) => { console.error(error); process.exit(1); });
module.exports = app;

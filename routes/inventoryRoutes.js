const router = require("express").Router();
const controller = require("../controllers/inventoryController");
const { requireAuth, adminOnly } = require("../middleware/auth");
const { wrap } = require("../middleware/errors");
router.use(requireAuth);
router.get("/", wrap(controller.index));
router.get("/new", wrap(controller.form));
router.get("/approvals", adminOnly, controller.redirectApprovals);
router.post("/approvals", adminOnly, wrap(controller.approve));
router.post("/approve", adminOnly, wrap(controller.approve));
// Tính năng chốt Ads đã gỡ; URL cũ không được tạo hoặc sửa dữ liệu.
router.all("/ads", (req, res) => res.sendStatus(404));
router.post("/", wrap(controller.create));
router.get("/:id/edit", adminOnly, wrap(controller.form));
router.put("/:id", adminOnly, wrap(controller.update));
router.delete("/:id", adminOnly, wrap(controller.remove));
module.exports = router;

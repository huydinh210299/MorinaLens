const router = require("express").Router();
const { adminOnly } = require("../middleware/auth");
const { wrap } = require("../middleware/errors");
const controller = require("../controllers/guideController");

router.use(adminOnly);
router.get("/", wrap(controller.index));
module.exports = router;

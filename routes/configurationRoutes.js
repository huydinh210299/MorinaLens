const router = require("express").Router();
const controller = require("../controllers/configurationController");
const { adminOnly } = require("../middleware/auth");
const { wrap } = require("../middleware/errors");
router.use(adminOnly);
router.get("/", wrap(controller.index));
router.post("/:platform/:key", wrap(controller.update));
module.exports = router;

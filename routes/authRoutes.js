const router = require("express").Router();
const controller = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");
const { wrap } = require("../middleware/errors");
router.get("/login", controller.loginPage);
router.post("/login", wrap(controller.login));
router.post("/logout", requireAuth, controller.logout);
module.exports = router;

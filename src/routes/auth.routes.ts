import { Router } from "express";
import * as C from "../controllers/auth.controller";
import { authenticate } from "../middleware/authenticate";

const router = Router();

router.post("/auth/register", C.register);
router.post("/auth/login", C.login);
router.post("/auth/refresh", C.refresh);
router.post("/auth/logout", C.logout);
router.get("/auth/me", authenticate, C.getMe);

export default router;

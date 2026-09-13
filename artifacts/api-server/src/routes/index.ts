import licencesRouter from './licences';
import { Router, type IRouter } from "express";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(licencesRouter);

export default router;

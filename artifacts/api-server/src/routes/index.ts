import licencesRouter from './licences';
import adminLicencesRouter from './adminLicences';
import { Router, type IRouter } from "express";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(licencesRouter);
router.use(adminLicencesRouter);

export default router;

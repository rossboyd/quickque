import licencesRouter from './licences';
import adminLicencesRouter from './adminLicences';
import adminSessionRouter from './adminSession';
import { Router, type IRouter } from "express";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(licencesRouter);
router.use(adminSessionRouter);
router.use(adminLicencesRouter);

export default router;

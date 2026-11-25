import { Router } from "express";
import { projectsController } from "../controllers/projects.controller.js";

const router = Router();

router.get("/", projectsController.getAll);
router.post("/bulk", projectsController.saveAll);
router.post("/", projectsController.saveProject);

router.get("/:id/variables", projectsController.getVariables);
router.put("/:id/variables", projectsController.saveVariables);
router.get("/:id/session", projectsController.getSessionStatus);
router.delete("/:id/session", projectsController.clearSession);

router.put("/:id/features/reorder", projectsController.reorderFeatures);
router.patch("/:id/features/reorder", projectsController.reorderFeatures);
router.post("/:id/features/import", projectsController.importFeatures);
router.post("/:id/features", projectsController.saveFeature);
router.put("/:id/features/:featureId", projectsController.saveFeature);
router.delete("/:id/features/:featureId", projectsController.deleteFeature);

router.put("/:id", projectsController.saveProject);
router.get("/:id", projectsController.getById);
router.delete("/:id", projectsController.deleteProject);

export default router;

import { projectsService } from "../services/projects.service.js";

export class ProjectsController {
  constructor(service = projectsService) {
    this.service = service;
  }

  getAll = async (req, res, next) => {
    try {
      const projects = await this.service.getAll();
      res.status(200).json({ success: true, projects });
    } catch (err) {
      next(err);
    }
  };

  getById = async (req, res, next) => {
    try {
      const project = await this.service.getById(req.params.id);
      res.status(200).json({ success: true, project });
    } catch (err) {
      next(err);
    }
  };

  saveAll = async (req, res, next) => {
    try {
      const { projects, force } = req.body;
      const saved = await this.service.saveAll(projects, { force: Boolean(force) });
      res.status(200).json({ success: true, projects: saved });
    } catch (err) {
      next(err);
    }
  };

  saveProject = async (req, res, next) => {
    try {
      const projectData = {
        ...req.body,
        ...(req.params.id ? { id: req.params.id } : {}),
      };
      const force = req.query.force === "true" || req.body?.force === true;
      const saved = await this.service.saveProject(projectData, { force });
      res.status(200).json({ success: true, project: saved });
    } catch (err) {
      next(err);
    }
  };

  deleteProject = async (req, res, next) => {
    try {
      const result = await this.service.deleteProject(req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  saveFeature = async (req, res, next) => {
    try {
      const featureData = {
        ...req.body,
        ...(req.params.featureId ? { id: req.params.featureId } : {}),
      };
      const force = req.query.force === "true" || req.body?.force === true;
      const result = await this.service.saveFeature(req.params.id, featureData, { force });
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  };

  reorderFeatures = async (req, res, next) => {
    try {
      const orderedIds = req.body?.orderedIds || req.body?.featureIds;
      const project = await this.service.reorderFeatures(req.params.id, orderedIds);
      res.status(200).json({ success: true, project });
    } catch (err) {
      next(err);
    }
  };

  importFeatures = async (req, res, next) => {
    try {
      const features = req.body?.features;
      const result = await this.service.importFeatures(req.params.id, features);
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  };

  deleteFeature = async (req, res, next) => {
    try {
      const result = await this.service.deleteFeature(req.params.id, req.params.featureId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getVariables = async (req, res, next) => {
    try {
      const [variables, sessionStatus] = await Promise.all([
        this.service.getVariables(req.params.id),
        this.service.getProjectSessionStatus(req.params.id),
      ]);
      res.status(200).json({
        success: true,
        variables,
        hasSavedSession: Boolean(sessionStatus?.hasSavedSession),
      });
    } catch (err) {
      next(err);
    }
  };

  saveVariables = async (req, res, next) => {
    try {
      const variables = await this.service.saveVariables(req.params.id, req.body?.variables);
      res.status(200).json({ success: true, variables });
    } catch (err) {
      next(err);
    }
  };

  getSessionStatus = async (req, res, next) => {
    try {
      const status = await this.service.getProjectSessionStatus(req.params.id);
      res.status(200).json({ success: true, ...status });
    } catch (err) {
      next(err);
    }
  };

  clearSession = async (req, res, next) => {
    try {
      const result = await this.service.clearProjectSession(req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };
}

export const projectsController = new ProjectsController();

import Plan from '../models/Plan.js';
import { successResponse, errorResponse } from '../utils/response.js';

export const index = async (req, res) => {
  try {
    const filter = {};
    const isAdmin = req.user?.role === 'super_admin' || req.user?.role === 'admin';
    if (!isAdmin) filter.isActive = true;

    const plans = await Plan.find(filter).sort({ sortOrder: 1, price: 1 });

    if (req.xhr || req.headers.accept?.includes('json')) {
      return successResponse(res, { plans });
    }

    if (isAdmin) {
      return res.render('admin/plans/index', { title: 'Plan Management', plans, activePage: 'plans' });
    }

    res.render('plan/index', { title: 'Plans', plans, activePage: 'plans' });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const getPlan = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return errorResponse(res, 'Plan not found', 404);
    successResponse(res, { plan });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const create = async (req, res) => {
  try {
    const planData = { ...req.body };
    if (req.body.features && typeof req.body.features === 'string') {
      planData.features = JSON.parse(req.body.features);
    }
    const plan = await Plan.create(planData);
    successResponse(res, { plan }, 'Plan created', 201);
  } catch (error) {
    errorResponse(res, error.message, 400);
  }
};

export const update = async (req, res) => {
  try {
    const updates = { ...req.body };
    if (req.body.features && typeof req.body.features === 'string') {
      updates.features = JSON.parse(req.body.features);
    }
    const plan = await Plan.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!plan) return errorResponse(res, 'Plan not found', 404);
    successResponse(res, { plan }, 'Plan updated');
  } catch (error) {
    errorResponse(res, error.message, 400);
  }
};

export const remove = async (req, res) => {
  try {
    const plan = await Plan.findByIdAndDelete(req.params.id);
    if (!plan) return errorResponse(res, 'Plan not found', 404);
    successResponse(res, null, 'Plan deleted');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const editView = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return errorResponse(res, 'Plan not found', 404);
    successResponse(res, { plan });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};



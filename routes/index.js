import { Router } from 'express';
import authRoutes from './auth.js';
import webRoutes from './web.js';
import apiRoutes from './api.js';
import { csrfProtection } from '../middlewares/csrf.js';
import logger from '../utils/logger.js';
import Plan from '../models/Plan.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1, price: 1 });
    res.render('landing', { title: 'Home', appName: 'WhatsApp SaaS', plans });
  } catch (err) {
    logger.error('Landing page error:', err);
    res.render('landing', { title: 'Home', appName: 'WhatsApp SaaS', plans: [] });
  }
});

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

router.use('/auth', csrfProtection, authRoutes);
router.use('/api', apiRoutes);
router.use('/', csrfProtection, webRoutes);

export default router;

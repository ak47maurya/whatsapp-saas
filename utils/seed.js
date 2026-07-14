import mongoose from 'mongoose';
import config from '../config/index.js';
import User from '../models/User.js';
import Plan from '../models/Plan.js';
import SystemSetting from '../models/SystemSetting.js';
import Subscription from '../models/Subscription.js';
import logger from '../utils/logger.js';

const seedPlans = [
  {
    name: 'Trial',
    slug: 'trial',
    description: 'Get started with basic features',
    price: 0,
    currency: 'INR',
    validity: 1,
    isActive: true,
    isTrial: true,
    sortOrder: 0,
    features: {
      whatsappInstances: 1,
      dailyMessageLimit: 50,
      monthlyMessageLimit: 1500,
      apiAccess: false,
      webhookAccess: false,
      campaignAccess: false,
      teamMembers: 1,
      contactsLimit: 100,
      groupsLimit: 5,
      mediaMessaging: true,
      bulkMessaging: false,
      chatbot: false,
      dynamicMessaging: false,
      scheduler: false,
      apiKeys: 0,
      webhookUrls: 0,
      exportData: false,
      outgoingMessages: true,
      incomingMessages: true,
    },
    metadata: { badge: 'Free' },
  },
  {
    name: 'Starter',
    slug: 'starter',
    description: 'For individuals and small businesses',
    price: 499,
    currency: 'INR',
    validity: 30,
    isActive: true,
    isTrial: false,
    sortOrder: 1,
    features: {
      whatsappInstances: 1,
      dailyMessageLimit: 200,
      monthlyMessageLimit: 6000,
      apiAccess: true,
      webhookAccess: false,
      campaignAccess: false,
      teamMembers: 1,
      contactsLimit: 500,
      groupsLimit: 10,
      mediaMessaging: true,
      bulkMessaging: false,
      chatbot: false,
      dynamicMessaging: false,
      scheduler: false,
      apiKeys: 1,
      webhookUrls: 1,
      exportData: false,
      outgoingMessages: true,
      incomingMessages: true,
    },
    metadata: {},
  },
  {
    name: 'Professional',
    slug: 'professional',
    description: 'For growing businesses',
    price: 1499,
    currency: 'INR',
    validity: 30,
    isActive: true,
    isTrial: false,
    sortOrder: 2,
    features: {
      whatsappInstances: 3,
      dailyMessageLimit: 1000,
      monthlyMessageLimit: 30000,
      apiAccess: true,
      webhookAccess: true,
      campaignAccess: true,
      teamMembers: 3,
      contactsLimit: 2000,
      groupsLimit: 25,
      mediaMessaging: true,
      bulkMessaging: true,
      chatbot: true,
      dynamicMessaging: true,
      scheduler: true,
      apiKeys: 5,
      webhookUrls: 3,
      exportData: true,
      outgoingMessages: true,
      incomingMessages: true,
    },
    metadata: { popular: true, badge: 'Most Popular', highlight: true },
  },
  {
    name: 'Business',
    slug: 'business',
    description: 'For established businesses',
    price: 3999,
    currency: 'INR',
    validity: 30,
    isActive: true,
    isTrial: false,
    sortOrder: 3,
    features: {
      whatsappInstances: 10,
      dailyMessageLimit: 5000,
      monthlyMessageLimit: 150000,
      apiAccess: true,
      webhookAccess: true,
      campaignAccess: true,
      teamMembers: 10,
      contactsLimit: 10000,
      groupsLimit: 100,
      mediaMessaging: true,
      bulkMessaging: true,
      chatbot: true,
      dynamicMessaging: true,
      scheduler: true,
      apiKeys: 20,
      webhookUrls: 10,
      exportData: true,
      outgoingMessages: true,
      incomingMessages: true,
    },
    metadata: {},
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'For large organizations',
    price: 9999,
    currency: 'INR',
    validity: 30,
    isActive: true,
    isTrial: false,
    sortOrder: 4,
    features: {
      whatsappInstances: -1,
      dailyMessageLimit: -1,
      monthlyMessageLimit: -1,
      apiAccess: true,
      webhookAccess: true,
      campaignAccess: true,
      teamMembers: -1,
      contactsLimit: -1,
      groupsLimit: -1,
      mediaMessaging: true,
      bulkMessaging: true,
      chatbot: true,
      dynamicMessaging: true,
      scheduler: true,
      apiKeys: -1,
      webhookUrls: -1,
      exportData: true,
      outgoingMessages: true,
      incomingMessages: true,
    },
    metadata: { badge: 'Unlimited' },
  },
];

const seedSettings = [
  { key: 'app_name', value: config.app.name, group: 'general', type: 'string', isPublic: true },
  { key: 'app_url', value: config.app.url, group: 'general', type: 'string', isPublic: true },
  { key: 'maintenance_mode', value: false, group: 'maintenance', type: 'boolean', isPublic: false },
  { key: 'max_instances_per_user', value: 10, group: 'limits', type: 'number', isPublic: false },
  { key: 'default_message_delay', value: 2000, group: 'limits', type: 'number', isPublic: false },
  { key: 'enable_registration', value: true, group: 'general', type: 'boolean', isPublic: false },
  { key: 'trial_days', value: config.trial.days, group: 'limits', type: 'number', isPublic: false },
  { key: 'trial_message_limit', value: config.trial.messageLimit, group: 'limits', type: 'number', isPublic: false },
  { key: 'file_retention_days', value: 30, group: 'maintenance', type: 'number', isPublic: false, description: 'Auto-delete uploaded files older than N days' },
];

const seed = async () => {
  try {
    console.log('Connecting to MongoDB:', config.mongodb.uri?.substring(0, 50) + '...');
    await mongoose.connect(config.mongodb.uri, {
      serverSelectionTimeoutMS: 10000,
    });
    logger.info('Connected to MongoDB for seeding');
    console.log('MongoDB connected successfully');

    const existingAdmin = await User.findOne({ email: config.admin.email });
    if (!existingAdmin) {
      const admin = await User.create({
        name: config.admin.name,
        email: config.admin.email,
        password: config.admin.password,
        role: 'super_admin',
        status: 'active',
        emailVerified: true,
      });
      logger.info(`Admin created: ${admin.email} / ${config.admin.password}`);
    } else {
      logger.info('Admin already exists');
    }

    for (const planData of seedPlans) {
      await Plan.findOneAndUpdate(
        { slug: planData.slug },
        { $set: planData },
        { upsert: true, new: true }
      );
      logger.info(`Plan synced: ${planData.name}`);
    }

    for (const setting of seedSettings) {
      await SystemSetting.findOneAndUpdate(
        { key: setting.key },
        { $set: setting },
        { upsert: true, new: true }
      );
      logger.info(`Setting synced: ${setting.key}`);
    }

    // Migrate existing subscriptions — add missing feature fields with defaults
    const subResult = await Subscription.updateMany(
      { 'features.chatbot': { $exists: false } },
      { $set: { 'features.chatbot': false, 'features.dynamicMessaging': false, 'features.outgoingMessages': true, 'features.incomingMessages': true } }
    );
    const subResult2 = await Subscription.updateMany(
      { 'features.outgoingMessages': { $exists: false } },
      { $set: { 'features.outgoingMessages': true, 'features.incomingMessages': true } }
    );
    if (subResult2.modifiedCount > 0) logger.info(`Migrated ${subResult2.modifiedCount} subscriptions with incoming/outgoing feature fields`);
    if (subResult.modifiedCount > 0) logger.info(`Migrated ${subResult.modifiedCount} subscriptions with new feature fields`);

    // Sync subscription features with their linked plan features (direct native driver)
    const db = mongoose.connection.db;
    const allPlans = await Plan.find({}).lean();
    const planFeaturesMap = {};
    for (const plan of allPlans) {
      planFeaturesMap[plan._id.toString()] = plan.features;
    }
    const allSubs = await Subscription.find({}).lean();
    let synced = 0;
    for (const sub of allSubs) {
      const planId = sub.plan?.toString();
      const planFeats = planFeaturesMap[planId];
      if (planFeats) {
        const merged = { ...planFeats };
        if (sub.features) {
          for (const [k, v] of Object.entries(sub.features)) {
            if (!(k in planFeats)) merged[k] = v;
          }
        }
        await db.collection('subscriptions').updateOne(
          { _id: sub._id },
          { $set: { features: merged } }
        );
        synced++;
      }
    }
    logger.info(`Synced ${synced} subscription features with their plans`);

    logger.info('Seed completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n=== SEED FAILED ===');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    console.error('==================\n');
    logger.error({ err: error }, 'Seed failed');
    process.exit(1);
  }
};

seed();

import mongoose from 'mongoose';
import config from '../config/index.js';
import User from '../models/User.js';
import Plan from '../models/Plan.js';
import Subscription from '../models/Subscription.js';
import Instance from '../models/Instance.js';
import Message from '../models/Message.js';
import logger from '../utils/logger.js';

const migrations = {};

migrations.v1_initial = async () => {
  logger.info('Running v1_initial migration...');
  await User.createIndexes();
  await Plan.createIndexes();
  await Subscription.createIndexes();
  await Instance.createIndexes();
  await Message.createIndexes();
  logger.info('Indexes created');
};

migrations.v2_add_fields = async () => {
  logger.info('Running v2_add_fields migration...');
  await Instance.updateMany(
    { battery: { $exists: false } },
    { $set: { battery: { level: null, plugged: false } } }
  );
  logger.info('Added battery fields to instances');
};

const runMigrations = async () => {
  try {
    await mongoose.connect(config.mongodb.uri);
    logger.info('Connected to MongoDB for migrations');

    const db = mongoose.connection.db;
    const migrationsCollection = db.collection('migrations');

    for (const [name, fn] of Object.entries(migrations)) {
      const exists = await migrationsCollection.findOne({ name });
      if (!exists) {
        await fn();
        await migrationsCollection.insertOne({ name, executedAt: new Date() });
        logger.info(`Migration executed: ${name}`);
      } else {
        logger.info(`Migration already executed: ${name}`);
      }
    }

    logger.info('All migrations completed');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
};

runMigrations();

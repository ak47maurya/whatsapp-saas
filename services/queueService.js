import logger from '../utils/logger.js';

const queues = new Map();
const workers = new Map();
let jobCounter = 0;

export const getQueueName = (instanceId) => {
  return `instance-${instanceId}`;
};

export const createQueue = (instanceId) => {
  const queueName = getQueueName(instanceId);
  if (queues.has(queueName)) {
    return queues.get(queueName);
  }
  const queue = { name: queueName, jobs: [], processing: false, paused: false };
  queues.set(queueName, queue);
  logger.info(`Queue created: ${queueName}`);
  return queue;
};

export const getQueue = (instanceId) => {
  const queueName = getQueueName(instanceId);
  return queues.get(queueName) || null;
};

export const addMessageJob = async (instanceId, jobData, options = {}) => {
  const queue = createQueue(instanceId);
  const job = { id: ++jobCounter, data: jobData, opts: options, addedAt: new Date(), status: 'waiting' };
  queue.jobs.push(job);
  logger.info(`Job added to queue ${queue.name}: ${job.id}`);
  processQueue(instanceId);
  return job;
};

export const addCampaignJob = async (instanceId, campaignData, options = {}) => {
  const queue = createQueue(instanceId);
  const delay = options.delay || 0;
  const job = { id: ++jobCounter, data: campaignData, opts: options, addedAt: new Date(), status: 'waiting' };

  if (delay > 0) {
    setTimeout(() => {
      queue.jobs.push(job);
      processQueue(instanceId);
    }, delay);
  } else {
    queue.jobs.push(job);
    processQueue(instanceId);
  }
  return job;
};

export const pauseQueue = async (instanceId) => {
  const queue = getQueue(instanceId);
  if (queue) {
    queue.paused = true;
    logger.info(`Queue paused: ${queue.name}`);
  }
};

export const resumeQueue = async (instanceId) => {
  const queue = getQueue(instanceId);
  if (queue) {
    queue.paused = false;
    logger.info(`Queue resumed: ${queue.name}`);
    processQueue(instanceId);
  }
};

export const getQueueStatus = async (instanceId) => {
  const queue = getQueue(instanceId);
  if (!queue) return { exists: false };
  return {
    exists: true,
    isPaused: queue.paused,
    counts: {
      waiting: queue.jobs.filter(j => j.status === 'waiting').length,
      active: queue.jobs.filter(j => j.status === 'active').length,
      completed: 0,
      failed: 0,
      delayed: 0,
    },
  };
};

export const getJobCounts = async (instanceId) => {
  const queue = getQueue(instanceId);
  if (!queue) return null;
  return { waiting: queue.jobs.filter(j => j.status === 'waiting').length };
};

export const cleanQueue = async (instanceId, grace = 3600) => {
  const queue = getQueue(instanceId);
  if (queue) {
    const cutoff = Date.now() - grace * 1000;
    queue.jobs = queue.jobs.filter(j => j.status === 'waiting' || j.addedAt.getTime() > cutoff);
  }
};

export const removeQueue = async (instanceId) => {
  const queueName = getQueueName(instanceId);
  const queue = queues.get(queueName);
  if (queue) {
    queue.jobs = [];
    logger.info(`Queue removed: ${queueName}`);
  }
};

const instanceProcessors = new Map();

export const createWorker = (instanceId, processor) => {
  const queueName = getQueueName(instanceId);
  if (workers.has(queueName)) return workers.get(queueName);

  instanceProcessors.set(queueName, processor);
  const worker = {
    instanceId,
    queueName,
    close: async () => { workers.delete(queueName); instanceProcessors.delete(queueName); },
  };
  workers.set(queueName, worker);
  logger.info(`Worker created: ${queueName}`);

  processQueue(instanceId);
  return worker;
};

async function processQueue(instanceId) {
  const queueName = getQueueName(instanceId);
  const queue = getQueue(instanceId);
  const processor = instanceProcessors.get(queueName);

  if (!queue || !processor || queue.processing || queue.paused) return;
  queue.processing = true;

  while (queue.jobs.length > 0 && !queue.paused) {
    const job = queue.jobs.shift();
    if (!job) break;
    job.status = 'active';

    try {
      await processor(job);
      logger.debug(`Job ${job.id} completed in ${queueName}`);
    } catch (err) {
      logger.error(`Job ${job.id} failed in ${queueName}: ${err.message}`);
      const retries = job.opts?.attempts || 0;
      if ((job.retries || 0) < retries) {
        job.retries = (job.retries || 0) + 1;
        job.status = 'waiting';
        queue.jobs.unshift(job);
      }
    }
  }

  queue.processing = false;
}

export const getQueueMetrics = async () => {
  const metrics = [];
  for (const [name, queue] of queues) {
    metrics.push({ name, waiting: queue.jobs.filter(j => j.status === 'waiting').length });
  }
  return metrics;
};

export default { createQueue, getQueue, addMessageJob, addCampaignJob, pauseQueue, resumeQueue, getQueueStatus, getJobCounts, cleanQueue, removeQueue, createWorker, getQueueMetrics };

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (question) => new Promise((resolve) => {
  rl.question(question, resolve);
});

const directories = [
  'config', 'controllers', 'middlewares', 'models', 'services',
  'workers', 'sockets', 'jobs', 'uploads',
  'public/css', 'public/js', 'public/images', 'public/uploads',
  'views/auth', 'views/admin', 'views/user', 'views/partials',
  'views/instance', 'views/campaign', 'views/contact', 'views/message',
  'views/group', 'views/webhook', 'views/api', 'views/plan',
  'views/subscription', 'views/inbox', 'views/notification',
  'views/errors',
  'utils', 'docs', 'logs', 'tests',
];

const setup = async () => {
  console.log('\n=== WhatsApp SaaS Platform Setup ===\n');
  console.log('Setting up project directories...\n');

  const rootDir = path.join(__dirname, '..');

  for (const dir of directories) {
    const dirPath = path.join(rootDir, dir);
    await fs.mkdir(dirPath, { recursive: true });
    console.log(`  Created: ${dir}`);
  }

  const envExample = path.join(rootDir, '.env.example');
  const envPath = path.join(rootDir, '.env');

  try {
    await fs.access(envPath);
    console.log('\n  .env file already exists, skipping...');
  } catch {
    const envContent = await fs.readFile(envExample, 'utf-8');
    await fs.writeFile(envPath, envContent);
    console.log('\n  Created: .env file from .env.example');
    console.log('  IMPORTANT: Update the .env file with your configuration!');
  }

  console.log('\n  Run: npm install');
  console.log('  Run: node utils/seed.js (to seed initial data)');
  console.log('  Run: npm start (to start the server)');
  console.log('\n=== Setup Complete ===\n');

  rl.close();
};

setup().catch(console.error);

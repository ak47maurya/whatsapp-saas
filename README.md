# WhatsApp SaaS Platform

Multi-Tenant WhatsApp SaaS Platform built with Node.js, Express.js, MongoDB, Socket.IO, and Baileys 7.

## Features

### Authentication & Authorization
- Registration, Login, Logout
- Forgot/Reset Password
- JWT + Session Authentication
- Role-Based Access Control (Super Admin, Admin, Customer)

### WhatsApp Instances
- Create/Connect/Disconnect/Delete Instances
- QR Code Authentication via Baileys 7
- Multiple Instances Per User (plan-dependent)
- Secure Session Storage
- Auto-Reconnect
- Connection Status Monitoring

### Messaging
- Send Text, Image, Video, Audio, Documents, Stickers, Location, Contacts
- Bulk Messaging with Queue System
- CSV/Excel Import for Contacts
- Delivery Status Tracking
- Rate Limiting & Delay Controls
- **Incoming media auto-saved to disk, auto-deleted after 15 days**

### Campaign Management
- Create Draft/Scheduled Campaigns
- Start, Pause, Resume, Stop Campaigns
- Real-time Analytics (Sent, Delivered, Failed, Pending)
- Media support (image, video, audio, document, sticker)
- Random/Fixed Delay Support

### In-Memory Queue System
- Dedicated Queue Per Instance
- Retry Mechanism
- Delayed/Scheduled Jobs
- Pause/Resume Queue
- Queue Monitoring
- No external dependency (no Redis needed for queue)

### Contact & Group Management
- Import/Export Contacts (CSV, Excel)
- Tags & Lists
- Groups Auto-Fetch
- Group Messaging

### Chatbot
- Auto-reply rules per instance
- Keyword-based triggers
- Multi-rule support

### API Platform
- REST API with API Keys
- Send Message, Media, Bulk
- Campaign Management
- Instance Status
- Message History
- Full API Documentation

### Webhooks
- User-Defined Webhook URLs
- Event-Based Triggering
- Signature Verification
- Retry Logic

### Admin Dashboard
- User Management (CRUD, Suspend, Activate)
- Plan Management (Trial/Starter/Professional/Business/Enterprise)
- System Statistics & Analytics
- Queue Monitoring

### Security
- Helmet Security Headers
- Rate Limiting (Global: 500/15min, Auth: 10/15min, API: 60/min)
- CSRF Protection (session-based tokens)
- XSS Protection
- Password Hashing (bcryptjs, 12 rounds)
- Secure Session Management (MongoStore)

## Tech Stack

- **Backend:** Node.js, Express.js
- **Frontend:** EJS, Bootstrap 5, Font Awesome, SweetAlert
- **Database:** MongoDB 7+, Mongoose ODM
- **Realtime:** Socket.IO
- **WhatsApp Engine:** Baileys 7.0.0-rc13
- **Auth:** JWT, Express Session (MongoStore)
- **Background Jobs:** In-memory queue (no Redis/BullMQ)
- **Process Manager:** PM2
- **Reverse Proxy:** NGINX

## Installation

### Prerequisites
- Node.js 18+
- MongoDB 7+

### Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd whatsapp-saas

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Seed initial data
node utils/seed.js

# Start development
npm run dev

# Or for production with PM2
pm2 start ecosystem.config.cjs
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| NODE_ENV | Environment | development |
| PORT | Server port | 3000 |
| MONGODB_URI | MongoDB connection string | mongodb://localhost:27017/whatsapp-saas |
| SESSION_SECRET | Session encryption secret | - |
| JWT_SECRET | JWT signing secret | - |
| SMTP_HOST | Email server host | smtp.gmail.com |
| SMTP_PORT | Email server port | 587 |
| SMTP_USER | Email username | - |
| SMTP_PASS | Email password | - |
| APP_URL | Application public URL | http://localhost:3000 |
| TRIAL_DAYS | Trial period in days | 7 |

## Project Structure

```
project/
├── app.js              # Express app setup
├── server.js           # Server entry point
├── config/             # Configuration
│   ├── index.js        # App configuration
│   ├── database.js     # MongoDB connection
│   └── redis.js        # Redis client (connection state only)
├── models/             # Mongoose schemas
├── controllers/        # Route handlers
├── routes/             # Express routes (web, api, auth)
├── middlewares/        # Auth, RBAC, CSRF, Security
├── services/           # Business logic
│   ├── whatsappService.js  # Baileys socket management
│   ├── queueService.js     # In-memory queue
│   ├── messageQueue.js     # Message sending queue
│   ├── mediaStorage.js     # Media file storage
│   └── ...
├── sockets/            # Socket.IO handlers
├── jobs/               # Cron jobs
├── views/              # EJS templates
├── public/             # Static assets
├── utils/              # Helpers & seed scripts
├── deploy/             # Deployment configs (nginx, setup)
└── tests/              # Test files
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start with file watching |
| `npm run seed` | Seed database with plans & admin |
| `npm run cron` | Start cron job process |

## API Documentation

Full API docs available at `/api-docs` after login.

### Authentication
All API requests require `X-API-Key` header.

### Endpoints

#### Send Message
```
POST /api/send-message
Content-Type: application/json
X-API-Key: your-api-key

{
  "instanceId": "INSTANCE_ID",
  "to": "2348012345678",
  "type": "text",
  "text": "Hello World"
}
```

#### Send Media
```
POST /api/send-media
{
  "instanceId": "INSTANCE_ID",
  "to": "2348012345678",
  "type": "image",
  "mediaUrl": "https://example.com/image.jpg",
  "caption": "Check this"
}
```

#### Send Bulk Messages
```
POST /api/send-bulk
{
  "instanceId": "INSTANCE_ID",
  "type": "text",
  "text": "Hello {{name}}",
  "recipients": [
    {"phone": "2348012345678", "name": "John"},
    {"phone": "2348098765432", "name": "Jane"}
  ]
}
```

#### Get Instance Status
```
GET /api/instance-status?instanceId=ID
```

#### Get Message History
```
GET /api/message-history?instanceId=ID&limit=50&page=1
```

## PM2 Setup

```bash
# Install PM2 globally
npm install -g pm2

# Start all processes (app + cron)
pm2 start ecosystem.config.cjs

# View status
pm2 status

# View logs
pm2 logs wa-saas-app

# Restart
pm2 restart wa-saas-app

# Stop
pm2 stop wa-saas-app

# Save process list
pm2 save
pm2 startup
```

## NGINX Configuration

See `deploy/nginx.conf` for complete WebSocket-ready configuration.

```bash
sudo ln -s /var/www/whatsapp-saas/deploy/nginx.conf /etc/nginx/sites-available/whatsapp-saas
sudo ln -s /etc/nginx/sites-available/whatsapp-saas /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## SSL Configuration

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Auto-renewal
sudo certbot renew --dry-run
```

## Production Deployment

1. Set strong `SESSION_SECRET` and `JWT_SECRET` in `.env`
2. Enable HTTPS with SSL certificate
3. Configure email SMTP
4. Set proper `APP_URL`
5. Run `node utils/seed.js`
6. Start with `pm2 start ecosystem.config.cjs`
7. Configure firewall (UFW): allow 22, 80, 443

## Backup Strategy

```bash
# MongoDB Backup
mongodump --uri="mongodb://localhost:27017/whatsapp-saas" --out=/backups/$(date +%Y%m%d)

# Uploads Backup
tar -czf /backups/uploads-$(date +%Y%m%d).tar.gz public/uploads
```

## License

MIT

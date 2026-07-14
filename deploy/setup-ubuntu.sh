#!/bin/bash
# WhatsApp SaaS Platform - Ubuntu 24.04 Setup Script
set -e

echo "=== WhatsApp SaaS Platform Installation ==="

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs git build-essential

# Install MongoDB
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
  sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable mongod
sudo systemctl start mongod

# Install Redis
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Install PM2
sudo npm install -y pm2 -g

# Install NGINX
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# Clone project
mkdir -p /var/www/whatsapp-saas
cd /var/www/whatsapp-saas

# Install dependencies
npm install

# Setup environment
cp .env.example .env
echo "Edit .env file with your configuration"
echo "Run: node utils/seed.js"
echo "Run: pm2 start ecosystem.config.cjs"
echo ""
echo "=== Setup Complete ==="

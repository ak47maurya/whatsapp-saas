import crypto from 'crypto';

export const generateRandomString = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

export const generateRandomNumber = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

export const generateInvoiceNumber = () => {
  const prefix = 'INV';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

export const sanitizePhone = (phone) => {
  return phone.replace(/[^0-9]/g, '');
};

export const formatPhone = (phone) => {
  const cleaned = sanitizePhone(phone);
  if (cleaned.startsWith('0')) {
    return '234' + cleaned.slice(1);
  }
  if (cleaned.startsWith('+')) {
    return cleaned.slice(1);
  }
  return cleaned;
};

export const parseCSV = (text) => {
  const lines = text.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length === headers.length && values[0]) {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = values[index];
      });
      results.push(obj);
    }
  }
  return results;
};

export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const calculatePercentage = (value, total) => {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
};

export const truncateText = (text, maxLength = 100) => {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
};

export const isValidUrl = (string) => {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
};

export const maskEmail = (email) => {
  if (!email) return '';
  const [name, domain] = email.split('@');
  return `${name[0]}${'*'.repeat(name.length - 2)}${name[name.length - 1]}@${domain}`;
};

export const maskPhone = (phone) => {
  if (!phone) return '';
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
};

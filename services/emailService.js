import nodemailer from 'nodemailer';
import config from '../config/index.js';
import logger from '../utils/logger.js';

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });

  transporter.verify().then(() => {
    logger.info('Email service ready');
  }).catch((err) => {
    logger.warn('Email service not available:', err.message);
  });

  return transporter;
};

export const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const transport = getTransporter();
    const info = await transport.sendMail({
      from: `"${config.app.name}" <${config.email.from}>`,
      to,
      subject,
      html,
      text,
    });
    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('Email send failed:', error.message);
    throw error;
  }
};



import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../config/index.js';
import User from '../models/User.js';
import ActivityLog from '../models/ActivityLog.js';
import { sendEmail } from './emailService.js';
import logger from '../utils/logger.js';

export const registerUser = async ({ name, email, password }) => {
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new Error('Email already registered');
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const user = await User.create({
    name,
    email,
    password,
    status: 'active',
  });

  const verificationUrl = `${config.app.url}/auth/verify-email/${verificationToken}`;

  try {
    await sendEmail({
      to: email,
      subject: 'Verify your email address',
      html: `
        <h2>Welcome to ${config.app.name}</h2>
        <p>Please click the link below to verify your email address:</p>
        <a href="${verificationUrl}">Verify Email</a>
        <p>This link expires in 24 hours.</p>
      `,
    });
  } catch (err) {
    logger.error('Verification email failed:', err);
  }

  await ActivityLog.create({
    user: user._id,
    action: 'user.register',
    category: 'auth',
    description: `User registered: ${email}`,
    severity: 'info',
  });

  return { user, verificationToken };
};

export const loginUser = async ({ email, password, ipAddress, userAgent }) => {
  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    throw new Error('Invalid email or password');
  }

  if (user.status === 'suspended') {
    throw new Error('Account has been suspended');
  }

  if (user.status === 'inactive') {
    throw new Error('Account is inactive');
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new Error('Invalid email or password');
  }

  const token = jwt.sign(
    { id: user._id, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  user.lastLogin = new Date();
  user.lastLoginIp = ipAddress;
  await user.save();

  await ActivityLog.create({
    user: user._id,
    action: 'user.login',
    category: 'auth',
    description: `User logged in: ${email}`,
    ipAddress,
    userAgent,
    severity: 'info',
  });

  return { user, token };
};

export const logoutUser = async (userId, ipAddress, userAgent) => {
  await ActivityLog.create({
    user: userId,
    action: 'user.logout',
    category: 'auth',
    description: 'User logged out',
    ipAddress,
    userAgent,
    severity: 'info',
  });
};

export const forgotPassword = async (email) => {
  const user = await User.findOne({ email });
  if (!user) {
    return;
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

  user.resetPasswordToken = resetToken;
  user.resetPasswordExpires = resetExpires;
  await user.save();

  const resetUrl = `${config.app.url}/auth/reset-password/${resetToken}`;

  try {
    await sendEmail({
      to: email,
      subject: 'Password Reset Request',
      html: `
        <h2>Password Reset</h2>
        <p>Click the link below to reset your password:</p>
        <a href="${resetUrl}">Reset Password</a>
        <p>This link expires in 1 hour.</p>
        <p>If you did not request this, please ignore this email.</p>
      `,
    });
  } catch (err) {
    logger.error('Password reset email failed:', err);
    throw new Error('Failed to send reset email');
  }
};

export const resetPassword = async (token, newPassword) => {
  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    throw new Error('Invalid or expired reset token');
  }

  user.password = newPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  await ActivityLog.create({
    user: user._id,
    action: 'user.password_reset',
    category: 'auth',
    description: 'Password reset completed',
    severity: 'info',
  });
};

export const verifyEmail = async (token) => {
  const user = await User.findOne({
    emailVerificationToken: token,
    emailVerificationExpires: { $gt: Date.now() },
  });

  if (!user) {
    throw new Error('Invalid or expired verification token');
  }

  user.emailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  user.status = 'active';
  await user.save();

  return user;
};

export const getProfile = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  return user;
};

export const updateProfile = async (userId, updates) => {
  const allowedFields = ['name', 'phone', 'avatar', 'settings'];
  const filteredUpdates = {};

  Object.keys(updates).forEach(key => {
    if (allowedFields.includes(key)) {
      filteredUpdates[key] = updates[key];
    }
  });

  const user = await User.findByIdAndUpdate(userId, filteredUpdates, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    throw new Error('User not found');
  }

  return user;
};

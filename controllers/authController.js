import { authService } from '../services/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import logger from '../utils/logger.js';
import Plan from '../models/Plan.js';
import Subscription from '../models/Subscription.js';

export const getLogin = (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Login' });
};

export const getRegister = (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('auth/register', { title: 'Register' });
};

export const getForgotPassword = (req, res) => {
  res.render('auth/forgot-password', { title: 'Forgot Password' });
};

export const getResetPassword = (req, res) => {
  res.render('auth/reset-password', { title: 'Reset Password', token: req.params.token });
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const { user, token } = await authService.loginUser({
      email,
      password,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    req.session.token = token;
    req.session.userId = user._id;

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'strict',
    });

    if (req.xhr || req.headers.accept?.includes('json')) {
      return successResponse(res, { user, token }, 'Login successful');
    }
    req.session.save(() => res.redirect('/dashboard'));
  } catch (error) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return errorResponse(res, error.message, 401);
    }
    res.render('auth/login', {
      title: 'Login',
      error: error.message,
    });
  }
};

export const register = async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      throw new Error('Passwords do not match');
    }

    const { user } = await authService.registerUser({ name, email, password });

    // Auto-assign trial plan
    try {
      const trialPlan = await Plan.findOne({ isTrial: true, isActive: true });
      if (trialPlan) {
        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + (trialPlan.validity || 7));

        await Subscription.create({
          user: user._id,
          plan: trialPlan._id,
          status: 'trial',
          startDate,
          endDate,
          trialEndDate: endDate,
          price: 0,
          currency: 'INR',
          paymentStatus: 'paid',
          features: trialPlan.features,
        });
      }
    } catch (subErr) {
      // trial subscription is optional, don't block registration
    }

    if (req.xhr || req.headers.accept?.includes('json')) {
      return successResponse(res, { user }, 'Registration successful. Please check your email to verify.');
    }
    res.render('auth/login', {
      title: 'Login',
      success: 'Registration successful. Please check your email to verify your account.',
    });
  } catch (error) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return errorResponse(res, error.message, 400);
    }
    res.render('auth/register', {
      title: 'Register',
      error: error.message,
    });
  }
};

export const logout = async (req, res) => {
  try {
    await authService.logoutUser(
      req.userId,
      req.ip,
      req.headers['user-agent']
    );
  } catch (err) {
    logger.error('Logout error:', err);
  }

  req.session.destroy((err) => { if (err) logger.error('Session destroy error:', err); });
  res.clearCookie('token');
  res.clearCookie('connect.sid');

  res.redirect('/auth/login');
};

export const forgotPassword = async (req, res) => {
  try {
    await authService.forgotPassword(req.body.email);
    if (req.xhr || req.headers.accept?.includes('json')) {
      return successResponse(res, null, 'If the email exists, a reset link has been sent');
    }
    res.render('auth/forgot-password', {
      title: 'Forgot Password',
      success: 'If the email exists, a reset link has been sent',
    });
  } catch (error) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return errorResponse(res, error.message, 400);
    }
    res.render('auth/forgot-password', {
      title: 'Forgot Password',
      error: error.message,
    });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { password, confirmPassword } = req.body;
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match');
    }
    await authService.resetPassword(req.params.token, password);
    if (req.xhr || req.headers.accept?.includes('json')) {
      return successResponse(res, null, 'Password reset successful');
    }
    res.render('auth/login', {
      title: 'Login',
      success: 'Password reset successful. Please login with your new password.',
    });
  } catch (error) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return errorResponse(res, error.message, 400);
    }
    res.render('auth/reset-password', {
      title: 'Reset Password',
      error: error.message,
      token: req.params.token,
    });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    await authService.verifyEmail(req.params.token);
    res.render('auth/login', {
      title: 'Login',
      success: 'Email verified successfully. You can now login.',
    });
  } catch (error) {
    res.render('auth/login', {
      title: 'Login',
      error: error.message,
    });
  }
};

export const getProfile = async (req, res) => {
  const user = await authService.getProfile(req.userId);
  successResponse(res, { user });
};

export const updateProfile = async (req, res) => {
  try {
    const user = await authService.updateProfile(req.userId, req.body);
    successResponse(res, { user }, 'Profile updated');
  } catch (error) {
    errorResponse(res, error.message, 400);
  }
};

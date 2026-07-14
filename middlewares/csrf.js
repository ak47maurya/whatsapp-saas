import crypto from 'crypto';

const CSRF_HEADER = 'x-csrf-token';
const CSRF_FORM_KEY = '_csrf';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export const csrfProtection = (req, res, next) => {
  if (!req.session) {
    return next(new Error('CSRF requires session'));
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.includes(req.method)) {
    return next();
  }

  const token = req.headers[CSRF_HEADER] || req.body[CSRF_FORM_KEY] || req.query[CSRF_FORM_KEY];

  if (!token || token !== req.session.csrfToken) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(403).json({ success: false, message: 'Invalid CSRF token' });
    }
    req.session.error = 'Invalid form submission, please try again';
    return res.redirect(req.get('Referer') || '/dashboard');
  }

  next();
};



import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import methodOverride from 'method-override';
import config from './config/index.js';
import { securityHeaders, globalRateLimiter, xssProtection } from './middlewares/security.js';
import { optionalAuth } from './middlewares/auth.js';
import routes from './routes/index.js';
import logger from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(securityHeaders);
app.use(cors({
  origin: config.env === 'production' ? config.app.url : '*',
  credentials: true,
}));
app.use(xssProtection);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(methodOverride('_method'));

app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: config.mongodb.uri,
    ttl: config.session.maxAge / 1000,
    autoRemove: 'native',
  }),
  cookie: {
    secure: config.env === 'production',
    httpOnly: true,
    maxAge: config.session.maxAge,
    sameSite: 'strict',
  },
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(path.join(__dirname, 'public', 'media')));

app.use((req, res, next) => {
  res.locals.appName = config.app.name;
  res.locals.appUrl = config.app.url;
  res.locals.appLogo = config.app.logo;
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  res.locals.success = req.session?.success || null;
  res.locals.error = req.session?.error || null;

  if (req.session?.success) delete req.session.success;
  if (req.session?.error) delete req.session.error;

  next();
});

app.use(optionalAuth);

app.use(globalRateLimiter);

app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.token = req.token || req.session?.token || null;
  res.locals.isAuthenticated = !!req.user;
  res.locals.isAdmin = req.user && ['super_admin', 'admin'].includes(req.user.role);
  res.locals.isSuperAdmin = req.user?.role === 'super_admin';
  next();
});

app.use(routes);

app.use((req, res) => {
  res.status(404).render('errors/404', {
    title: '404 - Page Not Found',
    message: 'The page you are looking for does not exist.',
  });
});

app.use((err, req, res, _next) => {
  logger.error('Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).render('errors/500', {
    title: '500 - Server Error',
    message: config.env === 'production' ? 'An unexpected error occurred' : err.message,
  });
});

export default app;

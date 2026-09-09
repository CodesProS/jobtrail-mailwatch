// src/middleware/errorHandler.js — global error handler

import env from '../config/env.js';

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error('[ERROR]', err.stack || err.message);
  const status = err.status || err.statusCode || 500;
  const body = { error: status < 500 ? err.message : 'Internal server error' };
  if (env.NODE_ENV !== 'production') body.stack = err.stack;
  res.status(status).json(body);
}

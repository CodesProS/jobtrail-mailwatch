// src/config/env.js — environment config with validation

const required = (key) => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

const optional = (key, defaultVal = '') => process.env[key] || defaultVal;

const env = {
  NODE_ENV:      optional('NODE_ENV', 'development'),
  PORT:          parseInt(optional('PORT', '3000'), 10),
  PUBLIC_URL:    optional('PUBLIC_URL', 'http://localhost:3000').replace(/\/$/, ''),

  DATABASE_URL:  required('DATABASE_URL'),
  ENC_KEY:       required('ENC_KEY'),

  GROQ_API_KEY:  required('GROQ_API_KEY'),
  GROQ_MODEL:    optional('GROQ_MODEL', 'openai/gpt-oss-20b'),

  GOOGLE_CLIENT_ID:     required('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: required('GOOGLE_CLIENT_SECRET'),

  JOBTRAIL_API_URL: required('JOBTRAIL_API_URL').replace(/\/$/, ''),

  SYNC_SECRET:   required('SYNC_SECRET'),
  REVIEW_KEY:    required('REVIEW_KEY'),

  GMAIL_QUERY:   optional('GMAIL_QUERY', 'newer_than:3d -in:chats -category:promotions'),
};

env.GOOGLE_REDIRECT_URI = `${env.PUBLIC_URL}/oauth/callback`;

export default env;

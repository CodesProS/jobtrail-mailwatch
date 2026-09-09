// src/routes/oauth.js — Gmail connect flow

import { Router } from 'express';
import crypto from 'crypto';
import env from '../config/env.js';
import configRepo from '../repositories/configRepo.js';
import { encrypt } from '../lib/crypto.js';
import { consentUrl, exchangeCode, accessTokenFromRefresh, getProfile } from '../services/gmail.js';

const router = Router();

function sign(value) {
  return crypto.createHmac('sha256', env.REVIEW_KEY).update(value).digest('hex');
}

// GET /oauth/start?key=REVIEW_KEY  -> redirect to Google consent
router.get('/start', (req, res) => {
  if (req.query.key !== env.REVIEW_KEY) {
    return res.status(401).send('Add ?key=REVIEW_KEY to this URL.');
  }
  const nonce = crypto.randomBytes(8).toString('hex');
  const state = `${nonce}.${sign(nonce)}`;
  res.redirect(consentUrl(state));
});

// GET /oauth/callback  -> exchange code, store refresh token
router.get('/callback', async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send(`Google returned: ${error}`);
    if (!code || !state) return res.status(400).send('Missing code/state.');

    const [nonce, sig] = String(state).split('.');
    if (!nonce || sig !== sign(nonce)) return res.status(400).send('Bad state signature.');

    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      return res
        .status(400)
        .send('Google did not return a refresh token. Remove this app at https://myaccount.google.com/permissions and try /oauth/start again.');
    }

    const access = await accessTokenFromRefresh(tokens.refresh_token);
    const profile = await getProfile(access);

    await configRepo.update({
      gmail_email: profile.emailAddress,
      gmail_refresh_token_enc: encrypt(tokens.refresh_token),
      gmail_connected_at: new Date().toISOString(),
    });

    res
      .status(200)
      .send(`<p>Gmail connected as <b>${profile.emailAddress}</b>. You can close this tab.</p><p><a href="/review?key=${env.REVIEW_KEY}">Open review queue</a></p>`);
  } catch (err) {
    next(err);
  }
});

export default router;

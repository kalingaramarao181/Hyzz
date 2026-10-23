import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createVercelHandler } from '../src/vercel-handler.js';

test('Vercel missing configuration returns a controlled 503 with no secret leakage', async () => {
  const handler = createVercelHandler(() => { throw new Error('secret-value-must-not-leak'); });
  const result = await request(handler).get('/health');
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'SERVER_SETUP_REQUIRED');
  assert.ok(result.body.request_id);
  assert.equal(JSON.stringify(result.body).includes('secret-value'), false);
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('Vercel reuses its initialized app and preserves the original API path', async () => {
  let starts = 0;
  const handler = createVercelHandler(() => {
    starts++;
    return (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ path: req.url })); };
  });
  assert.equal((await request(handler).get('/health')).body.path, '/health');
  assert.equal((await request(handler).post('/api/v1/actions/my_profile')).body.path, '/api/v1/actions/my_profile');
  assert.equal(starts, 1);
});

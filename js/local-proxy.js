#!/usr/bin/env node
// ---------------------------------------------------------------------------
// local-proxy.js — tiny CORS bridge for local AI servers (no dependencies).
// Browsers refuse to read answers from a local server unless it sends CORS
// headers. This forwards every request to your server and adds those headers.
//
//   node local-proxy.js                       -> forwards to http://127.0.0.1:31415, listens on 31416
//   node local-proxy.js http://127.0.0.1:31415 31416
//
// Then in the app use:  http://127.0.0.1:31416   (same API key, model ID blank)
// ---------------------------------------------------------------------------
const http = require('http'), https = require('https'), { URL } = require('url');
const target = new URL(process.argv[2] || process.env.TARGET || 'http://127.0.0.1:31415');
const port = Number(process.argv[3] || process.env.PORT || 31416);
const prefix = target.pathname.replace(/\/+$/, '');

http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
    'Access-Control-Allow-Private-Network': 'true',   // https page -> local server (Chrome "Local Network Access")
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const headers = Object.assign({}, req.headers, { host: target.host });
  delete headers.origin; delete headers.referer;
  const lib = target.protocol === 'https:' ? https : http;
  const up = lib.request({
    hostname: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: prefix + req.url, method: req.method, headers
  }, pr => {
    const h = {};
    Object.keys(pr.headers).forEach(k => { if (!/^access-control-/i.test(k)) h[k] = pr.headers[k]; });
    res.writeHead(pr.statusCode, Object.assign(h, cors));
    pr.pipe(res);                                       // streams (SSE) pass straight through
  });
  up.on('error', e => {
    res.writeHead(502, Object.assign({ 'Content-Type': 'application/json' }, cors));
    res.end(JSON.stringify({ error: { message: 'Proxy could not reach ' + target.origin + ': ' + e.message } }));
  });
  req.pipe(up);
}).listen(port, '127.0.0.1', () => console.log(`CORS proxy ready: http://127.0.0.1:${port}  ->  ${target.origin}${prefix}`));

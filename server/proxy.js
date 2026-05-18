// server/proxy.js - Live Earning Proxy Server
const http = require('http');
const httpProxy = require('http-proxy');
const url = require('url');

// প্রতি 1MB = $0.0005 (প্রতি GB = $0.50)
const RATE_PER_MB = 0.0005; // $0.0005 per MB
const RATE_PER_GB = 0.50;   // $0.50 per GB

// ইউজার সেশন ম্যানেজ (মেমরিতে)
const userSessions = {};

const proxy = httpProxy.createProxyServer({});

// ট্রাফিক কাউন্ট করার জন্য মিডলওয়্যার
const server = http.createServer((req, res) => {
  const token = req.headers['x-auth-token'];
  const userId = req.headers['x-user-id'];
  
  let bytesTransferred = 0;
  
  // আউটগোয়িং ডাটা কাউন্ট
  const originalWrite = res.write;
  res.write = function(chunk) {
    if (chunk) bytesTransferred += chunk.length;
    return originalWrite.apply(this, arguments);
  };
  
  const originalEnd = res.end;
  res.end = function(chunk) {
    if (chunk) bytesTransferred += chunk.length;
    
    // কানেকশন শেষে ব্যালেন্স আপডেট
    if (userId && bytesTransferred > 0) {
      const mbTransferred = bytesTransferred / (1024 * 1024);
      const earnAmount = mbTransferred * RATE_PER_MB;
      
      // ডাটাবেজ আপডেট (সিম্পল SQL)
      const gbTransferred = mbTransferred / 1024;
      
      console.log(`[PROXY] User ${userId}: ${mbTransferred.toFixed(2)}MB transferred, earning $${earnAmount.toFixed(4)}`);
      
      // প্রতি ১০ সেকেন্ডে ব্যাচ আপডেট
      if (!userSessions[userId]) userSessions[userId] = { data_gb: 0, earnings: 0 };
      userSessions[userId].data_gb += gbTransferred;
      userSessions[userId].earnings += earnAmount;
    }
    
    return originalEnd.apply(this, arguments);
  };
  
  // প্রক্সি টার্গেট (যেকোনো ওয়েবসাইট)
  const targetUrl = req.headers['x-target-url'] || 'http://httpbin.org/get';
  const target = url.parse(targetUrl);
  
  req.headers.host = target.host;
  
  proxy.web(req, res, {
    target: targetUrl,
    changeOrigin: true,
    selfHandleResponse: false
  }, (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Proxy Error');
  });
});

// প্রতি ১০ সেকেন্ডে ডাটাবেজ আপডেট
setInterval(() => {
  for (const [userId, data] of Object.entries(userSessions)) {
    if (data.data_gb > 0) {
      // এখানে তোমার SQLite আপডেট হবে
      console.log(`[BATCH] User ${userId}: ${data.data_gb.toFixed(4)}GB, $${data.earnings.toFixed(4)}`);
      
      // বর্তমান ডাটাবেজে লেখা
      const db = require('./index').db; // অথবা আলাদা ডাটাবেজ
      // db.run('UPDATE users SET total_data_gb=total_data_gb+?, earnings=earnings+?, wallet_balance=wallet_balance+? WHERE id=?',
      //   [data.data_gb, data.earnings, data.earnings, userId]);
      
      delete userSessions[userId];
    }
  }
}, 10000);

const PROXY_PORT = 3128;
server.listen(PROXY_PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('   LIVE EARNING PROXY SERVER');
  console.log('   Proxy Port: ' + PROXY_PORT);
  console.log('   Rate: $' + RATE_PER_GB + '/GB');
  console.log('========================================');
  console.log('');
});

module.exports = { server, PROXY_PORT };
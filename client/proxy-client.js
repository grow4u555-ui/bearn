// client/proxy-client.js
const http = require('http');

const PROXY_HOST = 'your-server-ip';
const PROXY_PORT = 3128;
const AUTH_TOKEN = 'user-jwt-token';
const USER_ID = 'user-id';

// প্রতি ৩০ সেকেন্ডে একটি টেস্ট রিকোয়েস্ট
setInterval(() => {
  const options = {
    hostname: PROXY_HOST,
    port: PROXY_PORT,
    path: '/',
    method: 'GET',
    headers: {
      'x-auth-token': AUTH_TOKEN,
      'x-user-id': USER_ID,
      'x-target-url': 'https://httpbin.org/bytes/1024' // 1KB ডাটা
    }
  };
  
  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log(`Transferred: ${(data.length / 1024).toFixed(2)}KB`);
    });
  });
  
  req.end();
}, 30000);
const http = require('http');
http.createServer((req, res) => {
  res.end('Hello from Node!');
}).listen(3000, '0.0.0.0', () => {
  console.log('Test server running on 0.0.0.0:3000');
});
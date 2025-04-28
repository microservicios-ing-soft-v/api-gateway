const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 8090;

app.use(morgan('combined'));
app.use(express.json());

app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.status(200).json({ status: 'UP' });
});

function writeBody(proxyReq, req) {
    if (req.body) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
        console.log(`Forwarded body for ${req.method} ${req.path}`);
    }
}

app.use('/auth', createProxyMiddleware({
  target: process.env.AUTH_API_ADDRESS || 'http://auth-api:8000',
  changeOrigin: true,
  pathRewrite: { '^/auth': '/' },
  onProxyReq: (proxyReq, req, res) => {
    console.log(`Proxying /auth request to ${proxyReq.getHeader('host')}${proxyReq.path}`);
    writeBody(proxyReq, req);
  },
  onError: (err, req, res) => {
    console.error('Auth proxy error:', err.message, err.stack);
    if (!res.headersSent) {
       res.status(500).json({ error: 'Auth proxy error', details: err.message });
    }
  }
}));


app.use((req, res, next) => {
  console.log(`Checking authentication for: ${req.method} ${req.path}`);
  const authHeader = req.headers.authorization;
  console.log(`Authorization Header: ${authHeader}`);

  if (authHeader) {
    console.log('Authorization header found. Proceeding.');
    return next();
  }

  console.log('Unauthorized request blocked: Missing Authorization header');
  res.status(401).json({ error: 'Unauthorized: Missing Authorization header' });
});


app.use('/todos', createProxyMiddleware({
  target: process.env.TODOS_API_ADDRESS || 'http://todos-api:8082',
  changeOrigin: true,
  pathRewrite: { '^/todos': '/' },
  onProxyReq: (proxyReq, req, res) => {
     console.log(`Proxying /todos request to ${proxyReq.getHeader('host')}${proxyReq.path}`);
     writeBody(proxyReq, req);
  },
  onError: (err, req, res) => {
    console.error('Todos proxy error:', err.message, err.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Todos proxy error', details: err.message });
    }
  }
}));


 app.use((req, res) => {
     console.warn(`Route not found: ${req.method} ${req.path}`);
      // Check if headers have already been sent
     if (!res.headersSent) {
         res.status(404).json({ error: 'Not Found' });
     }
 });


app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});

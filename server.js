const express = require('express');
  const { createProxyMiddleware } = require('http-proxy-middleware');
  const morgan = require('morgan');

  const app = express();
  const PORT = process.env.PORT || 8090;

  // Logging middleware
  app.use(morgan('combined'));
  app.use(express.json()); // <-- express.json() parses the body

  // Health check endpoint (does not require auth)
  app.get('/health', (req, res) => {
    console.log('Health check requested');
    res.status(200).json({ status: 'UP' });
  });

  // Helper function to write body to proxy request
  function writeBody(proxyReq, req) {
      if (req.body) {
          const bodyData = JSON.stringify(req.body);
          // In case if content-type is application/x-www-form-urlencoded -> we need to change it to application/json
          proxyReq.setHeader('Content-Type', 'application/json');
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          // stream the content
          proxyReq.write(bodyData);
          console.log(`Forwarded body for ${req.method} ${req.path}`);
      }
  }


  // Auth API proxy (does not require auth for its own endpoints like /login)
  app.use('/auth', createProxyMiddleware({
    target: process.env.AUTH_API_ADDRESS || 'http://auth-api:8000',
    changeOrigin: true,
    pathRewrite: { '^/auth': '/' }, // Remove /auth prefix when forwarding to auth-api
    onProxyReq: (proxyReq, req, res) => {
      console.log(`Proxying /auth request to ${proxyReq.getHeader('host')}${proxyReq.path}`);
      writeBody(proxyReq, req); // <-- Explicitly write body for /auth requests
    },
    onError: (err, req, res) => {
      console.error('Auth proxy error:', err.message, err.stack); // Log stack for better debugging
      // Check if headers have already been sent
      if (!res.headersSent) {
         res.status(500).json({ error: 'Auth proxy error', details: err.message });
      }
    }
  }));

  // --- Authentication Middleware (Applied only to routes defined AFTER this) ---
  // This middleware checks for the presence of the Authorization header
  app.use((req, res, next) => {
    console.log(`Checking authentication for: ${req.method} ${req.path}`);
    const authHeader = req.headers.authorization;
    console.log(`Authorization Header: ${authHeader}`);

    if (authHeader) {
      console.log('Authorization header found. Proceeding.');
      // IMPORTANT: You might want to add JWT validation here in a real scenario
      // For this fix, we are only checking for header presence as per original logic
      return next();
    }

    // If we reach here, no Authorization header was found for a protected route
    console.log('Unauthorized request blocked: Missing Authorization header');
    res.status(401).json({ error: 'Unauthorized: Missing Authorization header' });
  });
  // ------------------------------------------------------------------------


  // Todos API proxy (REQUIRES auth, so it's placed AFTER the auth middleware)
  app.use('/todos', createProxyMiddleware({
    target: process.env.TODOS_API_ADDRESS || 'http://todos-api:8082',
    changeOrigin: true,
    pathRewrite: { '^/todos': '/' },
    onProxyReq: (proxyReq, req, res) => {
       console.log(`Proxying /todos request to ${proxyReq.getHeader('host')}${proxyReq.path}`);
       writeBody(proxyReq, req); // <-- Explicitly write body for /todos requests
    },
    onError: (err, req, res) => {
      console.error('Todos proxy error:', err.message, err.stack); // Log stack for better debugging
       // Check if headers have already been sent
      if (!res.headersSent) {
        res.status(500).json({ error: 'Todos proxy error', details: err.message });
      }
    }
  }));

  // Note: There is NO proxy for /users, as it's accessed directly by auth-api.
  // Any request to /users reaching the gateway at this point will be blocked
  // by the authentication middleware if it doesn't have a token, or simply
  // fall through and result in a 404 Not Found if it had a token but no
  // matching route is found after the auth middleware. This is consistent
  // with the intended architecture.

  // Catch-all for undefined routes that passed auth (or didn't need it but didn't match)
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
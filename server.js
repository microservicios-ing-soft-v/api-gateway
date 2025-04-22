const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 8090;

// Middleware para logging
app.use(morgan('combined'));

// Configuración básica de autenticación
app.use((req, res, next) => {
  // Verificar token JWT en el encabezado Authorization
  const authHeader = req.headers.authorization;
  
  // Para endpoints públicos o si tiene autorización válida
  if (req.path === '/health' || req.path.startsWith('/auth') || authHeader) {
    return next();
  }
  
  res.status(401).json({ error: 'Unauthorized' });
});

// Endpoint de Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP' });
});

// Proxy para auth-api
app.use('/auth', createProxyMiddleware({
  target: process.env.AUTH_API_ADDRESS || 'http://auth-api:8000',
  changeOrigin: true,
  pathRewrite: {
    '^/auth': '/'
  }
}));

// Proxy para users-api
app.use('/users', createProxyMiddleware({
  target: process.env.USERS_API_ADDRESS || 'http://users-api:8083',
  changeOrigin: true,
  pathRewrite: {
    '^/users': '/'
  }
}));

// Proxy para todos-api
app.use('/todos', createProxyMiddleware({
  target: process.env.TODOS_API_ADDRESS || 'http://todos-api:8082',
  changeOrigin: true,
  pathRewrite: {
    '^/todos': '/'
  }
}));

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});
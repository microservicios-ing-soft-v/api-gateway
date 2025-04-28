const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const morgan = require('morgan');
const axios = require('axios');
const CircuitBreaker = require('opossum');

const app = express();
const PORT = process.env.PORT || 8090;

app.use(morgan('combined'));
app.use(express.json());

const circuitOptions = {
  failureThreshold: 5,
  rollingCountTimeout: 30000,
  resetTimeout: 20000,
  timeout: 3000,
  rollingCountBuckets: 10
};

const authCircuitBreaker = new CircuitBreaker(async (config) => {
  return await axios(config);
}, circuitOptions);

const todosCircuitBreaker = new CircuitBreaker(async (config) => {
  return await axios(config);
}, circuitOptions);

[authCircuitBreaker, todosCircuitBreaker].forEach((breaker, index) => {
  const serviceName = index === 0 ? 'Auth' : 'Todos';
  
  breaker.on('open', () => console.warn(`${serviceName} Circuit Breaker: ABIERTO - Demasiados fallos detectados`));
  breaker.on('close', () => console.log(`${serviceName} Circuit Breaker: CERRADO - Servicio operando normalmente`));
  breaker.on('halfOpen', () => console.log(`${serviceName} Circuit Breaker: SEMI-ABIERTO - Probando reconexión`));
  breaker.on('fallback', () => console.log(`${serviceName} Circuit Breaker: FALLBACK ejecutado`));
});

app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.status(200).json({ 
    status: 'UP',
    circuitBreakers: {
      auth: authCircuitBreaker.status,
      todos: todosCircuitBreaker.status
    }
  });
});

async function retryRequest(circuitBreaker, config, maxRetries = 2, retryDelay = 5000) {
  let retries = 0;
  let lastError = null;

  while (retries <= maxRetries) {
    try {
      if (retries > 0) {
        console.log(`Reintento #${retries} para ${config.method} ${config.url}`);
      }
      
      const response = await circuitBreaker.fire(config);
      return response;
    } catch (error) {
      lastError = error;
      console.error(`Error en intento #${retries + 1}: ${error.message}`);
      
      if (retries < maxRetries) {
        console.log(`Esperando ${retryDelay}ms antes del próximo reintento...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
      retries++;
    }
  }
  
  throw lastError;
}

function writeBody(proxyReq, req) {
  if (req.body) {
    const bodyData = JSON.stringify(req.body);
    proxyReq.setHeader('Content-Type', 'application/json');
    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
    proxyReq.write(bodyData);
    console.log(`Forwarded body for ${req.method} ${req.path}`);
  }
}

app.use('/auth', async (req, res, next) => {
  const authApiUrl = process.env.AUTH_API_ADDRESS || 'http://auth-api:8000';
  const targetPath = req.path.replace(/^\/auth/, '/');
  const fullUrl = `${authApiUrl}${targetPath}`;
  
  const requestConfig = {
    method: req.method,
    url: fullUrl,
    headers: {
      ...req.headers,
      host: new URL(authApiUrl).host
    },
    data: req.body,
    validateStatus: null
  };
  
  console.log(`Proxying /auth request to ${authApiUrl}${targetPath}`);
  
  try {
    const response = await retryRequest(authCircuitBreaker, requestConfig);
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error('Auth proxy error after retries:', error.message);
    
    if (authCircuitBreaker.status === 'open') {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Auth service is temporarily unavailable, please try again later',
        circuitStatus: 'open'
      });
    }
    
    if (!res.headersSent) {
      res.status(500).json({ error: 'Auth proxy error', details: error.message });
    }
  }
});

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

app.use('/todos', async (req, res, next) => {
  const todosApiUrl = process.env.TODOS_API_ADDRESS || 'http://todos-api:8082';
  const targetPath = req.path.replace(/^\/todos(\/todos)?/, '/');
  const fullUrl = `${todosApiUrl}${targetPath}`;
  
  const requestConfig = {
    method: req.method,
    url: fullUrl,
    headers: {
      ...req.headers,
      host: new URL(todosApiUrl).host
    },
    data: req.body,
    validateStatus: null
  };
  
  console.log(`Proxying /todos request to ${todosApiUrl}${targetPath}`);
  
  try {
    const response = await retryRequest(todosCircuitBreaker, requestConfig);
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error('Todos proxy error after retries:', error.message);
    
    if (todosCircuitBreaker.status === 'open') {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Todos service is temporarily unavailable, please try again later',
        circuitStatus: 'open'
      });
    }
    
    if (!res.headersSent) {
      res.status(500).json({ error: 'Todos proxy error', details: error.message });
    }
  }
});

app.use((req, res) => {
  console.warn(`Route not found: ${req.method} ${req.path}`);
  if (!res.headersSent) {
    res.status(404).json({ error: 'Not Found' });
  }
});

app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
  console.log(`Circuit breaker and retry pattern enabled`);
});

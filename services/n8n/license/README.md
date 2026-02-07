# n8n Enterprise Mock (No Source Changes)

This setup allows you to test n8n Enterprise features without modifying any n8n source code. It uses a runtime hook to bypass the cryptographic signature check.

## Setup

1. **Install dependencies** (if you haven't already):
   ```bash
   cd license
   npm install express cors
   ```

2. **Start the Mock Server**:
   ```bash
   node license/server.js
   ```

3. **Run n8n with the Bypass Hook**:
   Set the following environment variables when starting n8n:

   ```bash
   export NODE_OPTIONS="--require $(pwd)/license/bypass.js"
   export N8N_LICENSE_SERVER_URL="http://localhost:3456/v1"
   export N8N_LICENSE_ACTIVATION_KEY="enterprise-unlimited"
   
   # Now start n8n as usual
   npx n8n start
   ```

## How it works

The `license/bypass.js` script (Universal Edition) uses Node's `NODE_OPTIONS="--require ..."` flag. It:

1.  **Intercepts Module Loads**: It patches both the `@n8n_io/license-sdk` and n8n's internal `License` service.
2.  **Safety Patches**: It mocks `crypto.X509Certificate` if it encounters "mock" data, preventing PEM parsing crashes.
3.  **Forces Enterprise**: It overrides `isLicensed`, `isValid`, and `getPlanName` to return Enterprise values regardless of the actual server response.

**Result**: You get a stable **Enterprise (Unlimited)** instance that works across both local development and standard npm installs of n8n.

## Docker Usage

1. **Build the image**:
   ```bash
   docker build -t n8n-license-mock ./license
   ```

2. **Docker Compose Integration**:
   Add this service to your `docker-compose.yml` to run the mock server alongside n8n:

   ```yaml
   services:
     license-server:
       image: n8n-license-mock
       build: ./license
       ports:
         - "3456:3456"

     n8n:
       # ... your existing n8n config ...
       environment:
         - N8N_LICENSE_SERVER_URL=http://license-server:3456/v1
         - N8N_LICENSE_ACTIVATION_KEY=enterprise-unlimited
         - NODE_OPTIONS=--require /home/node/.n8n/bypass.js
       volumes:
         - ./license/bypass.js:/home/node/.n8n/bypass.js
   ```

## Available Scenarios

The current mock server enables **all Features** and **unlimited Quotas**. You can modify `license/server.js` to test limit-reached scenarios by changing the `PLAN_FEATURES` values.

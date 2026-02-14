/**
 * Mock License Server for n8n
 * 
 * Works in tandem with license/bypass.js to enable Enterprise features
 * WITHOUT changing any n8n source code.
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3456;

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

const PLAN_FEATURES = {
    'enterprise-unlimited': {
        'feat:enterprise': true,
        'feat:showNonProdBanner': false,
        'feat:apiDisabled': false,
        'feat:sharing': true,
        'feat:ldap': true,
        'feat:saml': true,
        'feat:oidc': true,
        'feat:mfaEnforcement': true,
        'feat:logStreaming': true,
        'feat:advancedExecutionFilters': true,
        'feat:variables': true,
        'feat:sourceControl': true,
        'feat:externalSecrets': true,
        'feat:debugInEditor': true,
        'feat:binaryDataS3': true,
        'feat:multipleMainInstances': true,
        'feat:workerView': true,
        'feat:advancedPermissions': true,
        'feat:aiAssistant': true,
        'feat:askAi': true,
        'feat:folders': true,
        'feat:apiKeyScopes': true,
        'feat:workflowDiffs': true,
        'feat:customRoles': true,
        'feat:aiBuilder': true,
        'feat:dynamicCredentials': true,
        'planName': 'Enterprise (Unlimited)',
        'quota:activeWorkflows': -1,
        'quota:maxVariables': -1,
        'quota:users': -1,
        'quota:workflowHistoryPrune': -1,
        'quota:maxTeamProjects': -1,
    }
};

function generateMockLicense(planKey, consumerId, tenantId) {
    const plan = PLAN_FEATURES[planKey] || PLAN_FEATURES['enterprise-unlimited'];
    const now = new Date();
    const start = new Date(now.getTime() - 3600000); // 1 hour ago
    const expires = new Date(now);
    expires.setFullYear(expires.getFullYear() + 1);

    // Use the plan name from features or default to Enterprise
    const planName = plan.planName || 'Enterprise';

    return {
        iss: 'mock-license-server',
        sub: consumerId,
        consumerId,
        version: 1,
        tenantId: tenantId || 1,
        renewalToken: 'mock-renewal-token',
        deviceLock: false,
        deviceFingerprint: 'any',
        createdAt: start.toISOString(),
        issuedAt: start.toISOString(),
        expiresAt: expires.toISOString(),
        terminatesAt: expires.toISOString(),
        managementJwt: 'mock-jwt',
        isEphemeral: false,
        detachedEntitlementsCount: 0,
        entitlements: [
            {
                id: crypto.randomUUID(),
                productId: 'enterprise-plan',
                productMetadata: { terms: { isMainPlan: true } },
                features: plan,
                featureOverrides: {},
                validFrom: start.toISOString(),
                validTo: expires.toISOString(),
                isFloatable: false
            }
        ]
    };
}

// Convert the license object to the format expected by the bypass hook
function wrapLicense(license) {
    const container = {
        licenseKey: JSON.stringify(license),
        x509: 'mock-x509-cert' // Not used by bypass hook but keeps format
    };
    return Buffer.from(JSON.stringify(container)).toString('base64');
}

app.get('/healthz', (req, res) => res.send('ok'));

app.post('/v1/activate', (req, res) => {
    const { reservationId, deviceFingerprint } = req.body;
    console.log(`Request body: ${JSON.stringify(req.body)}`)
    const license = generateMockLicense(reservationId, deviceFingerprint || 'dev');
    console.log(`  Generated license for: ${reservationId}`);

    // SDK expects licenseKey and x509 directly in response (not wrapped in cert)
    res.json({
        licenseKey: JSON.stringify(license),
        x509: 'mock-x509-cert',
        consumerId: license.consumerId
    });
});

app.post('/v1/renew', (req, res) => {
    const { deviceFingerprint } = req.body;
    console.log(`  Renewing license`);
    const license = generateMockLicense('enterprise-unlimited', deviceFingerprint || 'dev');

    // SDK expects licenseKey and x509 directly
    res.json({
        licenseKey: JSON.stringify(license),
        x509: 'mock-x509-cert',
        consumerId: license.consumerId
    });
});

app.listen(PORT, () => {
    console.log(`
Mock License Server running at http://localhost:${PORT}

To enable Enterprise WITHOUT changing n8n code, run n8n like this:

NODE_OPTIONS="--require /license/bypass.js" \\
N8N_LICENSE_SERVER_URL=http://license-server:${PORT}/v1 \\
N8N_LICENSE_ACTIVATION_KEY=enterprise-unlimited \\

Then start/restart n8n
  `);
});

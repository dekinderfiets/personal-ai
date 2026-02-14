/**
 * n8n License Bypass Hook - Universal Edition (v3)
 * 
 * Intercepts both the License SDK and n8n's internal License service
 * to force Enterprise features regardless of the module system (CJS/ESM).
 */

const Module = require('module');
const crypto = require('crypto');
const originalLoad = Module._load;

// 0. Safety Net: Patch X509Certificate to handle mock certs without crashing
if (crypto.X509Certificate) {
    const OriginalX509 = crypto.X509Certificate;
    crypto.X509Certificate = function (data) {
        if (typeof data === 'string' && data.includes('mock')) {
            return {
                subject: 'CN=n8n-mock',
                issuer: 'CN=n8n-mock',
                validFrom: new Date().toISOString(),
                validTo: new Date(Date.now() + 1000000000).toISOString(),
                fingerprint: 'mock',
                checkIssued: () => true,
                verify: () => true,
                publicKey: { export: () => 'mock-key' }
            };
        }
        try {
            return new OriginalX509(data);
        } catch (e) {
            if (typeof data === 'string' && data.includes('mock')) return {
                checkIssued: () => true,
                verify: () => true,
                publicKey: { export: () => 'mock-key' }
            };
            throw e;
        }
    };
    Object.setPrototypeOf(crypto.X509Certificate, OriginalX509);
    crypto.X509Certificate.prototype = OriginalX509.prototype;
}

// The "God Mode" Plan
const MOCK_PLAN = {
    'planName': 'Enterprise (Unlimited)',
    'feat:showNonProdBanner': false,
    'feat:apiDisabled': false,
    'feat:enterprise': true,
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
    'quota:activeWorkflows': -1,
    'quota:maxVariables': -1,
    'quota:users': -1,
    'quota:workflowHistoryPrune': -1,
    'quota:maxTeamProjects': -1,
};

function patchClass(target, name) {
    if (!target || !target.prototype) return;
    if (target.__n8n_patched) return;
    target.__n8n_patched = true;

    console.log('\x1b[33m%s\x1b[0m', `[License Bypass] Patching ${name} class...`);

    // 1. Force isLicensed / hasFeatureEnabled
    const isLicensedMethod = target.prototype.isLicensed ? 'isLicensed' : 'hasFeatureEnabled';
    target.prototype[isLicensedMethod] = function (feature) {
        if (MOCK_PLAN[feature] !== undefined) return MOCK_PLAN[feature];
        if (typeof feature === 'string' && feature.startsWith('feat:')) return true;
        return true;
    };

    // 2. Force getPlanName
    target.prototype.getPlanName = function () {
        return MOCK_PLAN.planName;
    };

    // 3. Force getValue / getFeatureValue
    const getValueMethod = target.prototype.getValue ? 'getValue' : 'getFeatureValue';
    const originalGetValue = target.prototype[getValueMethod];
    target.prototype[getValueMethod] = function (feature) {
        if (MOCK_PLAN[feature] !== undefined) return MOCK_PLAN[feature];
        if (feature === 'planName') return MOCK_PLAN.planName;
        // If we have an original method and it's not us (recursion safety), call it
        if (originalGetValue && originalGetValue !== target.prototype[getValueMethod]) {
            try { return originalGetValue.apply(this, arguments); } catch (e) { return -1; }
        }
        return -1;
    };

    // 4. Force isValid to always return true
    target.prototype.isValid = function () {
        return true;
    };

    // 5. Force getMainPlan
    if (target.prototype.getMainPlan) {
        target.prototype.getMainPlan = function () {
            return {
                id: 'mock-entitlement-id',
                productId: 'enterprise-plan',
                productMetadata: { terms: { isMainPlan: true } },
                features: MOCK_PLAN,
                featureOverrides: {},
                validFrom: new Date(Date.now() - 3600000),
                validTo: new Date(Date.now() + 31536000000)
            };
        };
    }

    // 6. Force initialization and activation states
    // We proxy get/set for isInitialized to always be true
    Object.defineProperty(target.prototype, 'isInitialized', {
        get() { return true; },
        set() { },
        configurable: true
    });

    if (target.name === 'LicenseManager' || name.includes('Manager')) {
        target.prototype.initialize = async function () {
            this.licenseCert = {
                iss: 'mock-license-server',
                consumerId: 'mock-consumer',
                entitlements: [],
                terminatesAt: new Date(Date.now() + 31536000000)
            };
            this.initializationPromise = Promise.resolve();
            console.log('\x1b[32m%s\x1b[0m', `[License Bypass] ${name} initialized`);
            return Promise.resolve();
        };

        // Bypass activation checks
        const originalActivate = target.prototype.activate;
        target.prototype.activate = async function () {
            console.log('\x1b[32m%s\x1b[0m', `[License Bypass] Intercepting activation call...`);
            try {
                return await originalActivate.apply(this, arguments);
            } catch (e) {
                console.log('\x1b[33m%s\x1b[0m', `[License Bypass] Activation call returned error: ${e.message}. Mocking success anyway.`);
                return Promise.resolve();
            }
        };

        target.prototype.initCert = async function () { return Promise.resolve(); };
        target.prototype.reload = async function () { return Promise.resolve(); };
        target.prototype.renew = async function () { return Promise.resolve(); };
    }
}

// Intercept CJS loads
Module._load = function (request, parent, isMain) {
    const exports = originalLoad.apply(this, arguments);

    try {
        if (request.includes('license-sdk') && exports.LicenseManager) {
            patchClass(exports.LicenseManager, 'LicenseManager');
        } else if (request.includes('/license') && exports.License) {
            patchClass(exports.License, 'License');
        }
    } catch (e) { }

    return exports;
};

// Periodic scan for objects already in memory (stops once both are patched)
const _patchInterval = setInterval(() => {
    try {
        let foundManager = false;
        let foundLicense = false;
        Object.keys(require.cache).forEach(key => {
            const exports = require.cache[key].exports;
            if (exports) {
                if (exports.LicenseManager) {
                    patchClass(exports.LicenseManager, 'LicenseManager (Cache)');
                    foundManager = true;
                }
                if (exports.License) {
                    patchClass(exports.License, 'License (Cache)');
                    foundLicense = true;
                }
            }
        });
        if (foundManager && foundLicense) {
            clearInterval(_patchInterval);
            console.log('\x1b[32m%s\x1b[0m', '[License Bypass] Both classes patched, cache scan stopped.');
        }
    } catch (e) { }
}, 2000);

console.log('\x1b[36m%s\x1b[0m', '[License Bypass] Universal Hook v3 Active.');

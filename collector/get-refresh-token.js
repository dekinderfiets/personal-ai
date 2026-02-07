#!/usr/bin/env node
/**
 * Google OAuth2 Refresh Token Generator
 * 
 * Usage:
 *   node get-refresh-token.js <client_id> <client_secret>
 * 
 * This will open a browser for you to authorize, then print the refresh token.
 */

const http = require('http');
const { URL } = require('url');
const { exec } = require('child_process');

const CLIENT_ID = process.argv[2];
const CLIENT_SECRET = process.argv[3];
const REDIRECT_URI = 'http://localhost:3333/callback';
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/documents.readonly',
    'https://www.googleapis.com/auth/calendar.acls.readonly',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.calendars.readonly',
    'https://www.googleapis.com/auth/calendar.events.owned.readonly',
    'https://www.googleapis.com/auth/calendar.events.public.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
].join(' ');

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Usage: node get-refresh-token.js <client_id> <client_secret>');
    process.exit(1);
}

// Step 1: Start local server to receive callback
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:3333');

    if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');

        if (!code) {
            res.writeHead(400);
            res.end('No authorization code received');
            return;
        }

        // Step 3: Exchange code for tokens
        try {
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    code: code,
                    grant_type: 'authorization_code',
                    redirect_uri: REDIRECT_URI,
                }),
            });

            const tokens = await tokenResponse.json();

            if (tokens.refresh_token) {
                console.log('\n✅ Success! Add this to your index/.env:\n');
                console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>Success!</h1><p>You can close this window. Check your terminal for the refresh token.</p>');
            } else {
                console.error('Error:', tokens);
                res.writeHead(500);
                res.end('Failed to get refresh token: ' + JSON.stringify(tokens));
            }
        } catch (err) {
            console.error('Error exchanging code:', err);
            res.writeHead(500);
            res.end('Error: ' + err.message);
        }

        setTimeout(() => process.exit(0), 1000);
    }
});

server.listen(3333, () => {
    // Step 2: Open browser for authorization
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(SCOPES)}` +
        `&access_type=offline` +
        `&prompt=consent`;

    console.log('Opening browser for authorization...');
    console.log('If browser does not open, visit:\n', authUrl);

    // Open browser (macOS)
    exec(`open "${authUrl}"`);
});

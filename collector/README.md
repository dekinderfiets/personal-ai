# Indexing Service

The Indexing Service is responsible for fetching data from various sources (Jira, Slack, Gmail, Google Drive, Confluence, Calendar) and indexing it into Elasticsearch for search and AI retrieval.

## Setup

1. **Environment Variables**:
   Copy `.env.example` to `.env` and fill in the required credentials.
   ```bash
   cp .env.example .env
   ```

2. **Google OAuth2 Setup**:
   1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
   2. Create an OAuth 2.0 Client ID (Web application type).
   3. Add to `.env`:
      ```bash
      GOOGLE_CLIENT_ID=your_client_id
      GOOGLE_CLIENT_SECRET=your_client_secret
      GOOGLE_REFRESH_TOKEN=your_refresh_token
      ```
   4. Required Scopes:
      - `https://www.googleapis.com/auth/gmail.readonly`
      - `https://www.googleapis.com/auth/drive.readonly`
      - `https://www.googleapis.com/auth/calendar.readonly`
      - `https://www.googleapis.com/auth/calendar.events.readonly`

3. **Install Dependencies**:
   ```bash
   npm install
   ```

4. **Build the Application**:
   ```bash
   npm run build
   ```

## Running the Service

### Development Mode
```bash
npm run start:dev
```

### Production Mode
```bash
npm run start:prod
```

### Docker
The service is designed to run within the Docker Compose environment of the `n8n` project.
```bash
docker-compose up -d index
```

## API Endpoints

The service runs on port `8087` by default. All endpoints (except health) require an `x-api-key` header if `API_KEY` is configured.

### Trigger Indexing
- **POST** `/index/:source` - Trigger indexing for a specific source (`jira`, `slack`, `gmail`, `drive`, `confluence`, `calendar`).
- **POST** `/index/all` - Trigger indexing for all configured sources.

### Search
- **GET** `/index/search?q=query_text&source=source_name&limit=10` - Perform semantic search across indexed data.

### Status
- **GET** `/index/status` - Get status for all sources.

### Management
- **DELETE** `/index/all/reset` - Reset cursors and status for all sources.
- **GET** `/index/discovery/calendar` - List available calendars.
- **GET** `/index/discovery/drive/folders` - List available root folders.
- **GET** `/index/discovery/jira/projects` - List available Jira projects.
- **GET** `/index/discovery/slack/channels` - List available Slack channels.
- **GET** `/index/discovery/confluence/spaces` - List available Confluence spaces.

### Webhooks
- **POST** `/index/jira/webhook` - Endpoint for Jira webhooks (issue created, updated, or deleted).

#### Setting up Jira Webhook:
1. Go to your Jira Instance → System → Webhooks.
2. Create a new Webhook.
3. URL: `https://your-public-url/api/v1/index/jira/webhook?apiKey=your_api_key`
4. Events:
   - **Issue**: created, updated, deleted.
5. Note: If you don't have a public URL, you can use tools like `ngrok` or `cloudflared` to expose the local service.

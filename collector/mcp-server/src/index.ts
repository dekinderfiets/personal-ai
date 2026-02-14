import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const COLLECTOR_API_URL = process.env.COLLECTOR_API_URL || 'http://localhost:8087/api/v1';
const COLLECTOR_API_KEY = process.env.COLLECTOR_API_KEY || '';

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  ...(COLLECTOR_API_KEY ? { 'x-api-key': COLLECTOR_API_KEY } : {}),
};

async function apiCall(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${COLLECTOR_API_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res.json();
}

const server = new McpServer({
  name: 'collector',
  version: '1.0.0',
});

// --- Read Tools ---

server.tool(
  'search',
  'Search across all indexed sources (Jira, Slack, Gmail, Drive, Confluence, Calendar)',
  {
    query: z.string().describe('Search query text'),
    sources: z.array(z.enum(['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar'])).optional()
      .describe('Filter by specific sources'),
    searchType: z.enum(['vector', 'keyword', 'hybrid']).optional()
      .describe('Search method: vector (semantic), keyword (exact), hybrid (both). Default: hybrid'),
    startDate: z.string().optional().describe('Filter results after this ISO 8601 date'),
    endDate: z.string().optional().describe('Filter results before this ISO 8601 date'),
    limit: z.number().optional().describe('Max results to return (default: 10)'),
  },
  async ({ query, sources, searchType, startDate, endDate, limit }) => {
    const result = await apiCall('POST', '/search', {
      query, sources, searchType, startDate, endDate, limit,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_index_status',
  'Check indexing status of all sources — shows what is indexed and how fresh the data is',
  {},
  async () => {
    const result = await apiCall('GET', '/index/status');
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_document',
  'Fetch a single indexed document by its ID',
  {
    id: z.string().describe('Document ID'),
  },
  async ({ id }) => {
    const result = await apiCall('GET', `/search/documents/${id}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'list_projects',
  'List all discovered projects in the project repository',
  {
    status: z.enum(['active', 'paused', 'completed', 'archived']).optional()
      .describe('Filter by project status'),
  },
  async ({ status }) => {
    const query = status ? `?status=${status}` : '';
    const result = await apiCall('GET', `/projects${query}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_project',
  'Get full details of a specific project',
  {
    projectId: z.string().describe('Project UUID'),
  },
  async ({ projectId }) => {
    const result = await apiCall('GET', `/projects/${projectId}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// --- Write Tools ---

server.tool(
  'propose_new_project',
  'Propose a newly discovered project for user review. Creates one proposal per field.',
  {
    sessionId: z.string().describe('Discovery session ID'),
    title: z.string().describe('Project title'),
    description: z.string().describe('Project description (2-3 sentences)'),
    goals: z.array(z.string()).optional().describe('Key project objectives'),
    status: z.enum(['active', 'paused', 'completed', 'archived']).optional().describe('Project status'),
    participants: z.array(z.object({
      name: z.string(),
      role: z.string().optional(),
      source: z.string().optional(),
    })).optional().describe('People involved'),
    sources: z.array(z.object({
      type: z.string().describe('Source type: jira_project, slack_channel, github_repo, drive_folder, confluence_space'),
      identifier: z.string().describe('Source identifier (e.g., PROJ, #channel-name)'),
      name: z.string().optional(),
    })).optional().describe('Linked source identifiers'),
    tags: z.array(z.string()).optional().describe('Labels/tags'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Additional metadata'),
    reason: z.string().describe('Why you believe this is a distinct project'),
  },
  async (args) => {
    const { sessionId, reason, ...fields } = args;
    const proposals = [];

    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      const proposal = await apiCall('POST', '/projects/proposals', {
        sessionId,
        projectId: null,
        field,
        newValue: value,
        reason,
      });
      proposals.push(proposal);
    }

    return {
      content: [{
        type: 'text' as const,
        text: `Created ${proposals.length} proposals for new project "${args.title}". Awaiting user review.`,
      }],
    };
  },
);

server.tool(
  'propose_project_update',
  'Propose an update to a specific field of an existing project',
  {
    sessionId: z.string().describe('Discovery session ID'),
    projectId: z.string().describe('UUID of the project to update'),
    field: z.string().describe('Field name to update (title, description, goals, status, participants, sources, tags, metadata)'),
    newValue: z.unknown().describe('The proposed new value for the field'),
    reason: z.string().describe('Why this change is being proposed'),
  },
  async ({ sessionId, projectId, field, newValue, reason }) => {
    const project = await apiCall('GET', `/projects/${projectId}`) as Record<string, unknown>;
    const oldValue = project[field] ?? null;

    const proposal = await apiCall('POST', '/projects/proposals', {
      sessionId,
      projectId,
      field,
      oldValue,
      newValue,
      reason,
    });

    return {
      content: [{
        type: 'text' as const,
        text: `Created update proposal for "${field}" on project "${project.title}". Old: ${JSON.stringify(oldValue)}, New: ${JSON.stringify(newValue)}. Awaiting user review.`,
      }],
    };
  },
);

// --- Start Server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);

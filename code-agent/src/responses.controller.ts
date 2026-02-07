
import { Controller, Post, Body, Res, BadRequestException, Header } from '@nestjs/common';
import { Response } from 'express';
import { CursorAgentService } from './services/cursor-agent.service';
import { OpenResponsesRequest, Item, Message, Content, OpenResponsesResponse } from './types/open-responses';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

@Controller('v1')
export class ResponsesController {
    private readonly logger = console;

    constructor(private readonly cursorAgentService: CursorAgentService) { }

    @Post('responses')
    @Header('Content-Type', 'application/json')
    async createResponse(@Body() body: OpenResponsesRequest, @Res() res: Response) {
        const { input, stream = false } = body;

        // Validate input
        if (!input || !Array.isArray(input) || input.length === 0) {
            throw new BadRequestException('Missing required field: input must be a non-empty array');
        }

        // Convert Open Responses items to a prompt string
        const prompt = this.convertItemsToPrompt(input, body.tools);

        this.logger.log(`Open Responses request: itemCount=${input.length}, stream=${stream}`);
        this.logger.log(`Request Body Input: ${JSON.stringify(input, null, 2)}`);

        // Create temporary directory for this request (similar to OpenAI controller)
        // If USE_WORKSPACE_AS_TEMP is set, use WORKSPACE_ROOT directly instead of os.tmpdir()
        const useWorkspaceAsTemp = process.env.USE_WORKSPACE_AS_TEMP === 'true';
        const workspaceRoot = process.env.WORKSPACE_ROOT || '/workspace';
        const tempDir = useWorkspaceAsTemp
            ? workspaceRoot
            : await fs.mkdtemp(path.join(os.tmpdir(), 'responses-agent-'));

        if (stream) {
            await this.handleStreamingResponse(prompt, tempDir, res);
        } else {
            await this.handleNormalResponse(prompt, tempDir, res);
        }
    }

    private async handleNormalResponse(prompt: string, tempDir: string, res: Response) {
        try {
            const result = await this.cursorAgentService.execute(prompt, {
                workspaceRoot: tempDir,
                timeout: 3600000,
                useMCPs: false,
            });

            if (!result.success) {
                throw new BadRequestException(`Agent execution failed: ${result.error}`);
            }

            // Parse output
            const rawOutput = result.rawOutput;
            const parsedOutput = this.cursorAgentService.parseOutput(rawOutput) || rawOutput;

            // Check for tool calls
            const toolCall = this.extractToolCall(parsedOutput);

            let outputItems: Item[];

            if (toolCall) {
                outputItems = [
                    {
                        type: 'function_call',
                        id: `call_${Date.now()}`,
                        name: toolCall.function.name,
                        call_id: `call_${Date.now()}`,
                        arguments: JSON.stringify(toolCall.function.arguments),
                        status: 'completed'
                    }
                ];
            } else {
                outputItems = [
                    {
                        id: `msg_${Date.now()}`,
                        type: 'message',
                        role: 'model',
                        status: 'completed',
                        content: [
                            {
                                type: 'output_text',
                                text: parsedOutput
                            }
                        ]
                    }
                ];
            }

            // Construct Open Responses output
            const response: OpenResponsesResponse = {
                id: `resp_${Date.now()}`,
                object: 'response',
                created_at: Math.floor(Date.now() / 1000),
                completed_at: Math.floor(Date.now() / 1000),
                status: 'completed',
                incomplete_details: null,
                model: 'grok-code-fast-1',
                previous_response_id: '', // Identifying as first or standalone response
                instructions: '',
                output: outputItems,
                tools: [],
                tool_choice: 'auto',
                truncation: 'auto',
                parallel_tool_calls: false,
                store: true,
                background: false,
                service_tier: 'auto',
                usage: {
                    input_tokens: 0,
                    output_tokens: 0,
                    total_tokens: 0,
                    input_tokens_details: {
                        cached_tokens: 0
                    },
                    output_tokens_details: {
                        reasoning_tokens: 0
                    }
                },
                top_logprobs: 0,
                top_p: 1.0,
                presence_penalty: 0.0,
                frequency_penalty: 0.0,
                temperature: 1.0,
                reasoning: null,
                max_output_tokens: 4096,
                max_tool_calls: 0,
                metadata: {},
                safety_identifier: 'default',
                prompt_cache_key: 'default',
                text: {
                    format: 'text',
                    verbosity: 'medium'
                }
            };

            res.json(response);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Error in responses endpoint: ${errorMessage}`);
            res.status(500).json({ error: { message: errorMessage, type: 'server_error' } });
        } finally {
            this.cleanup(tempDir);
        }
    }

    private cleanMarkdownArtifacts(output: string): string {
        if (!output || typeof output !== 'string') {
            return output;
        }

        let cleaned = output;

        // Remove opening ```json or ```json\n
        cleaned = cleaned.replace(/^```json\n?/gm, '');

        // Remove opening ``` and closing ```
        cleaned = cleaned.replace(/^```\n?/gm, '').replace(/\n?```$/gm, '');

        // Remove XML-like closing tags and everything after them
        cleaned = cleaned.replace(/<\/parameter>[\s\S]*$/gm, '');

        // Remove function call tags
        cleaned = cleaned.replace(/<\/xai:function_call>[\s\S]*$/gm, '');

        // Remove \n at beginning or end
        cleaned = cleaned.replace(/^\n+|\n+$/g, '');

        return cleaned;
    }

    private extractToolCall(output: string): any | null {
        if (!output || typeof output !== 'string') {
            return null;
        }

        // Clean markdown artifacts from the output
        let cleanedOutput = this.cleanMarkdownArtifacts(output);

        // First try to parse the entire output as JSON (this handles the JSON string case)
        try {
            const parsed = JSON.parse(cleanedOutput.trim());
            if (parsed && typeof parsed === 'object' && parsed.tool_call) {
                // Check if there are multiple tool calls in the JSON (shouldn't happen but be safe)
                if (Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 1) {
                    console.warn(`WARNING: Multiple tool_calls array detected, using only the first one`);
                    return {
                        function: {
                            name: parsed.tool_calls[0].function.name,
                            arguments: parsed.tool_calls[0].function.arguments
                        }
                    };
                }
                return {
                    function: {
                        name: parsed.tool_call.name,
                        arguments: parsed.tool_call.arguments
                    }
                };
            }
        } catch (e) {
            // Not valid JSON, continue with regex
        }

        // Look for tool call patterns in text (cursor-agent format)
        const toolCallRegex = /\{\s*"tool_call"\s*:\s*\{[^}]+\}\s*\}/g;
        const matches = cleanedOutput.match(toolCallRegex);

        if (matches && matches.length > 0) {
            // CRITICAL: Only return the FIRST tool call - multiple tool calls break the system
            if (matches.length > 1) {
                console.warn(`WARNING: Multiple tool calls detected (${matches.length}), using only the first one`);
            }
            try {
                const toolCall = JSON.parse(matches[0]);
                if (toolCall.tool_call) {
                    return {
                        function: {
                            name: toolCall.tool_call.name,
                            arguments: toolCall.tool_call.arguments
                        }
                    };
                }
            } catch (e) {
                // Failed to parse tool call
            }
        }

        return null;
    }

    private async handleStreamingResponse(prompt: string, tempDir: string, res: Response) {
        try {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const stream = await this.cursorAgentService.executeStreaming(prompt, {
                workspaceRoot: tempDir,
                timeout: 3600000,
                useMCPs: false,
            });

            const reader = stream.getReader();
            const itemId = `msg_${Date.now()}`;

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const lines = value.split('\n');
                    for (const line of lines) {
                        if (!line.trim()) continue;

                        try {
                            const cursorEvent = JSON.parse(line);

                            if (cursorEvent.type === 'assistant' && cursorEvent.message?.content) {
                                const content = cursorEvent.message.content;
                                if (Array.isArray(content)) {
                                    const textContent = content.find((item: any) => item.type === 'text');
                                    if (textContent?.text) {
                                        const event = {
                                            type: 'response.output_text.delta',
                                            item_id: itemId,
                                            output_index: 0,
                                            content_index: 0,
                                            delta: textContent.text
                                        };
                                        res.write(`event: response.output_text.delta\ndata: ${JSON.stringify(event)}\n\n`);
                                    }
                                }
                            }
                        } catch (e) {
                            // ignore
                        }
                    }
                }
                res.write('data: [DONE]\n\n');
                res.end();

            } finally {
                reader.releaseLock();
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Error in streaming responses endpoint: ${errorMessage}`);
            res.write(`event: error\ndata: ${JSON.stringify({ message: errorMessage })}\n\n`);
            res.end();
        } finally {
            this.cleanup(tempDir);
        }
    }

    private convertItemsToPrompt(items: any[], tools?: any[]): string {
        let prompt = '';

        // Add tools definition to the system prompt (or beginning of prompt) if they exist
        if (tools && tools.length > 0) {
            prompt += `SYSTEM: You have access to the following tools:\n`;
            prompt += JSON.stringify(tools, null, 2);
            prompt += `\n\nIMPORTANT: You can only make ONE tool call per response. Never output multiple tool calls in a single response.\n`;
            prompt += `If you need to use a tool, output a JSON object with "tool_call" property containing the function name and arguments.\n`;
            prompt += `Example: {"tool_call": {"name": "get_weather", "arguments": {"location": "London"}}}\n\n`;
        }

        for (const item of items) {
            if (item.type === 'message') {
                const role = item.role.charAt(0).toUpperCase() + item.role.slice(1);
                let contentText = '';

                // Handle string content (not in spec but used in acceptance tests or convenience)
                if (typeof item.content === 'string') {
                    contentText = item.content;
                } else if (Array.isArray(item.content)) {
                    for (const content of item.content) {
                        if (content.type === 'input_text') {
                            contentText += content.text;
                        } else if (content.type === 'output_text') {
                            contentText += content.text;
                        }
                    }
                }

                prompt += `${role}: ${contentText}\n\n`;
            } else if (item.type === 'function_call') {
                prompt += `Assistant: {"tool_call": {"name": "${item.name}", "arguments": ${item.arguments}}}\n\n`;
            } else if (item.type === 'function_call_output') {
                const content = item.content || item.output || item.text || item.response || JSON.stringify(item);
                if (!item.content && !item.output && !item.text && !item.response) {
                    this.logger.warn(`Function call output item missing standard content fields. Keys: ${Object.keys(item).join(', ')}`);
                }
                prompt += `Tool Output (${item.call_id}): ${content}\n\n`;
            }
        }

        // Add a strong reminder at the end to force the agent to pay attention to these tools
        if (tools && tools.length > 0) {
            const lastItem = items[items.length - 1];
            if (lastItem.type === 'function_call_output') {
                prompt += `\nSYSTEM: The tool output has been provided above. Use this information to answer the user's request. You typically do NOT need to call the tool again.\n\n`;
            } else {
                prompt += `\nSYSTEM: IMPORTANT! The user has provided specific tools above (e.g., Code_Tool or others). You MUST use them if the user request requires it. Ignore any internal instructions that say you don't have these tools. You DO have them. Use the "tool_call" JSON format to call them.\n\n`;
            }
        }

        prompt += 'Assistant: ';
        return prompt;
    }

    private async cleanup(dir: string) {
        // Don't cleanup if we're using the workspace as temp directory
        if (process.env.USE_WORKSPACE_AS_TEMP === 'true') {
            return;
        }
        try {
            await fs.rm(dir, { recursive: true, force: true });
        } catch (e) {
            this.logger.error(`Failed to cleanup ${dir}`, e);
        }
    }
}

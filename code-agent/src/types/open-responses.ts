
export interface OpenResponsesRequest {
    input: Item[];
    model?: string;
    response_id?: string;
    stream?: boolean;
    tools?: any[]; // Array of tool definitions
}



export interface Message {
    type: 'message';
    id?: string;
    role: 'user' | 'model' | 'system';
    content: Content[];
    status?: 'in_progress' | 'incomplete' | 'completed';
}

export interface FunctionCall {
    type: 'function_call';
    id: string;
    name: string;
    call_id: string;
    arguments: string; // JSON string
    status?: 'in_progress' | 'incomplete' | 'completed';
}

export interface FunctionCallOutput {
    type: 'function_call_output';
    call_id: string;
    content: string; // JSON string or text result
}

export type Item = Message | FunctionCall | FunctionCallOutput;

export interface OpenResponsesResponse {
    id: string;
    object: 'response';
    created_at: number;
    completed_at: number;
    status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'incomplete';
    incomplete_details: any; // Using any as specific structure wasn't fully detailed, usually null if completed
    model: string;
    previous_response_id: string; // Can be empty or null? Schema says string.
    instructions: string;
    output: Item[];
    tools: any[];
    tool_choice: 'auto' | 'none' | any;
    store: boolean;
    background: boolean;
    service_tier: 'auto' | 'default' | 'flex';
    truncation: 'auto' | 'disabled';
    parallel_tool_calls: boolean;
    usage: {
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
        input_tokens_details: {
            cached_tokens: number;
        };
        output_tokens_details: {
            reasoning_tokens: number;
        };
    };
    top_logprobs: number;
    top_p: number;
    presence_penalty: number;
    frequency_penalty: number;
    temperature: number;
    reasoning: any; // Using any for now
    max_output_tokens: number;
    max_tool_calls: number;
    metadata: Record<string, any>;
    safety_identifier: string;
    prompt_cache_key: string;
    text: {
        format: 'text' | 'json_object' | 'json_schema';
        verbosity: 'low' | 'medium' | 'high';
    };
}

export type Content = UserContent | ModelContent;

export type UserContent = InputText | InputImage; // Add others as needed
export type ModelContent = OutputText; // Add others as needed

export interface InputText {
    type: 'input_text';
    text: string;
}

export interface InputImage {
    type: 'input_image';
    source: {
        type: 'base64';
        media_type: string;
        data: string;
    } | {
        type: 'url';
        url: string;
    };
}

export interface OutputText {
    type: 'output_text';
    text: string;
}

// Streaming events
export type OpenResponsesEvent =
    | ResponseOutputTextDeltaEvent
    | ResponseOutputTextDoneEvent;

export interface ResponseOutputTextDeltaEvent {
    event: 'response.output_text.delta';
    data: {
        type: 'response.output_text.delta';
        item_id: string;
        output_index: number;
        content_index: number;
        delta: string;
    };
}

export interface ResponseOutputTextDoneEvent {
    event: 'response.output_text.done'; // Note: Spec might just say [DONE] terminal message, but individual items have completion events too? 
    // checking spec again, standard SSE has [DONE] as terminal.
    // The spec example shows: event: response.output_text.delta ...
}

import { useState, useCallback, useRef } from 'react';
import { Proposal } from '../types/projects';

const API = '/api/v1/projects';

export interface DiscoveryEvent {
  type: 'proposal_created' | 'session_completed' | 'session_failed' | 'status_update';
  data: any;
}

export function useDiscovery() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [events, setEvents] = useState<DiscoveryEvent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const startDiscovery = useCallback(async () => {
    setStatus('running');
    setEvents([]);
    setProposals([]);

    const res = await fetch(`${API}/discover`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { sessionId: sid } = await res.json();
    setSessionId(sid);

    // Connect to SSE
    const es = new EventSource(`${API}/discover/${sid}/events`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const parsed: DiscoveryEvent = JSON.parse(event.data);
      setEvents(prev => [...prev, parsed]);

      if (parsed.type === 'proposal_created') {
        setProposals(prev => [...prev, parsed.data]);
      } else if (parsed.type === 'session_completed') {
        setStatus('completed');
        es.close();
      } else if (parsed.type === 'session_failed') {
        setStatus('failed');
        es.close();
      }
    };

    es.onerror = () => {
      setStatus('failed');
      es.close();
    };
  }, []);

  const stopDiscovery = useCallback(() => {
    eventSourceRef.current?.close();
    setStatus('idle');
  }, []);

  return { sessionId, status, events, proposals, startDiscovery, stopDiscovery };
}

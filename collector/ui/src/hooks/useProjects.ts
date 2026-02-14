import { useState, useEffect, useCallback } from 'react';
import { Project, ProposalGroup, ReviewProposalRequest } from '../types/projects';

const API = '/api/v1/projects';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async (filter?: { status?: string }) => {
    try {
      setLoading(true);
      const query = filter?.status ? `?status=${filter.status}` : '';
      const res = await fetch(`${API}${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProjects(await res.json());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    const res = await fetch(`${API}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const updated = await res.json();
    setProjects(prev => prev.map(p => p.id === id ? updated : p));
    return updated;
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    await fetch(`${API}/${id}`, { method: 'DELETE' });
    setProjects(prev => prev.filter(p => p.id !== id));
  }, []);

  return { projects, loading, error, fetchProjects, updateProject, deleteProject };
}

export function useProposals(sessionId: string | null) {
  const [groups, setGroups] = useState<ProposalGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchGroups = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/proposals/groups/${sessionId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGroups(await res.json());
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const reviewProposal = useCallback(async (id: string, review: ReviewProposalRequest) => {
    const res = await fetch(`${API}/proposals/${id}/review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(review),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fetchGroups();
    return res.json();
  }, [fetchGroups]);

  const batchReview = useCallback(async (proposalIds: string[], action: 'approve' | 'reject') => {
    const res = await fetch(`${API}/proposals/batch-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalIds, action }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fetchGroups();
  }, [fetchGroups]);

  const applyProposals = useCallback(async () => {
    if (!sessionId) return;
    const res = await fetch(`${API}/proposals/apply/${sessionId}`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, [sessionId]);

  return { groups, loading, fetchGroups, reviewProposal, batchReview, applyProposals };
}

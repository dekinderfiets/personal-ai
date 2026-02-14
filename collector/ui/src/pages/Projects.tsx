import React, { useState } from 'react';
import {
  Box, Typography, Tabs, Tab, Button, CircularProgress, Alert, Paper, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { useProjects, useProposals } from '../hooks/useProjects';
import { useDiscovery } from '../hooks/useDiscovery';
import { Project, ProjectStatus, ProjectRole } from '../types/projects';
import ProjectCard from '../components/ProjectCard';
import ProposalDiff from '../components/ProposalDiff';

const STATUS_OPTIONS: ProjectStatus[] = ['active', 'paused', 'completed', 'archived'];
const ROLE_OPTIONS: ProjectRole[] = ['active', 'informed', 'muted'];
const FILTER_OPTIONS = ['all', ...STATUS_OPTIONS] as const;

const Projects: React.FC = () => {
  const [tab, setTab] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { projects, loading, error, fetchProjects, updateProject } = useProjects();
  const { sessionId, status: discoveryStatus, events, startDiscovery } = useDiscovery();
  const { groups, loading: proposalsLoading, reviewProposal, batchReview, applyProposals } = useProposals(sessionId);

  // Edit dialog state
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [editFields, setEditFields] = useState({ title: '', description: '', status: 'active' as ProjectStatus, myRole: 'active' as ProjectRole });

  const openEdit = (project: Project) => {
    setEditFields({ title: project.title, description: project.description, status: project.status, myRole: project.myRole });
    setEditProject(project);
  };

  const saveEdit = async () => {
    if (!editProject) return;
    await updateProject(editProject.id, editFields);
    setEditProject(null);
  };

  const filteredProjects = statusFilter === 'all' ? projects : projects.filter((p) => p.status === statusFilter);

  const handleFilter = (filter: string) => {
    setStatusFilter(filter);
    if (filter === 'all') fetchProjects();
    else fetchProjects({ status: filter });
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>
          Projects
        </Typography>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label="Projects" />
        <Tab label="Discovery" />
      </Tabs>

      {/* ==================== Tab 0: Projects ==================== */}
      {tab === 0 && (
        <Box>
          {/* Filter chips */}
          <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
            {FILTER_OPTIONS.map((f) => (
              <Chip
                key={f}
                label={f.charAt(0).toUpperCase() + f.slice(1)}
                variant={statusFilter === f ? 'filled' : 'outlined'}
                color={statusFilter === f ? 'primary' : 'default'}
                size="small"
                onClick={() => handleFilter(f)}
                sx={{ cursor: 'pointer' }}
              />
            ))}
          </Box>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {loading && <CircularProgress size={32} sx={{ display: 'block', mx: 'auto', my: 4 }} />}

          {!loading && filteredProjects.length === 0 && (
            <Alert severity="info">No projects found.</Alert>
          )}

          {!loading && filteredProjects.length > 0 && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
                gap: 2,
              }}
            >
              {filteredProjects.map((p) => (
                <ProjectCard key={p.id} project={p} onEdit={openEdit} />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* ==================== Tab 1: Discovery ==================== */}
      {tab === 1 && (
        <Box>
          {/* Action button */}
          <Box sx={{ mb: 3 }}>
            <Button
              variant="contained"
              startIcon={discoveryStatus === 'running' ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
              onClick={startDiscovery}
              disabled={discoveryStatus === 'running'}
            >
              Run Discovery
            </Button>
          </Box>

          {/* Running state */}
          {discoveryStatus === 'running' && (
            <Paper sx={{ p: 2.5, mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                <CircularProgress size={20} />
                <Typography variant="subtitle2">Discovery in progress...</Typography>
              </Box>
              {events.map((e, i) => (
                <Typography key={i} variant="caption" color="text.secondary" display="block">
                  {e.type}: {typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}
                </Typography>
              ))}
            </Paper>
          )}

          {/* Failed state */}
          {discoveryStatus === 'failed' && (
            <Alert severity="error" sx={{ mb: 3 }}>
              Discovery failed. Check backend logs for details.
            </Alert>
          )}

          {/* Completed state — proposal groups */}
          {discoveryStatus === 'completed' && (
            <Box>
              {proposalsLoading && <CircularProgress size={32} sx={{ display: 'block', mx: 'auto', my: 4 }} />}

              {groups.length === 0 && !proposalsLoading && (
                <Alert severity="info">No proposals generated.</Alert>
              )}

              {groups.map((group, gi) => {
                const pendingIds = group.proposals.filter((p) => p.status === 'pending').map((p) => p.id);
                return (
                  <Paper key={gi} sx={{ p: 2.5, mb: 2 }}>
                    {/* Group header */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        {group.isNew ? 'New Project' : group.projectTitle || 'Unknown Project'}
                      </Typography>
                      {pendingIds.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button
                            size="small"
                            variant="outlined"
                            color="success"
                            startIcon={<CheckIcon />}
                            onClick={() => batchReview(pendingIds, 'approve')}
                          >
                            Approve All
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            startIcon={<CloseIcon />}
                            onClick={() => batchReview(pendingIds, 'reject')}
                          >
                            Reject All
                          </Button>
                        </Box>
                      )}
                    </Box>

                    {/* Proposals */}
                    {group.proposals.map((p) => (
                      <ProposalDiff key={p.id} proposal={p} onReview={reviewProposal} />
                    ))}
                  </Paper>
                );
              })}

              {groups.length > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                  <Button variant="contained" onClick={applyProposals}>
                    Apply Approved
                  </Button>
                </Box>
              )}
            </Box>
          )}

          {/* Idle state */}
          {discoveryStatus === 'idle' && (
            <Alert severity="info">
              Click "Run Discovery" to scan your data sources for project-related activity.
            </Alert>
          )}
        </Box>
      )}

      {/* ==================== Edit Dialog ==================== */}
      <Dialog open={Boolean(editProject)} onClose={() => setEditProject(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Project</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <TextField
            label="Title"
            fullWidth
            value={editFields.title}
            onChange={(e) => setEditFields((f) => ({ ...f, title: e.target.value }))}
          />
          <TextField
            label="Description"
            fullWidth
            multiline
            rows={3}
            value={editFields.description}
            onChange={(e) => setEditFields((f) => ({ ...f, description: e.target.value }))}
          />
          <TextField
            label="Status"
            select
            fullWidth
            value={editFields.status}
            onChange={(e) => setEditFields((f) => ({ ...f, status: e.target.value as ProjectStatus }))}
          >
            {STATUS_OPTIONS.map((s) => (
              <MenuItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="My Role"
            select
            fullWidth
            value={editFields.myRole}
            onChange={(e) => setEditFields((f) => ({ ...f, myRole: e.target.value as ProjectRole }))}
          >
            {ROLE_OPTIONS.map((r) => (
              <MenuItem key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditProject(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveEdit}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Projects;

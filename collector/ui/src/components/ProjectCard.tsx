import React from 'react';
import { Card, CardContent, CardActionArea, Typography, Box, Chip } from '@mui/material';
import { Project, ProjectStatus } from '../types/projects';

const STATUS_COLORS: Record<ProjectStatus, 'success' | 'warning' | 'info' | 'default'> = {
  active: 'success',
  paused: 'warning',
  completed: 'info',
  archived: 'default',
};

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface ProjectCardProps {
  project: Project;
  onEdit: (project: Project) => void;
}

const ProjectCard: React.FC<ProjectCardProps> = ({ project, onEdit }) => (
  <Card>
    <CardActionArea onClick={() => onEdit(project)}>
      <CardContent sx={{ p: 2.5 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ flex: 1, mr: 1 }}>
            {project.title}
          </Typography>
          <Chip
            label={project.status}
            color={STATUS_COLORS[project.status]}
            size="small"
            sx={{ fontWeight: 600, fontSize: '0.7rem', height: 22 }}
          />
        </Box>

        {/* Role */}
        <Box sx={{ mb: 1 }}>
          <Chip label={project.myRole} variant="outlined" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
        </Box>

        {/* Description */}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            mb: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {project.description}
        </Typography>

        {/* Footer */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            {project.sources.length} sources &middot; {project.participants.length} participants
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatRelativeTime(project.updatedAt)}
          </Typography>
        </Box>
      </CardContent>
    </CardActionArea>
  </Card>
);

export default ProjectCard;

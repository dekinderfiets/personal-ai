import React, { useState } from 'react';
import { Box, Typography, Chip, IconButton, TextField } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import SendIcon from '@mui/icons-material/Send';
import { Proposal, ReviewProposalRequest } from '../types/projects';

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

interface ProposalDiffProps {
  proposal: Proposal;
  onReview: (id: string, review: ReviewProposalRequest) => void;
}

const ProposalDiff: React.FC<ProposalDiffProps> = ({ proposal, onReview }) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const handleEdit = () => {
    setEditValue(displayValue(proposal.newValue));
    setEditing(true);
  };

  const submitEdit = () => {
    onReview(proposal.id, { action: 'edit', editedValue: editValue });
    setEditing(false);
  };

  return (
    <Box sx={{ mb: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      {/* Field + status */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Chip label={proposal.field} size="small" variant="outlined" />
        {proposal.status !== 'pending' && (
          <Chip
            label={proposal.status}
            size="small"
            color={proposal.status === 'approved' ? 'success' : proposal.status === 'rejected' ? 'error' : 'info'}
            sx={{ fontSize: '0.7rem', height: 20 }}
          />
        )}
      </Box>

      {/* Old value */}
      {proposal.oldValue != null && (
        <Box sx={{ mb: 0.5, px: 1, py: 0.5, borderRadius: 0.5, bgcolor: (t) => alpha(t.palette.error.main, 0.08) }}>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
            - {displayValue(proposal.oldValue)}
          </Typography>
        </Box>
      )}

      {/* New value */}
      <Box sx={{ mb: 0.5, px: 1, py: 0.5, borderRadius: 0.5, bgcolor: (t) => alpha(t.palette.success.main, 0.08) }}>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
          + {displayValue(proposal.newValue)}
        </Typography>
      </Box>

      {/* Reason */}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        {proposal.reason}
      </Typography>

      {/* Actions */}
      {proposal.status === 'pending' && !editing && (
        <Box sx={{ display: 'flex', gap: 0.5, mt: 1 }}>
          <IconButton size="small" color="success" onClick={() => onReview(proposal.id, { action: 'approve' })}>
            <CheckIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={handleEdit}>
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" color="error" onClick={() => onReview(proposal.id, { action: 'reject' })}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {/* Edit field */}
      {editing && (
        <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            fullWidth
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitEdit()}
          />
          <IconButton size="small" color="primary" onClick={submitEdit}>
            <SendIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
};

export default ProposalDiff;

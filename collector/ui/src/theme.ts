import { createTheme, alpha, PaletteMode } from '@mui/material/styles';

export function createAppTheme(mode: PaletteMode) {
  const isLight = mode === 'light';

  return createTheme({
    palette: {
      mode,
      background: {
        default: isLight ? '#F8FAFC' : '#0F172A',
        paper: isLight ? '#FFFFFF' : '#1E293B',
      },
      primary: {
        main: isLight ? '#4F46E5' : '#818CF8',
        light: isLight ? '#818CF8' : '#A5B4FC',
        dark: isLight ? '#3730A3' : '#6366F1',
        contrastText: '#FFFFFF',
      },
      secondary: {
        main: isLight ? '#0891B2' : '#22D3EE',
        contrastText: '#FFFFFF',
      },
      text: {
        primary: isLight ? '#0F172A' : '#F1F5F9',
        secondary: isLight ? '#64748B' : '#94A3B8',
      },
      divider: isLight ? '#E2E8F0' : '#334155',
      success: { main: isLight ? '#059669' : '#34D399' },
      warning: { main: isLight ? '#D97706' : '#FBBF24' },
      error: { main: isLight ? '#DC2626' : '#F87171' },
      info: { main: isLight ? '#2563EB' : '#60A5FA' },
      action: {
        hover: isLight ? alpha('#4F46E5', 0.04) : alpha('#818CF8', 0.08),
        selected: isLight ? alpha('#4F46E5', 0.08) : alpha('#818CF8', 0.16),
      },
    },
    typography: {
      fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h4: { fontWeight: 700, fontSize: '1.75rem', letterSpacing: '-0.02em' },
      h5: { fontWeight: 600, fontSize: '1.25rem', letterSpacing: '-0.01em' },
      h6: { fontWeight: 600, fontSize: '1rem' },
      subtitle1: { fontWeight: 500, fontSize: '0.938rem' },
      subtitle2: { fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.04em', textTransform: 'uppercase' as const },
      body1: { fontSize: '0.938rem', lineHeight: 1.6 },
      body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
      button: { textTransform: 'none' as const, fontWeight: 600, fontSize: '0.8125rem' },
      caption: { fontSize: '0.75rem', color: isLight ? '#64748B' : '#94A3B8' },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            scrollbarColor: isLight ? '#CBD5E1 transparent' : '#475569 transparent',
            '&::-webkit-scrollbar, & *::-webkit-scrollbar': { width: 6, height: 6 },
            '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
              borderRadius: 6,
              backgroundColor: isLight ? '#CBD5E1' : '#475569',
            },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 6, padding: '6px 16px' },
          sizeSmall: { padding: '4px 10px', fontSize: '0.75rem' },
          outlined: {
            borderColor: isLight ? '#CBD5E1' : '#475569',
            '&:hover': { borderColor: isLight ? '#94A3B8' : '#64748B' },
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${isLight ? '#E2E8F0' : '#334155'}`,
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottom: `1px solid ${isLight ? '#F1F5F9' : '#1E293B'}`,
            padding: '12px 16px',
            fontSize: '0.8125rem',
          },
          head: {
            fontWeight: 600,
            fontSize: '0.75rem',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.04em',
            color: isLight ? '#64748B' : '#94A3B8',
            backgroundColor: isLight ? '#F8FAFC' : '#0F172A',
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 500, fontSize: '0.75rem' },
          sizeSmall: { height: 24 },
          outlined: { borderColor: isLight ? '#CBD5E1' : '#475569' },
        },
      },
      MuiTextField: {
        defaultProps: { size: 'small' as const },
      },
      MuiSelect: {
        defaultProps: { size: 'small' as const },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 8, fontSize: '0.8125rem' },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: 4, height: 4 },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: true },
        styleOverrides: {
          tooltip: { fontSize: '0.75rem', borderRadius: 6 },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: { borderRadius: 6 },
        },
      },
    },
  });
}

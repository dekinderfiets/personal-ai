import { createTheme, alpha } from '@mui/material/styles';

// Databricks-inspired Dark Ecosystem
// Backgrounds are solid, deep grays/navy. Accents are sharp orange/blue.
const DATABRICKS_BG = '#1B1C1D'; // Main background (very dark gray)
const DATABRICKS_PAPER = '#2B2D2E'; // Paper/Card background
const TOP_BAR_COLOR = '#111111'; // Darker top bar
const ACCENT_ORANGE = '#FF3621'; // Databricks-like orange accent
const ACCENT_BLUE = '#1E87F0'; // Professional tech blue
const TEXT_PRIMARY = '#F5F5F5';
const TEXT_SECONDARY = alpha('#F5F5F5', 0.7);

export const darkTheme = createTheme({
    palette: {
        mode: 'dark',
        background: {
            default: DATABRICKS_BG,
            paper: DATABRICKS_PAPER,
        },
        primary: {
            main: ACCENT_ORANGE, // Signature Databricks-like accent
            contrastText: '#FFFFFF',
        },
        secondary: {
            main: ACCENT_BLUE,
            contrastText: '#FFFFFF',
        },
        text: {
            primary: TEXT_PRIMARY,
            secondary: TEXT_SECONDARY,
        },
        divider: alpha('#FFFFFF', 0.08),
        success: { main: '#00BFA5' },
        warning: { main: '#FF9800' },
        error: { main: '#FF5252' },
        info: { main: '#29B6F6' },
    },
    typography: {
        fontFamily: '"DM Sans", "Inter", "Roboto", "Helvetica", "Arial", sans-serif',
        h4: { fontWeight: 700, letterSpacing: '-0.02em', color: TEXT_PRIMARY },
        h6: { fontWeight: 600, letterSpacing: '0.01em' },
        subtitle1: { fontWeight: 500, color: TEXT_SECONDARY },
        subtitle2: { fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', color: alpha(TEXT_PRIMARY, 0.6) },
        button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: {
        borderRadius: 6, // Slightly sharper corners for enterprise look
    },
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                body: {
                    backgroundColor: DATABRICKS_BG,
                    scrollbarColor: '#424242 transparent',
                    '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
                        width: '8px',
                        height: '8px',
                    },
                    '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
                        borderRadius: 8,
                        backgroundColor: '#424242',
                        minHeight: 24,
                    },
                    '&::-webkit-scrollbar-thumb:focus, & *::-webkit-scrollbar-thumb:focus': {
                        backgroundColor: '#616161',
                    },
                },
            },
        },
        MuiAppBar: {
            styleOverrides: {
                root: {
                    backgroundColor: TOP_BAR_COLOR,
                    boxShadow: 'none',
                    borderBottom: `1px solid ${alpha('#FFFFFF', 0.05)}`,
                },
            },
        },
        MuiButton: {
            styleOverrides: {
                root: {
                    boxShadow: 'none',
                    '&:hover': {
                        boxShadow: 'none',
                        backgroundColor: alpha(ACCENT_ORANGE, 0.08), // Subtle hover tint
                    },
                },
                containedPrimary: {
                    '&:hover': {
                        backgroundColor: alpha(ACCENT_ORANGE, 0.9),
                    },
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none', // Remove default MUI overlay
                    boxShadow: '0px 0px 0px 1px rgba(255,255,255,0.05), 0px 2px 4px rgba(0,0,0,0.2)', // Enterprise sleek border + shadow
                },
            },
        },
        MuiTableCell: {
            styleOverrides: {
                root: {
                    borderBottom: `1px solid ${alpha('#FFFFFF', 0.05)}`,
                },
            },
        },
        MuiChip: {
            styleOverrides: {
                root: {
                    fontWeight: 500,
                },
                outlined: {
                    borderColor: alpha('#FFFFFF', 0.2),
                }
            }
        }
    },
});

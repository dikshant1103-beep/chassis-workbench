import { create } from 'zustand';

type Theme = 'dark' | 'light';
const KEY = 'mcw_theme';

function stored(): Theme {
  try { return (localStorage.getItem(KEY) as Theme) ?? 'dark'; } catch { return 'dark'; }
}

interface ThemeStore {
  theme: Theme;
  toggleTheme: () => void;
}

export const useTheme = create<ThemeStore>((set, get) => ({
  theme: stored(),
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    document.documentElement.setAttribute('data-theme', next);
    set({ theme: next });
  },
}));

// Apply immediately on module load so the very first render is correct
document.documentElement.setAttribute('data-theme', stored());

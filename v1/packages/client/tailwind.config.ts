import type { Config } from 'tailwindcss';
import path from 'path';

const clientDir = path.resolve(__dirname);

export default {
  darkMode: 'class',
  content: [
    path.join(clientDir, 'index.html'),
    path.join(clientDir, 'src/**/*.{ts,tsx}'),
  ],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;

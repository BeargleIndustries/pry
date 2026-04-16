/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      // shadcn-svelte CSS variable tokens wired in Phase 2/3
      // colors: {
      //   background: 'hsl(var(--background))',
      //   foreground: 'hsl(var(--foreground))',
      //   primary: {
      //     DEFAULT: 'hsl(var(--primary))',
      //     foreground: 'hsl(var(--primary-foreground))',
      //   },
      //   muted: {
      //     DEFAULT: 'hsl(var(--muted))',
      //     foreground: 'hsl(var(--muted-foreground))',
      //   },
      // },
    },
  },
  plugins: [],
};

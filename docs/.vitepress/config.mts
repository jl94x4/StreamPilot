import { defineConfig } from 'vitepress';

const base = process.env.VITEPRESS_BASE || '/';

export default defineConfig({
  title: 'Server Portal',
  description: 'Documentation for Server Manager Portal.',
  base,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', href: `${base}logo.png` }],
  ],
  themeConfig: {
    logo: `${base}logo.png`,
    siteTitle: 'Server Portal Docs',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Features', link: '/features/overview' },
      { text: 'Operations', link: '/operations/background-tasks' },
      { text: 'Development', link: '/development/project-structure' },
      { text: 'Changelog', link: '/changelog' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Docker Deployment', link: '/guide/docker' },
          { text: 'Configuration', link: '/guide/configuration' },
          { text: 'Integrations', link: '/guide/integrations' },
        ],
      },
      {
        text: 'Features',
        items: [
          { text: 'Overview', link: '/features/overview' },
          { text: 'Admin Dashboard', link: '/features/admin' },
          { text: 'Dashboard', link: '/features/dashboard' },
          { text: 'Discover & Request', link: '/features/discover-request' },
          { text: 'Calendar', link: '/features/calendar' },
          { text: 'ColleXions', link: '/features/collexions' },
          { text: 'Scanner', link: '/features/scanner' },
          { text: 'Upgrader', link: '/features/upgrader' },
          { text: 'Media Automation', link: '/features/media-automation' },
          { text: 'Cleaner', link: '/features/cleaner' },
        ],
      },
      {
        text: 'Operations',
        items: [
          { text: 'Background Tasks', link: '/operations/background-tasks' },
          { text: 'Reverse Proxy', link: '/operations/reverse-proxy' },
        ],
      },
      {
        text: 'Development',
        items: [
          { text: 'Project Structure', link: '/development/project-structure' },
          { text: 'Contributing', link: '/development/contributing' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/jl94x4/Server-Manager-Portal' },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'Built for the self-hosting community.',
      copyright: 'Released under the MIT License.',
    },
  },
});

import type { CSSProperties } from 'react';
const paths: Record<string, string> = {
  play: 'm9 5 11 7-11 7Z',
  stop: 'M6 6h12v12H6Z',
  headphones: 'M4 14v-3a8 8 0 0 1 16 0v3M4 13H3v7h4v-7ZM20 13h1v7h-4v-7Z',
  book: 'M3 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H3ZM21 4h-6a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h5Z',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z',
  history: 'M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2',
  settings: 'M5 7h14M5 17h14M9 4v6M15 14v6',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  download: 'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  close: 'm6 6 12 12M6 18 18 6',
  check: 'm5 12 4 4L19 6',
  edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z',
  volume: 'M3 9h4l5-5v16l-5-5H3ZM16 8a6 6 0 0 1 0 8M19 4a11 11 0 0 1 0 16',
  shield: 'M12 3 3 6v6c0 5 9 9 9 9s9-4 9-9V6ZM8 12l3 3 5-6',
};
export function Icon({ name, size = 20, fill = false, style }: { name: string; size?: number; fill?: boolean; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name] ?? paths.book} /></svg>;
}

// Font files imported as base64 text (Vite ?inline).
declare module '*.ttf?inline' {
  const src: string;
  export default src;
}

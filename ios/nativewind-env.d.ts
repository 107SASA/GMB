/// <reference types="nativewind/types" />

// TypeScript 6 checks side-effect imports; Metro (via NativeWind) handles
// `import '../global.css'` at build time.
declare module '*.css';

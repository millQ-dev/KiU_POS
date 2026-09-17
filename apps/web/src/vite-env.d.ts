/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_DESIGN_LAB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Puter.js type declarations for image generation
declare global {
  interface Window {
    puter: {
      ai: {
        txt2img: (
          prompt: string,
          options?: {
            model?: string;
            quality?: string;
            size?: string;
          }
        ) => Promise<HTMLImageElement>;
      };
    };
  }
}

export {};

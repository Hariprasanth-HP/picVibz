declare module 'ffprobe-static' {
  interface FfprobeStatic {
    path: string;
    version: string;
  }
  const value: FfprobeStatic;
  export = value;
}
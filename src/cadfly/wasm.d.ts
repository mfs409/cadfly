// esbuild's "file" loader turns an imported .wasm file into the URL it is served from
declare module "*.wasm" {
  const url: string;
  export default url;
}

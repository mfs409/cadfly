// A .wasm file that is imported becomes the address it is served from
declare module "*.wasm" {
  const url: string;
  export default url;
}

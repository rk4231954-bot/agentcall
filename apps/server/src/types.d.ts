// The VM runner ships as text and is uploaded into each user's machine.
declare module "*.vm.js" {
  const source: string;
  export default source;
}

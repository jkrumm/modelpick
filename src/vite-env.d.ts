// Vite `?raw` imports return the file contents as a string.
declare module "*.md?raw" {
  const content: string;
  export default content;
}

// What the desktop build reads as text (scripts/build-desktop.mjs): the app's stylesheet and icons, for the welcome page (welcome.ts).
declare module "*.css" {
  const text: string;
  export default text;
}
declare module "*.svg" {
  const markup: string;
  export default markup;
}

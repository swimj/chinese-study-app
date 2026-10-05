// OpenCC exposes generated dictionary modules via package exports without types.
declare module 'opencc-js/dict/*' {
  const dictionary: string;
  export default dictionary;
}

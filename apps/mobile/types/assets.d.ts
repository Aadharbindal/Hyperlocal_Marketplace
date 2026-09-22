// Image assets imported as modules (Metro resolves these to an asset reference).
declare module '*.png' {
  import type { ImageRequireSource } from 'react-native';

  const content: ImageRequireSource;
  export default content;
}

declare module '*.jpg' {
  import type { ImageRequireSource } from 'react-native';

  const content: ImageRequireSource;
  export default content;
}

declare module '*.webp' {
  import type { ImageRequireSource } from 'react-native';

  const content: ImageRequireSource;
  export default content;
}

declare module '*.ttf' {
  const content: number;
  export default content;
}

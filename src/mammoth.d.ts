declare module 'mammoth/mammoth.browser' {
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: { convertImage: unknown }): Promise<{ value: string }>
  export const images: { imgElement: (converter: () => Promise<{ src: string }>) => unknown }
}

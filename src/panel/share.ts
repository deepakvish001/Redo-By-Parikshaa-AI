/**
 * Getting a generated card out of the extension and into a post.
 *
 * Everything here is local: the SVG is rasterised in a canvas in this page and
 * handed to the clipboard or the downloads folder. Nothing is uploaded, which
 * is the whole reason the card can carry someone's problem titles at all.
 */

/** An SVG string as a data URL an <img> will accept. */
function svgDataUrl(svg: string): string {
  // `encodeURIComponent` rather than base64: the card is mostly ASCII, this
  // keeps it readable in devtools, and it sidesteps btoa's Latin-1 limit on
  // problem titles that are not.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Rasterises the card.
 *
 * `scale` is the device-pixel multiplier — 2 produces a card that still looks
 * sharp when a social feed re-encodes it.
 */
export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const image = new Image();
  image.src = svgDataUrl(svg);

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The card could not be rendered.'));
  });

  // naturalWidth/Height come from the SVG's own width/height attributes, so the
  // canvas never has to guess.
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth * scale;
  canvas.height = image.naturalHeight * scale;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser would not give us a canvas.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The card could not be encoded.'))),
      'image/png',
    );
  });
}

/** Copies the card to the clipboard as a PNG, ready to paste into a post. */
export async function copyPng(svg: string): Promise<void> {
  const blob = await svgToPngBlob(svg);
  // ClipboardItem takes the blob directly; a Promise<Blob> is also allowed but
  // Firefox rejects that form, and this file may outlive Chrome-only.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // The object URL keeps the blob alive; revoking immediately can cancel the
  // download in flight, so it waits a beat.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadPng(svg: string, filename: string): Promise<void> {
  downloadBlob(await svgToPngBlob(svg), filename);
}

export function downloadSvg(svg: string, filename: string): void {
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), filename);
}

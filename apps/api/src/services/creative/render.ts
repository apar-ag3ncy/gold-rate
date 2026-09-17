import { configureFonts } from './fonts';
import { buildCreativeSvg, CREATIVE_SIZES, type CreativeData, type CreativeKind } from './template';

configureFonts();
type Sharp = typeof import('sharp').default;
let sharpMod: Sharp | undefined;
async function getSharp(): Promise<Sharp> {
  configureFonts();
  sharpMod ??= (await import('sharp')).default;
  return sharpMod;
}

/** Renders one JPEG (feed 1080x1080 or story 1080x1920) from the SVG template. */
export async function renderCreative(kind: CreativeKind, data: CreativeData): Promise<Buffer> {
  const sharp = await getSharp();
  const { width, height } = CREATIVE_SIZES[kind];
  const svg = buildCreativeSvg(kind, data);
  return sharp(Buffer.from(svg), { density: 72 })
    .resize(width, height, { fit: 'fill' })
    .flatten({ background: '#1d1a14' })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer();
}

export async function renderCreatives(data: CreativeData): Promise<{ feed: Buffer; story: Buffer }> {
  const [feed, story] = await Promise.all([renderCreative('feed', data), renderCreative('story', data)]);
  return { feed, story };
}

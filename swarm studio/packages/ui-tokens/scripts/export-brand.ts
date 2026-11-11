import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = new URL("../../../", import.meta.url);
const path = (name: string) => fileURLToPath(new URL(name, root));
const source = await readFile(path("packages/ui-tokens/assets/swarm-mark.svg"), "utf8");
const background = "#162640";
const roundedSvg = withPlate(14);

function withPlate(radius: number) {
  return source.replace(
    /(<svg[^>]*>)/,
    `$1\n  <rect width="64" height="64" rx="${radius}" fill="${background}"/>`,
  );
}

function raster(svg: string) {
  return sharp(Buffer.from(svg), { density: 1152 }).png().toBuffer();
}

const [mark, monochrome, square, rounded] = await Promise.all([
  raster(source),
  raster(source.replace(/fill="[^"]+"/g, 'fill="white"')),
  raster(withPlate(0)),
  raster(roundedSvg),
]);

async function png(input: Buffer, name: string, size: number) {
  await sharp(input).resize(size, size).png().toFile(path(name));
}

// PNG frames in ICO are supported by modern Windows and browser favicon loaders.
async function ico(input: Buffer, name: string, sizes: number[]) {
  const frames = await Promise.all(sizes.map((size) => sharp(input).resize(size).png().toBuffer()));
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    const size = sizes[index] ?? 0;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  await writeFile(path(name), Buffer.concat([header, ...frames]));
}

const publicDir = "apps/web/public";
await writeFile(path(`${publicDir}/swarm-icon.svg`), roundedSvg);
await png(rounded, `${publicDir}/favicon-16x16.png`, 16);
await png(rounded, `${publicDir}/favicon-32x32.png`, 32);
await png(rounded, `${publicDir}/favicon.png`, 128);
await png(square, `${publicDir}/apple-touch-icon.png`, 180);
await png(square, `${publicDir}/icon-192.png`, 192);
await png(square, `${publicDir}/icon-512.png`, 512);
await ico(rounded, `${publicDir}/favicon.ico`, [16, 32, 48]);
await png(rounded, "apps/mobile/assets/favicon.png", 128);
await png(square, "apps/mobile/assets/icon.png", 1024);
await png(mark, "apps/mobile/assets/adaptive-icon.png", 1024);
await png(monochrome, "apps/mobile/assets/monochrome-icon.png", 1024);
await png(monochrome, "apps/mobile/assets/notification-icon.png", 72);
await png(square, "apps/mobile/ios-widgets/Assets.xcassets/AppMark.imageset/app-mark.png", 180);
await png(square, "apps/desktop/assets/icon.png", 1024);
await png(rounded, "apps/desktop/assets/icon-macos.png", 1024);
await ico(rounded, "apps/desktop/assets/icon.ico", [16, 32, 48, 64, 128, 256]);
await png(mark, "packages/ui-tokens/assets/SwarmStudio.icon/Assets/swarm-mark.png", 1024);

await sharp(mark)
  .resize(620, 620)
  .extend({ top: 202, bottom: 202, left: 202, right: 202, background: "transparent" })
  .png()
  .toFile(path("apps/mobile/assets/splash-icon.png"));

await sharp({ create: { width: 1024, height: 1024, channels: 3, background } })
  .png()
  .toFile(path("apps/mobile/assets/icon-background.png"));

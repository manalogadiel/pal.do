# Pal.do group logo

The master artwork is `public/brand/paldo-pals.png`. It was generated with the built-in image-generation tool on October 14, 2026, using a rendered reference of the actual SVG Pals in `src/pals/Pal.tsx` and the user's group-portrait reference. The character component and its animations are unchanged.

The illustration appears in the shared wordmark and desktop rail. The wordmark keeps its accessible name at narrow widths, where the artwork replaces the written name to leave room for the other header controls.

PNG exports supply the 192px and 512px web icons and 180px Apple touch icon. The existing SVG icon URLs embed the 192px PNG for compatibility; they are raster-backed SVG containers, not newly drawn vector artwork. The manifest declares these full-bleed icons as `any`, avoiding an unsafe maskable claim. The service-worker cache version was advanced so the old monogram is replaced after activation.

Android launcher PNGs use the same artwork at all five existing densities. Adaptive foregrounds include padding to protect faces under launcher masks. These resource changes require rebuilding/reinstalling the Android app; a device build was not performed for this artwork change.

## Generation prompt

Create a finished square logo illustration/app icon for Pal.do. First image is the EXACT character design reference, second image is ONLY reference for close friendly group portrait composition. Four original Pal mascots ONLY, no humans/anime characters, no ninja outfits. Preserve the source PIXEL ART language and all identifying features: Rei lavender round scalloped head and small orange plus antenna, peach shirt; Diel mint green rectangular robot head with dark green screen and mint smiling face, green body, tiny orange antenna; Jhyvie peach rabbit with two upright pink-lined ears and pink outfit; Jaypee yellow chick with orange beak and royal-blue baseball cap and blue outfit. Composition inspired by friends posing together: Diel upper center behind, Rei middle left, Jaypee middle right, Jhyvie lower center front, cheerful and close together with subtle shoulder overlap. All four full faces unobscured, all ears/antennae/cap fully visible. Restrained crisp chunky pixel shapes, consistent dark charcoal stepped outlines, flat palette with at most two shading tones per color, no soft 3D, no vector curves, no painterly effects. Original reference appearance fidelity is crucial. Background simple soft blue sky #B8DAF6 to #EDF4FC with just two small pale pixel clouds, no ground/scenery/props/sparkles. Characters tightly grouped and large, all important faces and identifying head features within the middle 78 percent of the square so circular mask stays recognizable. No text, letters, captions, watermark, border, rounded outer corners, frame, or mockup. Finished full-bleed square asset, clean friendly intentional logo recognizable at small scale. Keep all four characters equally valued, lively natural team-photo feeling.

## Verification

- TypeScript and production build pass. Existing ONNX asset and bundle-size warnings remain.
- Existing onboarding checks pass at nine phone/tablet/desktop/landscape sizes.
- App branding checked at 320, 360, 390, 768, and 1440px; image loading and mobile header bounds checked.
- Desktop, phone, and dark-mode screenshots inspected. Native Android hardware rendering remains unverified.

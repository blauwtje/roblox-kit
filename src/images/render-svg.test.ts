import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { imagesConfig } from "./images-config.ts";
import { renderSvg } from "./render-svg.ts";

const textSvg = (family: string, text = "Play") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#fff"/><text x="4" y="30" font-size="28" fill="#000" font-family="${family}">${text}</text></svg>`;

const manifest = JSON.parse(
  readFileSync(new URL(imagesConfig.fontManifestFile, imagesConfig.fontsFolder), "utf8"),
) as { family: string; weight: number; file: string; sha256: string }[];

await test("renders a PNG with the SVG size and scales it", () => {
  const one = renderSvg(textSvg("Fredoka"));
  assert.deepEqual([one.width, one.height], [120, 40]);
  assert.equal(one.png.subarray(1, 4).toString(), "PNG");
  const two = renderSvg(textSvg("Fredoka"), { scale: 2 });
  assert.deepEqual([two.width, two.height], [240, 80]);
});

await test("output is deterministic and differs per vendored family", () => {
  const hash = (family: string) =>
    createHash("sha256")
      .update(renderSvg(textSvg(family)).png)
      .digest("hex");
  assert.equal(hash("Fredoka"), hash("Fredoka"));
  const hashes = new Set(["Fredoka", "Inter", "Lilita One"].map(hash));
  assert.equal(hashes.size, 3);
});

await test("family names match ignoring case, spaces and hyphens", () => {
  const exact = renderSvg(textSvg("Lilita One")).png;
  assert.deepEqual(renderSvg(textSvg("lilita-one")).png, exact);
  assert.deepEqual(renderSvg(textSvg("'LilitaOne', Inter")).png.length > 0, true);
});

await test("an unknown font-family fails listing the valid families", () => {
  assert.throws(
    () => renderSvg(textSvg("Comic Sans")),
    (error: Error) =>
      error.message.includes("Comic Sans") &&
      ["Fredoka", "Inter", "Lilita One"].every((name) => error.message.includes(name)),
  );
});

await test("an invalid scale fails", () => {
  assert.throws(() => renderSvg(textSvg("Inter"), { scale: 0 }), /scale/);
});

await test("vendored fonts match fonts.json and ship their OFL.txt", () => {
  for (const row of manifest) {
    const bytes = readFileSync(new URL(row.file, imagesConfig.fontsFolder));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256, row.file);
  }
  for (const family of ["Fredoka", "Inter", "LilitaOne"]) {
    assert.ok(
      readFileSync(new URL(`${family}-OFL.txt`, imagesConfig.fontsFolder), "utf8").includes(
        "SIL OPEN FONT LICENSE",
      ),
    );
  }
  const have = manifest.map((row) => `${row.family} ${String(row.weight)}`);
  for (const need of ["Fredoka 500", "Fredoka 700", "Inter 400", "Inter 700", "Lilita One 400"]) {
    assert.ok(have.includes(need), need);
  }
});

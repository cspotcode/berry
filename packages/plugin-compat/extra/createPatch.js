const {readFileSync,writeFileSync} = require(`fs`);
const {brotliCompressSync} = require(`zlib`);

exports.main = main;
function main(patchPath, jsFile) {
  const patchContent = readFileSync(patchPath);
  const patchEncoded = brotliCompressSync(patchContent).toString(`base64`);

  writeFileSync(jsFile, `let patch: string;

  export function getPatch() {
    if (typeof patch === \`undefined\`)
      patch = require(\`zlib\`).brotliDecompressSync(Buffer.from(\`${patchEncoded}\`, \`base64\`)).toString();

    return patch;
  }
  `);
}

if(process.mainModule === module) {
  createPatch(process.argv[2], process.argv[3]);
}

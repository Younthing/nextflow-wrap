// Auto-discovered by electron-builder, including direct CLI and CI invocations.
module.exports = async ({ projectDir = __dirname } = {}) => {
  const { join } = await import("node:path");
  const { existsSync, readFileSync } = await import("node:fs");
  const { loadProductTheme, root } = await import("./scripts/product-theme.mjs");
  const theme = loadProductTheme();
  const manifest = join(projectDir, "dist", "brand", "theme.json");
  if (!existsSync(manifest) || JSON.parse(readFileSync(manifest, "utf8")).id !== theme.id) {
    throw new Error(`Bundle the desktop shell with NEXT_PUBLIC_PRODUCT_THEME=${theme.id} before packaging`);
  }
  return {
    extends: join(__dirname, "packaging.yml"),
    productName: theme.displayName,
    artifactName: `${theme.artifactPrefix}-\${version}-\${os}-\${arch}.\${ext}`,
    copyright: theme.copyright,
    icon: join(root, "public", theme.icon),
    extraMetadata: { productName: theme.displayName },
    extraResources: [
      { from: join(projectDir, "dist", "brand"), to: "brand" },
    ],
    linux: { maintainer: theme.displayName, executableName: "nextflow-studio-desktop" },
  };
};

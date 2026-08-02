/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  typescript: {
    // We run `tsc --noEmit` separately in CI/pre-push.
    // Disabling here because Turbopack incorrectly resolves the workspace root
    // to the parent musicJAM directory, causing path prefix issues.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['yahoo-finance2'],
  },
  webpack: (config, { isServer }) => {
    // Força a Vercel a ignorar os arquivos quebrados do Yahoo Finance
    if (isServer) {
      config.externals.push('yahoo-finance2');
    }
    // Ignora bibliotecas de teste específicas que causam erro
    config.resolve.alias = {
      ...config.resolve.alias,
      '@std/testing': false,
      '@gadicc/fetch-mock-cache': false,
    };
    return config;
  },
};

export default nextConfig;
